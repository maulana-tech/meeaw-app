import { describe, expect, it } from "vitest";
import {
  createConfirmationTimer,
  formatSettlementSeconds,
} from "../src/lib/settlement";

describe("confirmation observation", () => {
  it("formats durations and carries rounded seconds into minutes", () => {
    expect(formatSettlementSeconds(50)).toBe("<0.1 s");
    expect(formatSettlementSeconds(1200)).toBe("1.2 s");
    expect(formatSettlementSeconds(21400)).toBe("21 s");
    expect(formatSettlementSeconds(59900)).toBe("1 m");
    expect(formatSettlementSeconds(119900)).toBe("2 m");
    expect(formatSettlementSeconds(65000)).toBe("1 m 5 s");
    expect(formatSettlementSeconds(-1)).toBeNull();
    expect(formatSettlementSeconds(NaN)).toBeNull();
  });
  it("keeps first submit across retries until matching confirmation", () => {
    let time = 100;
    const timer = createConfirmationTimer(() => time);
    timer.start("payment");
    time = 500;
    timer.start("payment");
    expect(
      timer.observe({ id: "payment", phase: "submitted", txHash: "0x1" }),
    ).toBeNull();
    expect(
      timer.observe({ id: "other", phase: "confirmed", txHash: "0x1" }),
    ).toBeNull();
    expect(
      timer.observe({ id: "payment", phase: "confirmed", txHash: null }),
    ).toBeNull();
    time = 1500;
    expect(
      timer.observe({ id: "payment", phase: "confirmed", txHash: "0x1" }),
    ).toBe(1400);
    time = 2500;
    expect(
      timer.observe({ id: "payment", phase: "confirmed", txHash: "0x1" }),
    ).toBe(1400);
  });
  it("never fabricates durations on reopen, reset or failure", () => {
    const timer = createConfirmationTimer(() => 100);
    const receipt = { id: "payment", phase: "confirmed", txHash: "0x1" };
    expect(timer.observe(receipt)).toBeNull();
    timer.start("payment");
    timer.observe({ ...receipt, phase: "failed" });
    expect(timer.observe(receipt)).toBeNull();
    timer.start("payment");
    timer.reset();
    expect(timer.observe(receipt)).toBeNull();
  });
});
