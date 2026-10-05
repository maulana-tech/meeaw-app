import { beforeEach, describe, expect, it, vi } from "vitest";

const pools = vi.hoisted(() => {
  const base = {
    chainId: 10143,
    deployBlock: 0,
    token: "0x00000000000000000000000000000000000000d0",
    tokenDecimals: 6,
    depth: 20,
    confirmations: 1,
  } as const;
  const active = {
    ...base,
    scope: "10143:0x00000000000000000000000000000000000000b0",
    address: "0x00000000000000000000000000000000000000b0",
    role: "active",
    requestCapable: true,
  } as const;
  const legacy = {
    ...base,
    scope: "10143:0x00000000000000000000000000000000000000c0",
    address: "0x00000000000000000000000000000000000000c0",
    deployBlock: 3,
    role: "legacy",
    requestCapable: false,
  } as const;
  return { active, legacy, all: [active, legacy] };
});
const SCOPE = pools.active.scope;
const STATE_ID = `pool:${SCOPE}`;

const mocks = vi.hoisted(() => ({
  fetchPoolLogs: vi.fn(),
  readContract: vi.fn(),
  getBlock: vi.fn(),
  stateFindOneAndUpdate: vi.fn(),
  stateFindOne: vi.fn(),
  stateUpdateOne: vi.fn(),
  depositBulkWrite: vi.fn(),
  depositCount: vi.fn(),
  depositDeleteMany: vi.fn(),
  nullifierBulkWrite: vi.fn(),
  nullifierDeleteMany: vi.fn(),
}));

vi.mock("../src/lib/chain", () => ({
  fetchPoolLogs: mocks.fetchPoolLogs,
  network: "eip155:10143",
  publicClient: {
    readContract: mocks.readContract,
    getBlock: mocks.getBlock,
  },
}));

vi.mock("../src/lib/pools", () => ({
  activePool: () => pools.active,
  listPools: () => pools.all,
  findPool: (scope: string) => pools.all.find((p) => p.scope === scope) ?? null,
}));

vi.mock("../src/server/db/mongo", () => ({
  getIndexerState: vi.fn(async () => ({
    findOneAndUpdate: mocks.stateFindOneAndUpdate,
    findOne: mocks.stateFindOne,
    updateOne: mocks.stateUpdateOne,
  })),
  getDeposits: vi.fn(async () => ({
    bulkWrite: mocks.depositBulkWrite,
    countDocuments: mocks.depositCount,
    deleteMany: mocks.depositDeleteMany,
  })),
  getSpentNullifiers: vi.fn(async () => ({
    bulkWrite: mocks.nullifierBulkWrite,
    deleteMany: mocks.nullifierDeleteMany,
  })),
}));

const depositLog = (leafIndex: number, block: bigint) => ({
  kind: "deposit",
  blockNumber: block,
  txHash: `0x${leafIndex}`,
  logIndex: 0,
  deposit: {
    leafIndex,
    commitment: new Uint8Array(32),
    ephemeralPk: new Uint8Array(32),
    ciphertext: new Uint8Array(4),
  },
});

const spendLog = (block: bigint) => ({
  kind: "spend",
  blockNumber: block,
  txHash: "0xspend",
  logIndex: 1,
  spent: { nullifierHex: "ab".repeat(32) },
});

async function service() {
  return import("../src/server/modules/deposits/deposits.service");
}

