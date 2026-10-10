import { afterEach, expect, it, vi } from "vitest";
import { ledgerKey } from "../src/server/modules/sponsorship/ledgerModel";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";

let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
it("refuses a delayed signature after wallet and budget cancellation fences retire", async () => {
  f = await createSponsorSenderFixture();
  const realSign = f.port.sign.getMockImplementation();
  if (!realSign) throw new Error("Missing signer");
  let finish: ((value: `0x${string}`) => void) | undefined;
  f.port.sign.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const preparing = f.sender.prepare(f.intent);
  await vi.waitFor(() => expect(f?.port.sign).toHaveBeenCalled());
  const active = await f.journal.active(
    `143:${f.account.address.toLowerCase()}`,
  );
  if (!active) throw new Error("Missing wallet fence");
  await f.journal.abandonUnsigned(active);
  const state = await f.a.repo.snapshot(143),
    child =
      state.actions[ledgerKey(f.action.actionId)].children[ledgerKey("one")];
  await f.a.releaseUnsigned(
    { ...f.action, childId: "one", childFence: child.fence },
    active.fence,
  );
  await f.a.cancelUnsigned(f.action);
  if (!finish) throw new Error("Missing signature completion");
  finish(await realSign(f.frozen));
  await expect(preparing).rejects.toThrow();
  expect(f.port.broadcast).not.toHaveBeenCalled();
  expect(await f.a.status(f.principal)).toMatchObject({ used: 0, reserved: 0 });
});
it("does not call the signer when its action reservation was cancelled", async () => {
  f = await createSponsorSenderFixture();
  await f.a.cancelUnsigned(f.action);
  await expect(f.sender.prepare(f.intent)).rejects.toThrow();
  expect(f.port.sign).not.toHaveBeenCalled();
  expect(f.port.broadcast).not.toHaveBeenCalled();
});
it("returns a low-balance pause and safely releases the unsigned child allocation", async () => {
  f = await createSponsorSenderFixture();
  f.port.balance = async () => 0n;
  await expect(f.sender.prepare(f.intent)).rejects.toMatchObject({
    reason: "balance",
  });
  expect(f.port.sign).not.toHaveBeenCalled();
  await f.a.cancelUnsigned(f.action);
  expect(await f.a.status(f.principal)).toMatchObject({ reserved: 0 });
});
it("rejects altered signed fees before raw publication", async () => {
  f = await createSponsorSenderFixture();
  const realSign = f.port.sign.getMockImplementation();
  if (!realSign) throw new Error("Missing test signer");
  f.port.sign.mockImplementation(async (tx) =>
    realSign({ ...tx, gas: tx.gas + 1n }),
  );
  await expect(f.sender.prepare(f.intent)).rejects.toThrow();
  expect(f.port.broadcast).not.toHaveBeenCalled();
  const active = await f.journal.active(
    `143:${f.account.address.toLowerCase()}`,
  );
  expect(active?.serializedTransaction ?? null).toBeNull();
});
it("keeps unknown liability and retries the identical signed bytes without a second quota", async () => {
  f = await createSponsorSenderFixture();
  const signed = await f.sender.prepare(f.intent);
  f.port.broadcast.mockRejectedValueOnce(new Error("lost RPC response"));
  await expect(f.sender.broadcast(f.intent)).rejects.toThrow();
  await expect(f.a.cancelUnsigned(f.action)).rejects.toThrow();
  const replay = await f.sender.prepare(f.intent);
  expect(replay.serializedTransaction).toBe(signed.serializedTransaction);
  expect(f.port.sign).toHaveBeenCalledOnce();
  expect(await f.a.status(f.principal)).toMatchObject({ reserved: 1, used: 0 });
});
