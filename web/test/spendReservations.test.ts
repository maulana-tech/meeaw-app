import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openIsolatedRequestDb } from "./helpers/requestDb";
import { SpendReservations } from "../src/server/lib/spendReservations";
const nf = `0x${"11".repeat(32)}` as const;
const owner = {
  kind: "transfer" as const,
  id: "send-a",
  sender: `0x${"22".repeat(20)}` as const,
  scope: `31337:0x${"33".repeat(20)}` as const,
};
describe("shared spend reservations", () => {
  let db: Awaited<ReturnType<typeof openIsolatedRequestDb>>;
  beforeAll(async () => {
    db = await openIsolatedRequestDb();
  }, 15000);
  beforeEach(async () => {
    await db.db.collection("spend_claims").deleteMany({});
    await db.db.collection("spend_nullifiers").deleteMany({});
  });
  afterAll(async () => {
    await db?.close();
  });
  it("allows one worker to claim a note across payment flows", async () => {
    const a = new SpendReservations(db.db),
      b = new SpendReservations(db.db);
    const results = await Promise.allSettled([
      a.claim(owner, [nf], new Date()),
      b.claim({ ...owner, kind: "withdraw", id: "cash-out" }, [nf], new Date()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("pins dispatching claims past lease expiry and rejects stale release", async () => {
    const a = new SpendReservations(db.db),
      b = new SpendReservations(db.db);
    const claim = await a.claim(owner, [nf], new Date(0));
    await a.enterDispatch(claim);
    await expect(
      b.claim({ ...owner, id: "another" }, [nf], new Date(1_000_000)),
    ).rejects.toThrow();
    await expect(
      a.release({ ...claim, fence: claim.fence + 1 }, "unsigned-abandoned"),
    ).rejects.toThrow();
    await a.release({ ...claim, phase: "dispatching" }, "confirmed");
    await expect(
      b.claim({ ...owner, id: "another" }, [nf], new Date()),
    ).resolves.toBeDefined();
  });
  it("does not drop signed reservations on an unsigned cleanup", async () => {
    const a = new SpendReservations(db.db);
    const claim = await a.claim(owner, [nf], new Date());
    await a.enterDispatch(claim);
    await a.pinSigned(claim, "relay-op");
    await expect(a.release(claim, "unsigned-abandoned")).rejects.toThrow();
  });
  it("recovers an abandoned unsigned claim while fencing its old owner", async () => {
    const a = new SpendReservations(db.db),
      claim = await a.claim(owner, [nf], new Date(0));
    expect((await a.reconcile(20)).released).toBe(1);
    await expect(a.assertOwned(claim)).rejects.toThrow();
    await expect(
      a.claim({ ...owner, id: "replacement" }, [nf], new Date()),
    ).resolves.toBeDefined();
  });
});
