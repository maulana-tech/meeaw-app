import type { Hex } from "viem";
import { afterEach, expect, it } from "vitest";
import { registryAuthorizationTypedData } from "../src/features/privacyKeys/registryRotation";
import { PrivacyKeysRepository } from "../src/server/modules/privacyKeys/privacyKeys.repository";
import { createRotationOperations } from "../src/server/modules/privacyKeys/rotationOperations";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";

let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
async function setup() {
  f = await createSponsorSenderFixture(31337);
  const fixture = f;
  await f.a.cancelUnsigned(f.action);
  const privacy = await makePrivacyFixture(),
    repo = new PrivacyKeysRepository(f.db);
  await repo.bootstrap(privacy.state);
  const intent = await privacy.signApproval();
  await repo.prepare(intent);
  const auth = {
    nonce: "0",
    deadline: intent.deadline,
    signature: await privacy.signer.walletClient.signTypedData({
      account: privacy.signer.walletClient.account ?? privacy.signer.address,
      ...registryAuthorizationTypedData(intent, {
        nonce: "0",
        deadline: intent.deadline,
      }),
    }),
  };
  let confirmed = false,
    expired = false;
  fixture.port.prepare.mockImplementation(async (i, nonce) => ({
    ...fixture.frozen,
    to: i.to,
    data: i.data,
    nonce,
  }));
  const ports = {
    repository: repo,
    readRegistry: async () => ({
      scope: privacy.registry,
      owner: privacy.owner,
      keys: confirmed ? privacy.keys[1] : privacy.keys[0],
      nonce: confirmed ? "1" : "0",
      block: 10,
      head: 12,
      blockHash: `0x${"b".repeat(64)}` as Hex,
      timestamp: expired ? "4102444801" : "1791417600",
    }),
    verifyTransaction: async (hash: Hex) =>
      confirmed
        ? {
            state: "confirmed" as const,
            evidence: {
              block: 10,
              blockHash: `0x${"b".repeat(64)}` as Hex,
              txHash: hash,
            },
          }
        : { state: "unknown" as const },
    refreshCache: async () => {},
    confirmations: 1,
    now: () => 1791417600,
    relayer: fixture.account.address,
    sender: fixture.sender,
    journal: fixture.journal,
    sponsorship: { ledger: fixture.a, user: "alice" },
  };
  const ops = createRotationOperations(ports);
  return {
    fixture,
    privacy,
    repo,
    intent,
    auth,
    ops,
    ports,
    confirm() {
      confirmed = true;
    },
    expire() {
      expired = true;
    },
  };
}
it("records an accepted rotation authorization but pauses before signing when policy is absent", async () => {
  const s = await setup();
  const ledger = s.fixture.a,
    policy = ledger.options.policy;
  // Remove policy at its trusted provider boundary, after metadata is accepted.
  const pausedLedger = new (
    await import("../src/server/modules/sponsorship/ledger.service")
  ).SponsorLedger({
    ...ledger.options,
    policy: () => ({ ready: false, reason: "configuration" }),
  });
  const ops = createRotationOperations({
    ...s.ports,
    sponsorship: { ledger: pausedLedger, user: "alice" },
  });
  await expect(
    ops.submit(s.privacy.owner, s.privacy.registry, {
      id: s.intent.id,
      authorization: s.auth,
    }),
  ).rejects.toMatchObject({ reason: "configuration" });
  expect(
    await s.repo.operation(s.privacy.owner, s.privacy.registry, s.intent.id),
  ).toMatchObject({
    registryAuthorization: s.auth,
    sponsorshipPause: "configuration",
  });
  expect(s.fixture.port.sign).not.toHaveBeenCalled();
  expect(policy().ready).toBe(true);
});
it("reuses the original signed registry transaction and consumes one quota", async () => {
  const s = await setup();
  await s.ops.submit(s.privacy.owner, s.privacy.registry, {
    id: s.intent.id,
    authorization: s.auth,
  });
  const first = await s.repo.operation(
    s.privacy.owner,
    s.privacy.registry,
    s.intent.id,
  );
  expect(first.sponsorshipAction).toBeDefined();
  await s.ops.submit(s.privacy.owner, s.privacy.registry, {
    id: s.intent.id,
    authorization: s.auth,
  });
  expect(s.fixture.port.sign).toHaveBeenCalledTimes(1);
  if (!first.txHash) throw Error("Missing signed rotation hash");
  s.fixture.setReceipt(first.txHash);
  s.confirm();
  await s.ops.reconcile(s.privacy.owner, s.privacy.registry, s.intent.id);
  expect(await s.fixture.a.status(s.fixture.principal)).toMatchObject({
    used: 1,
    reserved: 0,
  });
});
it("keeps a signed relayer liability after the registry permit expires", async () => {
  const s = await setup();
  await s.ops.submit(s.privacy.owner, s.privacy.registry, {
    id: s.intent.id,
    authorization: s.auth,
  });
  s.expire();
  await s.ops.reconcile(s.privacy.owner, s.privacy.registry, s.intent.id);
  const state = await s.fixture.a.repo.snapshot(31337);
  expect(BigInt(state.reservedWeiStr)).toBeGreaterThan(0n);
  expect(s.fixture.port.sign).toHaveBeenCalledTimes(1);
});
it("leaves sponsorship quota untouched for wallet-paid rotation", async () => {
  const s = await setup();
  await s.ops.submit(s.privacy.owner, s.privacy.registry, {
    id: s.intent.id,
    authorization: s.auth,
    mode: "wallet",
  });
  expect(await s.fixture.a.status(s.fixture.principal)).toMatchObject({
    used: 0,
    reserved: 0,
  });
  expect(s.fixture.port.sign).not.toHaveBeenCalled();
});
