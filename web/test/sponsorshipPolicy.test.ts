import { describe, expect, it } from "vitest";
import { loadSponsorPolicy } from "../src/server/modules/sponsorship/policy";

const configured = {
  RELAYER_DAILY_BUDGET_MON: "5",
  RELAYER_ANONYMOUS_BUDGET_MON: "1",
  RELAYER_ACTION_BUDGET_MON: "0.5",
  RELAYER_MAX_FEE_GWEI: "200",
};
describe("sponsorship policy", () => {
  it("parses native bounds exactly with bounded quota defaults", () => {
    const result = loadSponsorPolicy(configured);
    expect(result.ready).toBe(true);
    if (!result.ready) throw new Error("Expected configured policy");
    expect(result.policy).toMatchObject({
      userLimit: 20,
      guestWalletLimit: 20,
      anonymousLimit: 100,
      globalWei: 5_000_000_000_000_000_000n,
      anonymousWei: 1_000_000_000_000_000_000n,
      actionWei: 500_000_000_000_000_000n,
      balanceFloorWei: 100_000_000_000_000_000n,
      feeCeilingWei: 200_000_000_000n,
      maxChildren: 16,
    });
  });
  it("pauses without any required monetary ceiling", () => {
    expect(loadSponsorPolicy({})).toEqual({
      ready: false,
      reason: "configuration",
    });
    for (const key of Object.keys(configured)) {
      const env: Record<string, string> = { ...configured };
      delete env[key];
      expect(loadSponsorPolicy(env).ready).toBe(false);
    }
  });
  it.each([
    "0",
    "-1",
    "1e4",
    "NaN",
    "1.0000000000000000001",
    "+5",
    "0x5",
  ])("rejects invalid monetary limit %s", (value) =>
    expect(
      loadSponsorPolicy({ ...configured, RELAYER_DAILY_BUDGET_MON: value })
        .ready,
    ).toBe(false));
  it.each([
    "0",
    "17",
    "1.5",
    "1e1",
    "-1",
  ])("rejects invalid child count %s", (value) =>
    expect(
      loadSponsorPolicy({ ...configured, RELAYER_MAX_ACTION_STEPS: value })
        .ready,
    ).toBe(false));
  it("rejects sub-ceilings above global and zero fee", () => {
    expect(
      loadSponsorPolicy({ ...configured, RELAYER_ANONYMOUS_BUDGET_MON: "6" })
        .ready,
    ).toBe(false);
    expect(
      loadSponsorPolicy({ ...configured, RELAYER_ACTION_BUDGET_MON: "6" })
        .ready,
    ).toBe(false);
    expect(
      loadSponsorPolicy({ ...configured, RELAYER_MAX_FEE_GWEI: "0" }).ready,
    ).toBe(false);
  });
  it("keeps policy revision stable without incorporating secrets", () => {
    const a = loadSponsorPolicy(configured),
      b = loadSponsorPolicy({
        ...configured,
        PRIVY_APP_SECRET: "not-a-policy-field",
      });
    expect(a).toEqual(b);
    const c = loadSponsorPolicy({
      ...configured,
      RELAYER_USER_ACTIONS_PER_DAY: "12",
    });
    expect(c.ready).toBe(true);
    if (a.ready && c.ready)
      expect(a.policy.revision).not.toBe(c.policy.revision);
  });
});
