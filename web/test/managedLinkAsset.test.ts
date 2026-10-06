import { describe, expect, it, vi } from "vitest";

const pools = vi.hoisted(() => [
  {
    asset: "USDC",
    scope: "31337:0x1111111111111111111111111111111111111111",
    tokenDecimals: 6,
  },
  {
    asset: "AUSD",
    scope: "31337:0x2222222222222222222222222222222222222222",
    tokenDecimals: 6,
  },
]);
vi.mock("../src/lib/pools", () => ({
  activePools: () => pools,
  activePoolFor: (asset: string) =>
    pools.find((p) => p.asset === asset) ?? null,
}));

import { resolveCheckoutPool } from "../src/lib/paymentLinkAsset";

describe("managed currency binding", () => {
  it("locks open links and defaults old links to USDC", () => {
    expect(
      resolveCheckoutPool(
        { asset: "AUSD", amount: null, tokenDecimals: 6 },
        pools[0].scope as never,
      ).asset,
    ).toBe("AUSD");
    expect(
      resolveCheckoutPool({ amount: null }, pools[1].scope as never).asset,
    ).toBe("USDC");
    expect(resolveCheckoutPool(null, pools[1].scope as never).asset).toBe(
      "AUSD",
    );
    expect(() =>
      resolveCheckoutPool({ asset: "MUSD", amount: null }),
    ).toThrow();
  });
});