describe("syncPoolIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateFindOneAndUpdate.mockImplementation((_filter, update) => ({
      leaseOwner: update.$set.leaseOwner,
    }));
    mocks.stateFindOne.mockResolvedValue({
      _id: STATE_ID,
      scope: SCOPE,
      publishedBlock: 10,
      publishedLeafIndex: -1,
    });
    mocks.stateUpdateOne.mockResolvedValue({ acknowledged: true });
    mocks.fetchPoolLogs.mockResolvedValue({
      logs: [],
      scannedTo: 12n,
      latestBlock: 12n,
    });
    mocks.readContract.mockResolvedValue(0);
    mocks.depositCount.mockResolvedValue(0);
    mocks.getBlock.mockResolvedValue({ timestamp: 1_700_000_000n });
  });

  it("publishes a new watermark only after completeness succeeds", async () => {
    const { syncPoolIndex } = await service();
    const result = await syncPoolIndex();

    expect(result.status).toBe("synced");
    expect(result.pool).toBe(SCOPE);
    expect(result.toBlock).toBe(12);
    expect(mocks.fetchPoolLogs).toHaveBeenCalledWith(
      expect.objectContaining({ afterBlock: 10n, pool: pools.active }),
    );
    // The completeness check reads this pool's leaf count at the scanned block.
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: pools.active.address,
        functionName: "nextIndex",
        blockNumber: 12n,
      }),
    );
    expect(mocks.depositCount).toHaveBeenCalledWith({
      scope: SCOPE,
      block: { $lte: 12 },
    });
    expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: STATE_ID }),
      expect.objectContaining({
        $set: expect.objectContaining({
          scope: SCOPE,
          publishedBlock: 12,
          publishedLeafIndex: -1,
          health: "healthy",
        }),
      }),
    );
  });

  it("renews its lease while a slow RPC batch is still running", async () => {
    vi.useFakeTimers();
    let finish!: (result: {
      logs: never[];
      scannedTo: bigint;
      latestBlock: bigint;
    }) => void;
    mocks.fetchPoolLogs.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    try {
      const { syncPoolIndex } = await service();
      const pending = syncPoolIndex();
      await vi.advanceTimersByTimeAsync(60_000);
      const renewals = mocks.stateUpdateOne.mock.calls.filter(
        ([, update]) => update.$set?.leaseUntil,
      );
      expect(renewals.length).toBeGreaterThan(0);
      expect(renewals.at(-1)?.[1].$set.leaseUntil.getTime()).toBeGreaterThan(
        Date.now(),
      );
      finish({ logs: [], scannedTo: 12n, latestBlock: 12n });
      expect((await pending).status).toBe("synced");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      finish?.({ logs: [], scannedTo: 12n, latestBlock: 12n });
      vi.useRealTimers();
    }
  });

  it("mirrors deposits and spends under scoped composite ids", async () => {
    mocks.fetchPoolLogs.mockResolvedValue({
      logs: [depositLog(0, 11n), depositLog(1, 12n), spendLog(12n)],
      scannedTo: 12n,
      latestBlock: 12n,
    });
    mocks.readContract.mockResolvedValue(2);
    mocks.depositCount.mockResolvedValue(2);
    const { syncPoolIndex } = await service();
    const result = await syncPoolIndex();

    expect(result.status).toBe("synced");
    expect(result.depositsUpserted).toBe(2);
    const ops = mocks.depositBulkWrite.mock.calls[0][0];
    expect(ops[1].updateOne.filter).toEqual({ _id: `${SCOPE}:1` });
    expect(ops[1].updateOne.update.$set).toMatchObject({
      scope: SCOPE,
      leafIndex: 1,
      block: 12,
      txHash: "0x1",
      ts: new Date(1_700_000_000_000),
    });
    const spends = mocks.nullifierBulkWrite.mock.calls[0][0];
    expect(spends[0].updateOne.filter).toEqual({
      _id: `${SCOPE}:${"ab".repeat(32)}`,
    });
    expect(spends[0].updateOne.update.$set).toMatchObject({
      scope: SCOPE,
      nullifierHex: "ab".repeat(32),
    });
  });

  it("does not report success when the lease is lost before publication", async () => {
    mocks.stateUpdateOne.mockResolvedValue({
      acknowledged: true,
      matchedCount: 0,
    });
    const { syncPoolIndex } = await service();
    const result = await syncPoolIndex();
    expect(result.status).toBe("degraded");
    expect(result.error).toContain("lease was lost before publication");
  });

  it("keeps the published watermark unchanged on a completeness gap", async () => {
    mocks.readContract.mockResolvedValue(1);
    const { syncPoolIndex } = await service();
    const result = await syncPoolIndex();

    expect(result.status).toBe("degraded");
    expect(result.toBlock).toBe(10);
    expect(mocks.stateUpdateOne).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ publishedBlock: 12 }),
      }),
    );
    expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: STATE_ID }),
      expect.objectContaining({
        $set: expect.objectContaining({ health: "degraded" }),
      }),
    );
  });

  it("starts a new pool from its deploy block and never deletes other pool rows", async () => {
    mocks.stateFindOne.mockResolvedValue(null);
    const { syncPoolIndex } = await service();
    await syncPoolIndex(pools.legacy);

    expect(mocks.depositDeleteMany).not.toHaveBeenCalled();
    expect(mocks.nullifierDeleteMany).not.toHaveBeenCalled();
    expect(mocks.stateFindOne).toHaveBeenCalledWith({
      _id: `pool:${pools.legacy.scope}`,
    });
    expect(mocks.fetchPoolLogs).toHaveBeenCalledWith(
      expect.objectContaining({ afterBlock: 2n, pool: pools.legacy }),
    );
  });

  it("syncs every configured pool under its own lease", async () => {
    const { syncAllPoolIndexes } = await service();
    const result = await syncAllPoolIndexes();

    expect(result.status).toBe("synced");
    expect(result.pools.map((r) => r.pool)).toEqual([
      pools.active.scope,
      pools.legacy.scope,
    ]);
    expect(
      mocks.stateFindOneAndUpdate.mock.calls.map(([filter]) => filter._id),
    ).toEqual([`pool:${pools.active.scope}`, `pool:${pools.legacy.scope}`]);
  });

  it("skips work when another worker owns the lease", async () => {
    mocks.stateFindOneAndUpdate.mockResolvedValue({ leaseOwner: "other" });
    const { syncPoolIndex } = await service();
    const result = await syncPoolIndex();

    expect(result.status).toBe("skipped");
    expect(mocks.fetchPoolLogs).not.toHaveBeenCalled();
  });
  it("skips an undeployed pool without acquiring a lease or scanning genesis", async () => {
    const { syncPoolIndex } = await service();
    const result = await syncPoolIndex({
      ...pools.active,
      address: "0x0000000000000000000000000000000000000000",
    });
    expect(result.status).toBe("skipped");
    expect(mocks.stateFindOneAndUpdate).not.toHaveBeenCalled();
    expect(mocks.fetchPoolLogs).not.toHaveBeenCalled();
  });
});
