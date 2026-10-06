import { describe, expect, it } from "vitest";
import { weeklyActivity } from "../src/components/dashboard/dashboardAnalytics";
import type { ActivityRow } from "../src/features/payments/activityTypes";
function row(
  kind: ActivityRow["kind"],
  amount: bigint,
  status: ActivityRow["status"] = "confirmed",
): ActivityRow {
  return {
    id: kind,
    scope: "31337:0x1111111111111111111111111111111111111111",
    kind,
    status,
    amount,
    note: null,
    counterparty: null,
    at: "2026-10-06T05:00:00.000Z",
    txHash: null,
    leafIndex: null,
    locked: false,
    transferId: null,
  };
}
describe("business weekly totals", () => {
  it("counts confirmed business directions while ignoring attempts and unknown notes", () => {
    const result = weeklyActivity(
      [
        row("received", 20n),
        row("sent", 5n),
        row("cashedOut", 3n),
        row("attempt", 25n, "pending"),
        row("unclassified", 100n),
      ],
      new Date("2026-10-06T12:00:00.000Z"),
    );
    expect(result.receivedAmount).toBe(20n);
    expect(result.cashedOutAmount).toBe(3n);
    expect(result.sentAmount).toBe(5n);
    expect(result.buckets.reduce((a, b) => a + b, 0)).toBe(3);
  });
});
