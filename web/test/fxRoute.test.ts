import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/fx/route";
import { snapshotFromRates } from "../src/lib/fx";

const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../src/server/lib/fx", () => ({
  referenceRates: { read: state.read },
}));
beforeEach(() => {
  state.read.mockReset();
});
describe("public reference rates endpoint", () => {
  it("rejects user-specific query parameters before reading rates", async () => {
    const response = await GET(
      new Request("http://localhost/api/fx?amount=20&currency=IDR"),
    );
    expect(response.status).toBe(400);
    expect(state.read).not.toHaveBeenCalled();
  });
  it("returns a shared snapshot with public cache headers", async () => {
    const snapshot = snapshotFromRates([
      {
        date: new Date().toISOString().slice(0, 10),
        base: "USD",
        quote: "IDR",
        rate: 16500,
      },
    ]);
    state.read.mockResolvedValue(snapshot);
    const response = await GET(new Request("http://localhost/api/fx"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot);
    expect(response.headers.get("Cache-Control")).toMatch(/s-maxage=3\d{3}/);
    state.read.mockResolvedValue({ ...snapshot, stale: true });
    expect(
      (await GET(new Request("http://localhost/api/fx"))).headers.get(
        "Cache-Control",
      ),
    ).toBe("no-store");
  });
  it("caps downstream lifetime to the snapshot's remaining hour", async () => {
    const snapshot = snapshotFromRates([
      {
        date: new Date().toISOString().slice(0, 10),
        base: "USD",
        quote: "IDR",
        rate: 16500,
      },
    ]);
    state.read.mockResolvedValue({
      ...snapshot,
      fetchedAt: new Date(Date.now() - 3590000).toISOString(),
    });
    const response = await GET(new Request("http://localhost/api/fx"));
    expect(response.headers.get("Cache-Control")).toMatch(
      /public, max-age=\d{1,2}, s-maxage=\d{1,2}$/,
    );
  });
  it("returns a sanitized failure without caching errors", async () => {
    state.read.mockRejectedValue(new Error("private upstream detail"));
    const response = await GET(new Request("http://localhost/api/fx"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Reference rates unavailable",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
