import { afterEach, expect, it } from "vitest";
import { operatorBudgetSnapshot } from "../scripts/relayer-budget-status.mjs";
import { createSponsorFixture } from "./helpers/sponsorshipFixtures";

let f: Awaited<ReturnType<typeof createSponsorFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
it("reads only safe aggregates and leaves the authoritative revision unchanged", async () => {
  f = await createSponsorFixture();
  await f.a.admit(f.intent("operator"));
  const before = await f.a.repo.snapshot(143),
    day = before.serverNow.toISOString().slice(0, 10);
  await f.a.repo.ledgers.updateOne(
    { _id: "chain:143" },
    { $set: { day, usedWeiStr: "10000000000000000" } },
  );
  const env = {
    RELAYER_DAILY_BUDGET_MON: "5",
    RELAYER_ANONYMOUS_BUDGET_MON: "1",
    RELAYER_ACTION_BUDGET_MON: "0.5",
    RELAYER_MAX_FEE_GWEI: "200",
    RELAYER_PRIVATE_KEY: "do-not-print-private-key",
    MONGODB_URI: "do-not-print-database-uri",
  };
  const report = await operatorBudgetSnapshot(f.db, 143, env);
  expect(report).toMatchObject({
    usedMon: "0.010000000000000000",
    heldMon: "0.500000000000000000",
    availableBudgetMon: "4.490000000000000000",
    pendingActions: 1,
    unresolved: 0,
  });
  expect(JSON.stringify(report)).not.toMatch(
    /alice|do-not-print|serializedTransaction|counters|MONGODB_URI|PRIVATE_KEY/,
  );
  expect((await f.a.repo.ledgers.findOne({ _id: "chain:143" }))?.revision).toBe(
    before.revision,
  );
  expect(
    (
      await operatorBudgetSnapshot(f.db, 143, {
        RELAYER_DAILY_BUDGET_MON: "do-not-print-invalid-secret",
      })
    ).caps,
  ).toBeNull();
});
