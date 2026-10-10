import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FX_CURRENCIES } from "../src/lib/fx";

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe("reference rate provider", () => {
  it("fetches a fixed list without wallet, amount, cookies or user currency", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              date: new Date().toISOString().slice(0, 10),
              base: "USD",
              quote: "IDR",
              rate: 16500,
            },
          ]),
        ),
    );
    vi.stubGlobal("fetch", fetcher);
    const { referenceRates } = await import("../src/server/lib/fx");
    const [first, second] = await Promise.all([
      referenceRates.read(),
      referenceRates.read(),
    ]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${FX_CURRENCIES.filter((code) => code !== "USD").join(",")}`,
    );
    expect(options.credentials).toBe("omit");
    expect(options.headers).toEqual({ Accept: "application/json" });
    expect(options.body).toBeUndefined();
  });
  it("rejects oversized provider output and backs off further reads", async () => {
    const fetcher = vi.fn(async () => new Response("x".repeat(64001)));
    vi.stubGlobal("fetch", fetcher);
    const { referenceRates } = await import("../src/server/lib/fx");
    await expect(referenceRates.read()).rejects.toThrow(
      "Reference rates unavailable",
    );
    await expect(referenceRates.read()).rejects.toThrow(
      "Reference rates unavailable",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
