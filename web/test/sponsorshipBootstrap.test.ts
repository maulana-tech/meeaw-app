import type { Hex, TransactionReceipt } from "viem";
import { afterEach, expect, it, vi } from "vitest";
import { makeDurableSender } from "../src/server/lib/durableRelayer";
import { SponsorshipBaseline } from "../src/server/modules/sponsorship/bootstrap";
import { SponsorLedger } from "../src/server/modules/sponsorship/ledger.service";
import { SponsorshipRecovery } from "../src/server/modules/sponsorship/recovery";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";

let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
async function legacy() {
  f = await createSponsorSenderFixture();
  const fixture = f;
  await f.a.cancelUnsigned(f.action);
  const sender = makeDurableSender(f.journal, f.port);
  const base = { ...f.intent, sponsorship: undefined };
  const paid = { ...base, operationKey: "ordinary:legacy-paid" };
  const first = await sender.prepare(paid);
  await sender.broadcast(paid);
  f.setReceipt(first.txHash);
  const receipt = await f.port.receipt(first.txHash);
  if (!receipt) throw Error("Missing fixture receipt");
  await sender.reconcile(paid);
  const unknown = { ...base, operationKey: "ordinary:legacy-unknown" };
  const second = await sender.prepare(unknown);
  const receipts = new Map<Hex, TransactionReceipt>([[first.txHash, receipt]]);
  fixture.port.receipt = async (hash) => receipts.get(hash) ?? null;
  await f.a.repo.ledgers.updateOne(
    { _id: "chain:143" },
    { $set: { bootstrap: { state: "initializing", cursor: null } } },
  );
  return {
    f: fixture,
    first,
    second,
    paid,
    unknown,
    receipts,
    baseline: new SponsorshipBaseline(f.a, f.journal, f.port, 143),
  };
}
it("imports signed legacy liabilities and current-day canonical fees before opening admission", async () => {
  const s = await legacy();
  expect((await s.f.a.status(s.f.principal)).reason).toBe("initializing");
  let result = await s.baseline.advance(1);
  for (let i = 0; i < 8 && result.state !== "complete"; i++)
    result = await s.baseline.advance(1);
  expect(result.state).toBe("complete");
  const doc = await s.f.a.repo.snapshot(143);
  expect(doc.usedWeiStr).toBe("10000000000000000");
  expect(doc.reservedWeiStr).toBe("20000000000000000");
  expect(await s.f.a.status(s.f.principal)).toMatchObject({
    used: 0,
    reserved: 0,
  });
  const stored = await s.f.journal.read(
    s.second.walletKey,
    s.second.operationKey,
  );
  expect(stored?.budgetChild).toBeDefined();
  await s.baseline.advance(1);
  expect((await s.f.a.repo.snapshot(143)).usedWeiStr).toBe(doc.usedWeiStr);
});
it("excludes another chain from the baseline scan", async () => {
  f = await createSponsorSenderFixture();
  await f.a.cancelUnsigned(f.action);
  await f.a.repo.ledgers.updateOne(
    { _id: "chain:143" },
    { $set: { bootstrap: { state: "initializing", cursor: null } } },
  );
  await f.journal.sends.insertOne({
    ...f.intent,
    _id: "10143:foreign",
    walletKey: "10143:foreign",
    operationKey: "foreign",
    serializedTransaction: "0xinvalid",
  } as never);
  const baseline = new SponsorshipBaseline(f.a, f.journal, f.port, 143);
  for (let i = 0; i < 4; i++) await baseline.advance(1);
  expect((await f.a.repo.snapshot(143)).bootstrap.state).toBe("complete");
  expect(f.port.sign).not.toHaveBeenCalled();
});
it("charges a canonical legacy hash only once across duplicate journal projections", async () => {
  const s = await legacy();
  const original = await s.f.journal.read(
    s.first.walletKey,
    s.first.operationKey,
  );
  if (!original?.intent) throw Error("Missing legacy journal intent");
  await s.f.journal.sends.insertOne({
    ...original,
    _id: `${original.walletKey}:duplicate`,
    operationKey: "duplicate",
    intent: { ...original.intent, operationKey: "duplicate" },
  });
  for (let i = 0; i < 8; i++) await s.baseline.advance(2);
  expect((await s.f.a.repo.snapshot(143)).usedWeiStr).toBe("10000000000000000");
});
it("keeps admission paused after an import projection fails, then resumes without duplicate charges", async () => {
  const s = await legacy();
  vi.spyOn(s.f.journal.sends, "updateOne").mockRejectedValueOnce(
    Error("projection unavailable"),
  );
  await expect(s.baseline.advance(20)).rejects.toThrow();
  expect((await s.f.a.status(s.f.principal)).reason).toBe("initializing");
  for (let i = 0; i < 4; i++)
    await new SponsorshipBaseline(s.f.b, s.f.journal, s.f.port, 143).advance(
      20,
    );
  expect((await s.f.a.repo.snapshot(143)).usedWeiStr).toBe("10000000000000000");
  expect((await s.f.a.repo.snapshot(143)).bootstrap.state).toBe("complete");
});
it("recovers legacy bytes with no new policy and keeps outstanding liabilities across midnight", async () => {
  const s = await legacy();
  await s.f.a.repo.ledgers.updateOne(
    { _id: "chain:143" },
    { $set: { policy: null } },
  );
  const paused = new SponsorLedger({
    ...s.f.a.options,
    policy: () => ({ ready: false, reason: "configuration" }),
  });
  const baseline = new SponsorshipBaseline(paused, s.f.journal, s.f.port, 143);
  for (let i = 0; i < 4; i++) await baseline.advance(20);
  expect(await paused.status(s.f.principal)).toMatchObject({
    configured: false,
    available: false,
    used: 0,
  });
  s.f.clock.set(new Date("2026-10-09T00:00:00Z"));
  const status = await paused.status(s.f.principal);
  expect(status.available).toBe(false);
  expect((await paused.repo.snapshot(143)).reservedWeiStr).toBe(
    "20000000000000000",
  );
  s.f.port.block = async () => ({
    hash: `0x${"b".repeat(64)}`,
    timestamp: BigInt(Date.parse("2026-10-09T00:00:00Z") / 1000),
  });
  s.receipts.set(s.second.txHash, {
    ...s.receipts.get(s.first.txHash),
    transactionHash: s.second.txHash,
  } as TransactionReceipt);
  await new SponsorshipRecovery(paused, s.f.journal, s.f.port, 143).reconcile(
    20,
  );
  expect((await paused.repo.snapshot(143)).reservedWeiStr).toBe("0");
  expect((await paused.repo.snapshot(143)).usedWeiStr).toBe(
    "10000000000000000",
  );
});
