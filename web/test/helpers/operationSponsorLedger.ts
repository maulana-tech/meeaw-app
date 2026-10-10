import type { Db } from "mongodb";
import { SponsorLedger } from "../../src/server/modules/sponsorship/ledger.service";
import { emptyLedger } from "../../src/server/modules/sponsorship/ledgerModel";
import { loadSponsorPolicy } from "../../src/server/modules/sponsorship/policy";
export function operationSponsorLedger(db: Db) {
  return new SponsorLedger({
    db,
    chainId: 31337,
    policy: () =>
      loadSponsorPolicy({
        RELAYER_DAILY_BUDGET_MON: "5",
        RELAYER_ANONYMOUS_BUDGET_MON: "1",
        RELAYER_ACTION_BUDGET_MON: "0.5",
        RELAYER_MAX_FEE_GWEI: "200",
      }),
  });
}
export async function resetOperationSponsorLedger(db: Db) {
  if (!/^mawee_request_test_[a-f0-9]{32}$/.test(db.databaseName))
    throw Error("Expected isolated test database");
  await db.collection("sponsorship_ledgers").deleteMany({});
  await db.collection("sponsorship_actions").deleteMany({});
  await db
    .collection("sponsorship_ledgers")
    .insertOne(emptyLedger(31337, new Date(), "complete") as never);
}
