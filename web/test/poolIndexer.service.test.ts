import { beforeEach, describe, expect, it, vi } from "vitest";

const POOL = "0x00000000000000000000000000000000000000B0";
const SCOPE = `eip155:10143:${POOL.toLowerCase()}`;

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
  poolAddress: "0x00000000000000000000000000000000000000B0",
  poolDeployBlock: 0n,
  publicClient: {
    readContract: mocks.readContract,
    getBlock: mocks.getBlock,
  },
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

describe("syncPoolIndex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateFindOneAndUpdate.mockImplementation((_filter, update) => ({
      leaseOwner: update.$set.leaseOwner,
    }));
    mocks.stateFindOne.mockResolvedValue({
      _id: "pool",
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
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("synced");
    expect(result.toBlock).toBe(12);
    expect(mocks.fetchPoolLogs).toHaveBeenCalledWith(
      expect.objectContaining({ afterBlock: 10n }),
    );
    // The completeness check reads the leaf count at the scanned block.
    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "nextIndex", blockNumber: 12n }),
    );
    expect(mocks.stateUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: "pool" }),
      expect.objectContaining({
        $set: expect.objectContaining({
          publishedBlock: 12,
          publishedLeafIndex: -1,
          health: "healthy",
        }),
      }),
    );
  });

  it("mirrors deposits with block timestamps", async () => {
    mocks.fetchPoolLogs.mockResolvedValue({
      logs: [depositLog(0, 11n), depositLog(1, 12n)],
      scannedTo: 12n,
      latestBlock: 12n,
    });
    mocks.readContract.mockResolvedValue(2);
    mocks.depositCount.mockResolvedValue(2);
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("synced");
    expect(result.depositsUpserted).toBe(2);
    const ops = mocks.depositBulkWrite.mock.calls[0][0];
    expect(ops[1].updateOne.filter).toEqual({ _id: 1 });
    expect(ops[1].updateOne.update.$set).toMatchObject({
      block: 12,
      txHash: "0x1",
      ts: new Date(1_700_000_000_000),
    });
  });

  it("keeps the published watermark unchanged on a completeness gap", async () => {
    mocks.readContract.mockResolvedValue(1);
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
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
      expect.objectContaining({ _id: "pool" }),
      expect.objectContaining({
        $set: expect.objectContaining({ health: "degraded" }),
      }),
    );
  });

  it("resets the mirror when the configured pool changes", async () => {
    mocks.stateFindOne
      .mockResolvedValueOnce({
        _id: "pool",
        scope: "eip155:10143:0xold",
        publishedBlock: 99,
      })
      .mockResolvedValue({ _id: "pool", scope: SCOPE, publishedBlock: 0 });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    await syncPoolIndex();

    expect(mocks.depositDeleteMany).toHaveBeenCalledWith({});
    expect(mocks.nullifierDeleteMany).toHaveBeenCalledWith({});
    expect(mocks.fetchPoolLogs).toHaveBeenCalledWith(
      expect.objectContaining({ afterBlock: 0n }),
    );
  });

  it("skips work when another worker owns the lease", async () => {
    mocks.stateFindOneAndUpdate.mockResolvedValue({ leaseOwner: "other" });
    const { syncPoolIndex } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const result = await syncPoolIndex();

    expect(result.status).toBe("skipped");
    expect(mocks.fetchPoolLogs).not.toHaveBeenCalled();
  });
});
