import { afterEach, expect, it } from "vitest";
import { nextGenerationFundingAction } from "../src/features/privacyKeys/generationFunding";
import {
  accountForNote,
  derivePrivacyKeyring,
} from "../src/features/privacyKeys/keyRing";
import type { PoolScope } from "../src/lib/pools";
import { makeDurableSender } from "../src/server/lib/durableRelayer";
import { AccountSpendGate } from "../src/server/modules/privacyKeys/spendGate";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";

let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
it("preserves retained-key funding, one action, exact bytes and native bounds across independent instances and reset", async () => {
  f = await createSponsorSenderFixture(31337);
  const fixture = f;
  const action = await fixture.a.readAction(31337, fixture.action.actionId);
  if (!action) throw Error("Missing admitted action");
  const privacy = await makePrivacyFixture(),
    ring = await derivePrivacyKeyring(privacy.root, privacy.rotatedState);
  const scope = `31337:${fixture.intent.to}` as PoolScope;
  const old = {
      scope,
      keyGeneration: 0,
      leafIndex: 0,
      amount: 5n,
      salt: 1n,
      spent: false,
    },
    current = { ...old, keyGeneration: 1, leafIndex: 1, amount: 15n };
  expect(accountForNote(ring, old).ownerSecret).toBe(
    privacy.accounts.get(0)?.ownerSecret,
  );
  expect(nextGenerationFundingAction([old, current], 20n, scope, 1).kind).toBe(
    "key-migrate",
  );
  expect(
    nextGenerationFundingAction(
      [{ ...old, keyGeneration: 1 }, current],
      20n,
      scope,
      1,
    ).kind,
  ).toBe("merge");
  const gate = new AccountSpendGate(fixture.db, privacy.registry, async () => ({
    ...privacy.keys[1],
    owner: privacy.owner,
  }));
  await gate.repo.bootstrap(privacy.state);
  const rotation = await gate.repo.prepare(await privacy.signApproval());
  await gate.repo.appendConfirmed(
    privacy.owner,
    privacy.registry,
    rotation,
    privacy.rotatedState.generations[1].evidence,
  );
  await gate.repo.completeProjection(privacy.owner, privacy.registry, rotation);
  const capture = await gate.admit(
    privacy.owner,
    "transfer:acceptance",
    privacy.keys[1],
  );
  expect(capture).toMatchObject({ fundingGeneration: 1, keyRevision: 2 });
  fixture.port.prepare.mockImplementation(async (i, nonce) => ({
    ...fixture.frozen,
    to: i.to,
    data: i.data,
    nonce,
  }));
  const other = makeDurableSender(fixture.journal, fixture.port, undefined, {
    ledger: fixture.b,
    policy: () => ({ ready: true, policy: fixture.policy }),
  });
  const first = await fixture.sender.prepare(fixture.intent);
  await fixture.sender.broadcast(fixture.intent);
  fixture.setReceipt(first.txHash);
  await fixture.sender.reconcile(fixture.intent);
  expect(await fixture.a.status(fixture.principal)).toMatchObject({ used: 1 });
  const next = {
    ...fixture.intent,
    operationKey: "transfer:acceptance:merge",
    data: "0x5678" as const,
    sponsorship: { action: fixture.action, childId: "merge" },
  };
  const signed = await other.prepare(next);
  fixture.port.broadcast.mockRejectedValueOnce(
    Error("submission response lost"),
  );
  await expect(other.broadcast(next)).rejects.toThrow();
  const original = signed.serializedTransaction;
  fixture.clock.set(new Date("2026-10-09T00:00:00Z"));
  fixture.policy.globalWei = 400_000_000_000_000_000n;
  fixture.policy.actionWei = 200_000_000_000_000_000n;
  fixture.policy.anonymousWei = 200_000_000_000_000_000n;
  await expect(
    fixture.b.admit({
      ...action.intent,
      actionId: "new-action",
      principal: { kind: "user", key: "bob" },
    }),
  ).rejects.toMatchObject({ reason: "budget" });
  expect((await fixture.sender.prepare(next)).serializedTransaction).toBe(
    original,
  );
  await fixture.sender.broadcast(next);
  fixture.setReceipt(signed.txHash);
  fixture.port.block = async () => ({
    hash: `0x${"b".repeat(64)}`,
    timestamp: BigInt(Date.parse("2026-10-09T00:00:00Z") / 1000),
  });
  await other.reconcile(next);
  fixture.policy.globalWei = 500_000_000_000_000_000n;
  const payment = {
    ...fixture.intent,
    operationKey: "transfer:acceptance:payment",
    data: "0xab12" as const,
    sponsorship: { action: fixture.action, childId: "payment" },
  };
  const final = await other.prepare(payment);
  await other.broadcast(payment);
  fixture.setReceipt(final.txHash);
  await fixture.sender.reconcile(payment);
  await fixture.b.closeAction(fixture.action);
  expect(
    (await fixture.a.readAction(31337, fixture.action.actionId))?.charged,
  ).toBe(true);
  const guest = {
    kind: "guest-wallet" as const,
    key: "0x1111111111111111111111111111111111111111",
  };
  const guestIntent = {
    ...action.intent,
    actionId: "guest-deposit",
    principal: guest,
    kind: "deposit" as const,
  };
  const guestTicket = await fixture.b.admit(guestIntent);
  const deposit = {
    ...fixture.intent,
    operationKey: "ordinary:acceptance-guest",
    data: "0x9abc" as const,
    sponsorship: { action: guestTicket, childId: "one" },
  };
  const guestRaw = await other.prepare(deposit);
  await other.broadcast(deposit);
  fixture.setReceipt(guestRaw.txHash);
  await other.reconcile(deposit);
  await fixture.b.closeAction(guestTicket);
  const ledger = await fixture.a.repo.snapshot(31337);
  expect(
    BigInt(ledger.usedWeiStr) + BigInt(ledger.reservedWeiStr),
  ).toBeLessThanOrEqual(fixture.policy.globalWei);
  expect(await fixture.b.status(guest)).toMatchObject({ used: 1, reserved: 0 });
  expect(fixture.port.sign).toHaveBeenCalledTimes(4);
  await gate.finish(privacy.owner, "transfer:acceptance", capture, "terminal");
});
