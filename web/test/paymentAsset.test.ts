import { describe, expect, it, vi } from "vitest";

const pools = vi.hoisted(() => [
  {
    scope: "31337:0x1111111111111111111111111111111111111111",
    asset: "AUSD",
    tokenDecimals: 6,
    role: "active",
    transferCapable: true,
    requestCapable: false,
  },
  {
    scope: "31337:0x2222222222222222222222222222222222222222",
    asset: "USDC",
    tokenDecimals: 6,
    role: "legacy",
    transferCapable: false,
    requestCapable: false,
  },
]);
vi.mock("../src/lib/pools", () => ({
  resolvePool: (scope: string) => {
    const p = pools.find((p) => p.scope === scope);
    if (!p) throw Error("Unknown pool");
    return p;
  },
}));

import {
  formatPaymentAmount,
  requirePaymentPool,
} from "../src/lib/paymentAsset";

describe("pool-bound assets", () => {
  it("formats the pinned currency without substituting USDC", () => {
    expect(formatPaymentAmount(20_000_001n, pools[0].scope as never)).toBe(
      "20.000001 AUSD",
    );
  });
  it("separates direct transfer and request eligibility", () => {
    expect(requirePaymentPool(pools[0].scope as never, "transfer").asset).toBe(
      "AUSD",
    );
    expect(() =>
      requirePaymentPool(pools[0].scope as never, "request"),
    ).toThrow();
    expect(() =>
      requirePaymentPool(pools[1].scope as never, "transfer"),
    ).toThrow();
  });
});
