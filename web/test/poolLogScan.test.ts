import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPoolLogs, publicClient } from "../src/lib/chain";

afterEach(() => vi.restoreAllMocks());

describe("pool log scan", () => {
  it("bounds concurrent requests and preserves contiguous chunk watermarks", async () => {
    vi.spyOn(publicClient, "getBlockNumber").mockResolvedValue(1_000n);
    let active = 0;
    let peak = 0;
    const getLogs = vi
      .spyOn(publicClient, "getLogs")
      .mockImplementation(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return [];
      });
    const result = await fetchPoolLogs({
      afterBlock: 0n,
      blockRange: 100,
      maxChunks: 6,
    });
    expect(peak).toBe(4);
    expect(
      getLogs.mock.calls.map(([input]) => [input.fromBlock, input.toBlock]),
    ).toEqual([
      [1n, 100n],
      [101n, 200n],
      [201n, 300n],
      [301n, 400n],
      [401n, 500n],
      [501n, 600n],
    ]);
    expect(result).toMatchObject({
      scannedTo: 600n,
      latestBlock: 1_000n,
      logs: [],
    });
  });

  it("rejects a failed chunk instead of returning a watermark over missing logs", async () => {
    vi.spyOn(publicClient, "getBlockNumber").mockResolvedValue(500n);
    vi.spyOn(publicClient, "getLogs").mockImplementation(async (input) => {
      if (input.fromBlock === 101n) throw new Error("RPC unavailable");
      return [];
    });
    await expect(
      fetchPoolLogs({ afterBlock: 0n, blockRange: 100, maxChunks: 4 }),
    ).rejects.toThrow("RPC unavailable");
  });
});
