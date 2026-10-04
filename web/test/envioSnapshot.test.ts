// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const POOL = "0x00000000000000000000000000000000000000b0";

const mocks = vi.hoisted(() => ({
  meta: vi.fn(),
  notes: vi.fn(),
  nullifiers: vi.fn(),
  stats: vi.fn(),
  getDeposits: vi.fn(),
}));

vi.mock("../src/server/lib/envio", () => ({
  envioConfigured: () => true,
  envioMeta: mocks.meta,
  envioNotesAfter: mocks.notes,
  envioNullifiersBetween: mocks.nullifiers,
  envioPoolStats: mocks.stats,
}));
vi.mock("../src/lib/chain", () => ({
  chain: { id: 10143 },
  fetchPoolLogs: vi.fn(),
  network: "eip155:10143",
  poolAddress: "0x00000000000000000000000000000000000000B0",
  poolDeployBlock: 0n,
  publicClient: { readContract: vi.fn() },
}));
vi.mock("../src/lib/pools", () => {
  const active = {
    scope: "10143:0x00000000000000000000000000000000000000b0",
    chainId: 10143,
    address: "0x00000000000000000000000000000000000000b0",
    deployBlock: 0,
    token: "0x00000000000000000000000000000000000000d0",
    tokenDecimals: 6,
    depth: 20,
    confirmations: 1,
    role: "active",
    requestCapable: true,
  };
  return {
    activePool: () => active,
    listPools: () => [active],
    findPool: (scope: string) => (scope === active.scope ? active : null),
  };
});
vi.mock("../src/server/db/mongo", () => ({
  getDeposits: mocks.getDeposits,
  getIndexerState: vi.fn(),
  getSpentNullifiers: vi.fn(),
}));

import {
  getPoolSnapshot,
  getPoolStats,
  syncPoolIndex,
} from "../src/server/modules/deposits/deposits.service";

const note = (leafIndex: number, blockNumber = 100) => ({
  leafIndex,
  commitment: `0x${"AB".repeat(32)}`,
  ephemeralPk: `0x${"cd".repeat(32)}`,
  ciphertext: "0xdeadbeef",
  blockNumber,
  timestamp: 1_760_000_000,
  txHash: `0x${leafIndex.toString(16).padStart(64, "0")}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.meta.mockResolvedValue({
    chainId: 10143,
    progressBlock: 120,
    progressBlockTime: Math.floor(Date.now() / 1000),
    isReady: true,
  });
  mocks.notes.mockResolvedValue([]);
  mocks.nullifiers.mockResolvedValue([]);
});

describe("Envio-backed pool snapshot", () => {
  it("serves notes and spends up to Envio's progress block", async () => {
    mocks.notes.mockResolvedValue([note(3), note(4)]);
    mocks.nullifiers.mockResolvedValue([
      { id: "aa".repeat(32), blockNumber: 110, timestamp: 1_760_000_100 },
    ]);

    const snapshot = await getPoolSnapshot(2, 50);

    expect(mocks.notes).toHaveBeenCalledWith(2, 120);
    expect(mocks.nullifiers).toHaveBeenCalledWith(50, 120);
    expect(snapshot.deposits.map((d) => d.leafIndex)).toEqual([3, 4]);
    // Hex leaves the server without 0x and lowercased, like the RPC mirror.
    expect(snapshot.deposits[0]).toMatchObject({
      commitmentHex: "ab".repeat(32),
      ciphertextHex: "deadbeef",
      block: 100,
    });
    expect(snapshot.spentNullifiers).toEqual([
      {
        nullifierHex: "aa".repeat(32),
        block: 110,
        ts: new Date(1_760_000_100_000).toISOString(),
      },
    ]);
    expect(snapshot.index).toMatchObject({
      poolAddress: POOL,
      network: "eip155:10143",
      publishedBlock: 120,
      publishedLeafIndex: 4,
      health: "healthy",
    });
  });

  it("publishes only the contiguous prefix when a leaf is missing", async () => {
    mocks.notes.mockResolvedValue([note(0), note(1), note(3)]);
    const snapshot = await getPoolSnapshot(-1, 50);

    expect(snapshot.deposits.map((d) => d.leafIndex)).toEqual([0, 1]);
    expect(snapshot.index.publishedLeafIndex).toBe(1);
    // The spend watermark must not advance past data we did not publish.
    expect(snapshot.index.publishedBlock).toBe(50);
    expect(snapshot.index.health).toBe("degraded");
  });

  it("keeps the watermark when there is nothing new", async () => {
    const snapshot = await getPoolSnapshot(7, 0);
    expect(snapshot.deposits).toEqual([]);
    expect(snapshot.index.publishedLeafIndex).toBe(7);
  });

  it("reports degraded health while Envio is still syncing", async () => {
    mocks.meta.mockResolvedValue({
      chainId: 10143,
      progressBlock: 40,
      progressBlockTime: null,
      isReady: false,
    });
    const snapshot = await getPoolSnapshot(-1, 0);
    expect(snapshot.index.health).toBe("degraded");
  });

  it("returns an empty, degraded snapshot when Envio has no chain metadata", async () => {
    mocks.meta.mockResolvedValue(null);
    const snapshot = await getPoolSnapshot(-1, 0);
    expect(snapshot.deposits).toEqual([]);
    expect(snapshot.index).toMatchObject({
      publishedBlock: 0,
      publishedLeafIndex: -1,
      health: "degraded",
    });
    expect(mocks.notes).not.toHaveBeenCalled();
  });

  it("marks the snapshot stale when Envio has not progressed recently", async () => {
    mocks.meta.mockResolvedValue({
      chainId: 10143,
      progressBlock: 120,
      progressBlockTime: new Date(Date.now() - 10 * 60_000).toISOString(),
      isReady: true,
    });
    const snapshot = await getPoolSnapshot(-1, 0);
    expect(snapshot.index.health).toBe("stale");
  });
});

describe("Envio pool stats", () => {
  it("exposes the anonymity set from the indexer aggregates", async () => {
    mocks.stats.mockResolvedValue({
      notes: 10,
      spent: 3,
      anonymitySet: 7,
      withdrawals: 2,
      shieldedTransfers: 1,
      totalWithdrawn: "5000000",
      accounts: 4,
      paused: false,
      updatedAt: 1,
    });
    await expect(getPoolStats()).resolves.toEqual({
      source: "envio",
      notes: 10,
      spent: 3,
      anonymitySet: 7,
      withdrawals: 2,
      shieldedTransfers: 1,
      accounts: 4,
      paused: false,
    });
  });

  it("skips the RPC poller entirely when Envio is the mirror", async () => {
    const result = await syncPoolIndex();
    expect(result.status).toBe("skipped");
    expect(mocks.getDeposits).not.toHaveBeenCalled();
  });
});
