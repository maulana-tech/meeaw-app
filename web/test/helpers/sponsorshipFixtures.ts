import { keccak256, toHex } from "viem";
import type {
  ActionIntent,
  Principal,
  SponsorPolicy,
} from "../../src/features/sponsorship/types";
import { SponsorLedger } from "../../src/server/modules/sponsorship/ledger.service";
import { emptyLedger } from "../../src/server/modules/sponsorship/ledgerModel";
import { loadSponsorPolicy } from "../../src/server/modules/sponsorship/policy";
import { openIsolatedRequestDb } from "./requestDb";
export async function createSponsorFixture(
  overrides: Partial<SponsorPolicy> = {},
  chainId = 143,
) {
  const isolated = await openIsolatedRequestDb();
  const parsed = loadSponsorPolicy({
    RELAYER_DAILY_BUDGET_MON: "5",
    RELAYER_ANONYMOUS_BUDGET_MON: "1",
    RELAYER_ACTION_BUDGET_MON: "0.5",
    RELAYER_MAX_FEE_GWEI: "200",
  });
  if (!parsed.ready) throw new Error("Invalid test policy");
  const policy = { ...parsed.policy, ...overrides };
  let at = new Date("2026-10-08T00:00:00Z");
  const clock = {
    now: async () => new Date(at),
    set(value: Date) {
      at = new Date(value);
    },
  };
  const principal: Principal = { kind: "user", key: "alice" };
  await isolated.db
    .collection("sponsorship_ledgers")
    .insertOne(emptyLedger(chainId, at, "complete") as never);
  const options = {
    db: isolated.db,
    policy: () => ({ ready: true as const, policy }),
    clock,
    chainId,
  };
  return {
    ...isolated,
    policy,
    clock,
    principal,
    a: new SponsorLedger(options),
    b: new SponsorLedger(options),
    intent(label: string, subject: Principal = principal): ActionIntent {
      return {
        chainId,
        actionId: `test:${label}`,
        kind: "send",
        principal: subject,
        businessDigest: keccak256(toHex(label)),
        maximumChildren: 4,
      };
    },
  };
}
