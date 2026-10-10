import { afterEach, expect, it, vi } from "vitest";
import { ledgerKey } from "../src/server/modules/sponsorship/ledgerModel";
import { SponsorshipRecovery } from "../src/server/modules/sponsorship/recovery";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";

let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
it("recovers an ordinary guest envelope abandoned before any child was signed", async () => {
  f = await createSponsorSenderFixture();
  const ticket = await f.a.admit({
    ...(await f.a.readAction(143, f.action.actionId))?.intent,
    actionId: "guest-crash",
    kind: "deposit",
    principal: { kind: "guest-wallet", key: `0x${"3".repeat(40)}` },
  });
  await new SponsorshipRecovery(f.a, f.journal, f.port, 143).reconcile();
  expect((await f.a.readAction(143, ticket.actionId))?.phase).toBe("closed");
  await expect(
    f.a.admit({
      ...(await f.a.readAction(143, f.action.actionId))?.intent,
      actionId: "next-guest",
      kind: "deposit",
      principal: { kind: "guest-wallet", key: `0x${"4".repeat(40)}` },
    }),
  ).resolves.toBeDefined();
});
it("releases a pinned signature only after its wallet fence retired without published bytes", async () => {
  f = await createSponsorSenderFixture();
  vi.spyOn(f.journal, "persistSigned").mockRejectedValueOnce(
    Error("projection lost before wallet publication"),
  );
  await expect(f.sender.prepare(f.intent)).rejects.toThrow();
  expect(
    await f.journal.active(
      `${f.intent.chainId}:${f.intent.wallet.toLowerCase()}`,
    ),
  ).toBeNull();
  const recovery = new SponsorshipRecovery(f.a, f.journal, f.port, 143);
  await recovery.reconcile();
  const action = await f.a.readAction(143, f.action.actionId);
  expect(action?.children[ledgerKey("one")].phase).toBe("abandoned");
  await f.a.cancelUnsigned(f.action);
  expect(await f.a.status(f.principal)).toMatchObject({ reserved: 0, used: 0 });
});
it("retains an actual published signature when only its history projection failed", async () => {
  f = await createSponsorSenderFixture();
  vi.spyOn(f.journal.sends, "updateOne").mockRejectedValueOnce(
    Error("history projection failed"),
  );
  await expect(f.sender.prepare(f.intent)).rejects.toThrow();
  const active = await f.journal.active(
    `${f.intent.chainId}:${f.intent.wallet.toLowerCase()}`,
  );
  expect(active?.serializedTransaction).toBeTruthy();
  const recovery = new SponsorshipRecovery(f.a, f.journal, f.port, 143);
  await recovery.reconcile();
  expect(
    (await f.a.readAction(143, f.action.actionId))?.children[ledgerKey("one")]
      .phase,
  ).toBe("signed");
  await expect(f.a.cancelUnsigned(f.action)).rejects.toThrow();
});
it("never treats an expired live signing fence as evidence to release its allocation", async () => {
  f = await createSponsorSenderFixture();
  const fixture = f,
    original = fixture.port.sign.getMockImplementation();
  if (!original) throw Error("Missing signer fixture");
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fixture.port.sign.mockImplementation(async (tx) => {
    await gate;
    return original(tx);
  });
  const preparing = fixture.sender.prepare(fixture.intent);
  await vi.waitFor(() => expect(fixture.port.sign).toHaveBeenCalledTimes(1));
  await fixture.journal.wallets.updateOne(
    { _id: `143:${fixture.intent.wallet.toLowerCase()}` },
    { $set: { "active.expiresAt": new Date(0) } },
  );
  await new SponsorshipRecovery(
    fixture.a,
    fixture.journal,
    fixture.port,
    143,
  ).reconcile();
  expect(
    (await fixture.a.readAction(143, fixture.action.actionId))?.children[
      ledgerKey("one")
    ].phase,
  ).toBe("signing");
  release();
  await preparing;
});
it("repairs terminal archival after canonical settlement without charging again", async () => {
  f = await createSponsorSenderFixture();
  const signed = await f.sender.prepare(f.intent);
  await f.sender.broadcast(f.intent);
  f.setReceipt(signed.txHash);
  await f.sender.reconcile(f.intent);
  vi.spyOn(f.a.repo.archives, "updateOne").mockRejectedValueOnce(
    Error("archive projection unavailable"),
  );
  await expect(f.a.closeAction(f.action)).rejects.toThrow();
  await new SponsorshipRecovery(f.a, f.journal, f.port, 143).reconcile();
  expect(
    (await f.a.repo.snapshot(143)).actions[ledgerKey(f.action.actionId)],
  ).toBeUndefined();
  expect((await f.a.repo.snapshot(143)).usedWeiStr).toBe("10000000000000000");
});
