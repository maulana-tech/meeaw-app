import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeeEvidence, FrozenTx } from "../src/features/sponsorship/types";
import { createSponsorFixture } from "./helpers/sponsorshipFixtures";

let f: Awaited<ReturnType<typeof createSponsorFixture>> | undefined;
it("uses one live ordinary action when duplicate proof submissions carry different click markers", async () => {
  f = await createSponsorFixture();
  const original = {
    ...f.intent("proof"),
    kind: "withdraw" as const,
    maximumChildren: 1,
  };
  const first = await f.a.admit(original);
  expect(
    await f.b.admit({ ...original, actionId: "withdraw:other-click" }),
  ).toEqual(first);
  expect(await f.a.status(f.principal)).toMatchObject({ reserved: 1 });
});
afterEach(async () => {
  await f?.close();
  f = undefined;
});
const tx: FrozenTx = {
  chainId: 143,
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  data: "0x1234",
  nonce: 0,
  gas: 500_000n,
  value: 0n,
  fee: { type: 2, maxFeePerGas: 200n, maxPriorityFeePerGas: 10n },
};
const receipt: FeeEvidence = {
  hash: `0x${"a".repeat(64)}`,
  block: 10n,
  blockHash: `0x${"b".repeat(64)}`,
  blockTime: new Date("2026-10-08T00:00:00Z"),
  outcome: "confirmed",
  gasUsed: 120_000n,
  effectiveGasPrice: 100n,
  transaction: tx,
};
describe("durable sponsorship actions", () => {
  it("retries terminal closure and repairs a lost archival response without another charge", async () => {
    f = await createSponsorFixture();
    const intent = f.intent("archive"),
      action = await f.a.admit(intent);
    const projection = vi
      .spyOn(f.a.repo.archives, "updateOne")
      .mockRejectedValueOnce(new Error("projection unavailable"));
    await expect(f.a.closeAction(action)).rejects.toThrow(
      "projection unavailable",
    );
    projection.mockRestore();
    await f.a.closeAction(action);
    await f.b.closeAction(action);
    expect(await f.b.admit(intent)).toEqual(action);
    expect(await f.a.status(f.principal)).toMatchObject({
      used: 0,
      reserved: 0,
    });
  });
  it("reports paused configuration without dropping signed liabilities", async () => {
    f = await createSponsorFixture();
    const action = await f.a.admit(f.intent("configuration"));
    const child = await f.a.allocate(action, "one", `0x${"c".repeat(64)}`, tx);
    await f.a.enterSigning(child, 7);
    await f.a.pinSigned(child, receipt.hash);
    const { SponsorLedger } = await import(
      "../src/server/modules/sponsorship/ledger.service"
    );
    const disabled = new SponsorLedger({
      db: f.db,
      clock: f.clock,
      policy: () => ({ ready: false, reason: "configuration" }),
    });
    expect(await disabled.status(f.principal)).toMatchObject({
      available: false,
      configured: false,
      reason: "configuration",
      reserved: 1,
    });
    await disabled.settleChild(child, receipt);
    await disabled.closeAction(action);
    expect(await disabled.status(f.principal)).toMatchObject({
      used: 1,
      reserved: 0,
    });
  });
  it("accepts an identical intent with different object property ordering", async () => {
    f = await createSponsorFixture();
    const i = f.intent("order"),
      a = await f.a.admit(i);
    expect(
      await f.b.admit({
        principal: { key: i.principal.key, kind: i.principal.kind },
        kind: i.kind,
        actionId: i.actionId,
        maximumChildren: i.maximumChildren,
        businessDigest: i.businessDigest,
        chainId: i.chainId,
      }),
    ).toEqual(a);
  });
  it("rechecks lower budget and fee ceilings before an unsigned allocation enters signing", async () => {
    f = await createSponsorFixture();
    const a = await f.a.admit(f.intent("limits"));
    const c = await f.a.allocate(a, "one", `0x${"c".repeat(64)}`, tx);
    f.policy.globalWei = 1n;
    await expect(f.a.enterSigning(c, 7)).rejects.toThrow();
    f.policy.globalWei = 5_000_000_000_000_000_000n;
    f.policy.feeCeilingWei = 1n;
    await expect(f.a.enterSigning(c, 7)).rejects.toThrow();
  });
  it("reserves once, charges one quota for multiple canonical children, and returns unused envelope", async () => {
    f = await createSponsorFixture();
    const action = await f.a.admit(f.intent("payment"));
    expect(await f.b.admit(f.intent("payment"))).toEqual(action);
    expect(await f.a.status(f.principal)).toMatchObject({
      reserved: 1,
      used: 0,
      remaining: 19,
    });
    const child = await f.a.allocate(
      action,
      "merge",
      `0x${"c".repeat(64)}`,
      tx,
    );
    await f.a.enterSigning(child, 7);
    await f.a.pinSigned(child, receipt.hash);
    await f.a.assertBroadcast(child, receipt.hash);
    await f.a.settleChild(child, receipt);
    await f.b.settleChild(child, receipt);
    const secondTx = { ...tx, nonce: 1 };
    const second = await f.a.allocate(
      action,
      "payment",
      `0x${"d".repeat(64)}`,
      secondTx,
    );
    await f.a.enterSigning(second, 8);
    await f.a.pinSigned(second, `0x${"e".repeat(64)}`);
    await f.a.settleChild(second, {
      ...receipt,
      hash: `0x${"e".repeat(64)}`,
      transaction: secondTx,
      outcome: "reverted",
    });
    expect(await f.a.status(f.principal)).toMatchObject({
      reserved: 0,
      used: 1,
      remaining: 19,
    });
    await f.a.closeAction(action);
    const stored = await f.db
      .collection("sponsorship_ledgers")
      .findOne({ _id: "chain:143" as never });
    expect(stored?.reservedWeiStr).toBe("0");
    expect(stored?.usedWeiStr).toBe("100000000");
  });
  it("refuses to cancel signing/unknown work and fences retired unsigned children", async () => {
    f = await createSponsorFixture();
    const action = await f.a.admit(f.intent("pending"));
    const child = await f.a.allocate(action, "one", `0x${"c".repeat(64)}`, tx);
    await f.a.enterSigning(child, 7);
    await expect(f.b.cancelUnsigned(action)).rejects.toThrow();
    await expect(f.b.releaseUnsigned(child, 8)).rejects.toThrow();
    await f.a.releaseUnsigned(child, 7);
    await f.a.cancelUnsigned(action);
    await expect(f.a.pinSigned(child, receipt.hash)).rejects.toThrow();
    expect(await f.a.status(f.principal)).toMatchObject({
      remaining: 20,
      reserved: 0,
      used: 0,
    });
  });
  it("carries old-day unknown liabilities and charges delayed/reverted receipts to their mining day", async () => {
    f = await createSponsorFixture({ userLimit: 1 });
    const action = await f.a.admit(f.intent("midnight"));
    const child = await f.a.allocate(action, "one", `0x${"c".repeat(64)}`, tx);
    await f.a.enterSigning(child, 7);
    await f.a.pinSigned(child, receipt.hash);
    f.clock.set(new Date("2026-10-09T00:01:00Z"));
    expect(await f.b.status(f.principal)).toMatchObject({
      reserved: 1,
      used: 0,
      remaining: 0,
    });
    await expect(f.b.admit(f.intent("new-day"))).rejects.toThrow();
    await f.b.settleChild(child, {
      ...receipt,
      blockTime: new Date("2026-10-09T00:00:30Z"),
      outcome: "reverted",
    });
    expect(await f.a.status(f.principal)).toMatchObject({
      reserved: 0,
      used: 1,
    });
    f.clock.set(new Date("2026-10-10T00:01:00Z"));
    expect(await f.b.admit(f.intent("tomorrow"))).toBeDefined();
    expect(await f.a.status(f.principal)).toMatchObject({
      reserved: 1,
      used: 0,
    });
  });
});
