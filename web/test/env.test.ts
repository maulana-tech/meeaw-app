import { describe, expect, it } from "vitest";
import { publicEnvSchema } from "../src/env";
import { serverEnvSchema } from "../src/env.server";

describe("environment schemas", () => {
  it("normalizes public defaults and typed numeric values", () => {
    const parsed = publicEnvSchema.parse({
      NODE_ENV: "test",
      NEXT_PUBLIC_POOL_DEPTH: "24",
      NEXT_PUBLIC_MONAD_RPC_URL: "",
      NEXT_PUBLIC_USDC_MINTABLE: "true",
    });

    expect(parsed.NEXT_PUBLIC_POOL_DEPTH).toBe(24);
    expect(parsed.NEXT_PUBLIC_MONAD_RPC_URL).toBeUndefined();
    expect(parsed.NEXT_PUBLIC_MONAD_CHAIN_ID).toBe(10143);
    expect(parsed.NEXT_PUBLIC_USDC_DECIMALS).toBe(6);
    expect(parsed.NEXT_PUBLIC_USDC_MINTABLE).toBe(true);
  });

  it("rejects malformed public URLs, addresses and numeric ranges", () => {
    expect(() =>
      publicEnvSchema.parse({ NEXT_PUBLIC_MONAD_RPC_URL: "not-a-url" }),
    ).toThrow();
    expect(() =>
      publicEnvSchema.parse({ NEXT_PUBLIC_MAWEE_POOL_ADDRESS: "0x1234" }),
    ).toThrow();
    expect(() =>
      publicEnvSchema.parse({ NEXT_PUBLIC_POOL_DEPTH: "0" }),
    ).toThrow();
  });

  it("keeps blank optional secrets absent and validates server numbers", () => {
    const parsed = serverEnvSchema.parse({
      NODE_ENV: "test",
      PRIVY_APP_SECRET: "  ",
    });
    expect(parsed.PRIVY_APP_SECRET).toBeUndefined();
    expect(parsed.MONAD_LOGS_BLOCK_RANGE).toBe(100);

    expect(() =>
      serverEnvSchema.parse({ MONAD_LOGS_BLOCK_RANGE: "0" }),
    ).toThrow();
  });
});
