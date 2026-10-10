import { describe, expect, it } from "vitest";
import { invoiceRetrySafe } from "../src/features/invoices/attempt";

describe("invoice retry classification", () => {
  it("does not classify network/receipt failures as safe to pay again", () => {
    expect(invoiceRetrySafe(new Error("timeout"))).toBe(false);
    expect(invoiceRetrySafe({ cause: new Error("RPC unavailable") })).toBe(
      false,
    );
  });
  it("allows a rejected wallet request or confirmed revert", () => {
    expect(invoiceRetrySafe({ cause: { code: 4001 } })).toBe(true);
    expect(
      invoiceRetrySafe({
        code: "MAWEE_CONFIRMED_REVERT",
        txHash: `0x${"a".repeat(64)}`,
      }),
    ).toBe(true);
    expect(invoiceRetrySafe({ code: "MAWEE_CONFIRMED_REVERT" })).toBe(false);
  });
  it("accepts only the explicit unsigned-release signal", () => {
    expect(invoiceRetrySafe({ data: { relayNotSubmitted: true } })).toBe(true);
    expect(invoiceRetrySafe({ data: { relayNotSubmitted: false } })).toBe(
      false,
    );
    expect(invoiceRetrySafe({ data: { sponsorshipReleased: true } })).toBe(
      true,
    );
    expect(invoiceRetrySafe({ data: { sponsorshipReleased: false } })).toBe(
      false,
    );
  });
});
