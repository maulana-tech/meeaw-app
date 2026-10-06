import { describe, expect, it } from "vitest";
import { weeklyActivity } from "../src/components/dashboard/dashboardAnalytics";
import type { ActivityRow } from "../src/features/payments/activityTypes";

function note(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id:"test",scope:"31337:0x1111111111111111111111111111111111111111",kind:"received",status:"confirmed",note:null,counterparty:null,at:"",txHash:null,leafIndex:0,locked:false,transferId:null,
    amount: 1n,
    ...overrides,
  };
}

describe("weeklyActivity", () => {
  it("groups timestamps into seven local calendar-day buckets", () => {
    const now = new Date(2026, 7, 11, 15, 30);
    const result = weeklyActivity(
      [
        note({ at: new Date(2026, 7, 5, 0, 0).toISOString() }),
        note({ at: new Date(2026, 7, 11, 15, 30).toISOString() }),
        note({
          at: new Date(2026, 7, 9, 12).toISOString(),
        }),
        note({kind:"cashedOut",at:new Date(2026,7,10,8).toISOString()}),
      ],
      now,
    );

    expect(result).toEqual({
      buckets: [1, 0, 0, 0, 1, 1, 1],
      received: 3,
      cashedOut: 1,
      receivedAmount: 3n,
      cashedOutAmount: 1n,
      sent:0,sentAmount:0n,
    });
  });

  it("excludes future, expired, invalid, and legacy timestamp-free records", () => {
    const now = new Date(2026, 7, 11, 15, 30);
    const result = weeklyActivity(
      [
        note({ at: new Date(2026, 7, 4, 23, 59).toISOString() }),
        note({ at: new Date(2026, 7, 11, 15, 31).toISOString() }),
        note({ at: "not-a-date" }),
        note({}),
      ],
      now,
    );

    expect(result).toEqual({
      buckets: [0, 0, 0, 0, 0, 0, 0],
      received: 0,
      cashedOut: 0,
      receivedAmount: 0n,
      cashedOutAmount: 0n,
      sent:0,sentAmount:0n,
    });
  });
});
