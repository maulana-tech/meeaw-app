import { describe, expect, it, vi } from "vitest";
import {
  currencyForLocale,
  fxEstimateText,
  parseFxSnapshot,
  snapshotFromRates,
} from "../src/lib/fx";
import { createFxCache } from "../src/lib/fxCache";

const now = Date.UTC(2026, 9, 11);
const rows = [{ date: "2026-10-10", base: "USD", quote: "IDR", rate: 16500 }];
const snapshot = () => snapshotFromRates(rows, now);
describe("reference FX", () => {
  it("maps locales without inventing unsupported currencies", () => {
    expect(currencyForLocale("id-ID")).toBe("IDR");
    expect(currencyForLocale("en-US")).toBe("USD");
    expect(currencyForLocale("fr-FR")).toBe("EUR");
    expect(currencyForLocale("zh-CN")).toBeNull();
  });
  it("calculates only a display estimate from fetched quotes", () => {
    expect(
      fxEstimateText("325", "IDR", snapshot(), "id-ID", now)?.replace(
        /\s/g,
        " ",
      ),
    ).toBe("≈ Rp 5.362.500");
    expect(fxEstimateText("325", "USD", snapshot(), "en-US", now)).toBeNull();
    expect(fxEstimateText("325", "EUR", snapshot(), "fr-FR", now)).toBeNull();
  });
  it.each([
    "",
    "@1",
    "-1",
    "0",
    "1e5",
    "1,5",
    "1.1234567",
    "18446744073709.551616",
  ])("hides invalid amount %s", (amount) => {
    expect(fxEstimateText(amount, "IDR", snapshot(), "id-ID", now)).toBeNull();
  });
  it("rejects malformed, duplicate, future and expired rates", () => {
    for (const change of [
      { base: "EUR" },
      { quote: "XYZ" },
      { rate: -1 },
      { rate: Infinity },
      { date: "2026-02-30" },
      { date: "2026-10-12" },
      { date: "2026-10-03" },
    ]) {
      expect(() =>
        snapshotFromRates([{ ...rows[0], ...change }], now),
      ).toThrow();
    }
    expect(() => snapshotFromRates([...rows, ...rows], now)).toThrow();
    expect(() =>
      parseFxSnapshot({ ...snapshot(), source: "demo" }, now),
    ).toThrow();
    expect(
      fxEstimateText("1", "IDR", snapshot(), "id-ID", now + 8 * 86400000),
    ).toBeNull();
  });
});
describe("FX cache", () => {
  it("does not renew freshness when receiving an already-aged snapshot", async () => {
    let time = now + 3590000;
    const load = vi.fn(async () => snapshot());
    const cache = createFxCache(load, () => time);
    expect((await cache.read()).stale).toBe(false);
    time += 10000;
    expect((await cache.read()).stale).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    await cache.read();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("deduplicates readers and reuses rates for an hour", async () => {
    let time = now;
    const load = vi.fn(async () => snapshot());
    const cache = createFxCache(load, () => time);
    await Promise.all([cache.read(), cache.read(), cache.read()]);
    expect(load).toHaveBeenCalledTimes(1);
    time += 3599999;
    await cache.read();
    expect(load).toHaveBeenCalledTimes(1);
    time += 1;
    await cache.read();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("labels fallback and backs off without keeping expired rates", async () => {
    let time = now;
    const load = vi.fn(async () => snapshot());
    const cache = createFxCache(load, () => time);
    await cache.read();
    load.mockRejectedValue(new Error("upstream down"));
    time += 3600000;
    expect((await cache.read()).stale).toBe(true);
    await cache.read();
    expect(load).toHaveBeenCalledTimes(2);
    time += 30000;
    await cache.read();
    expect(load).toHaveBeenCalledTimes(3);
    time += 8 * 86400000;
    await expect(cache.read()).rejects.toThrow("Reference rates unavailable");
  });
  it("backs off even without a previous quote", async () => {
    const load = vi.fn(async () => {
      throw new Error("down");
    });
    const cache = createFxCache(load, () => now);
    await expect(cache.read()).rejects.toThrow("Reference rates unavailable");
    await expect(cache.read()).rejects.toThrow("Reference rates unavailable");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
