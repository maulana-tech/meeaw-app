import { afterEach, expect, it } from "vitest";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";

let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
it("settles a real reverted transaction once using Monad gross charged gas", async () => {
  f = await createSponsorSenderFixture();
  const signed = await f.sender.prepare(f.intent);
  await f.sender.broadcast(f.intent);
  f.setReceipt(signed.txHash, "reverted");
  expect((await f.sender.reconcile(f.intent)).state).toBe("reverted");
  await f.sender.reconcile(f.intent);
  expect(await f.a.status(f.principal)).toMatchObject({ used: 1, reserved: 0 });
  const doc = await f.db
    .collection("sponsorship_ledgers")
    .findOne({ _id: "chain:143" as never });
  expect(doc?.usedWeiStr).toBe("10000000000000000");
});
it("keeps fee liability when a receipt points at a noncanonical block", async () => {
  f = await createSponsorSenderFixture();
  const signed = await f.sender.prepare(f.intent);
  await f.sender.broadcast(f.intent);
  f.setReceipt(signed.txHash);
  f.port.block = async () => ({
    hash: `0x${"c".repeat(64)}` as const,
    timestamp: BigInt(Date.parse("2026-10-08T00:00:00Z") / 1000),
  });
  await expect(f.sender.reconcile(f.intent)).rejects.toThrow();
  expect(await f.a.status(f.principal)).toMatchObject({ used: 0, reserved: 1 });
});
it("replays a terminal send after its action has been archived", async () => {
  f = await createSponsorSenderFixture();
  const signed = await f.sender.prepare(f.intent);
  await f.sender.broadcast(f.intent);
  f.setReceipt(signed.txHash);
  await f.sender.reconcile(f.intent);
  await f.a.closeAction(f.action);
  expect((await f.sender.reconcile(f.intent)).state).toBe("confirmed");
  expect(await f.a.status(f.principal)).toMatchObject({ used: 1, reserved: 0 });
});
