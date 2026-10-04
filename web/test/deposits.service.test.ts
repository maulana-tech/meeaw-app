import { Binary } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const POOL = "0x00000000000000000000000000000000000000B0";

const mocks = vi.hoisted(() => ({
  fetchPoolLogs: vi.fn(),
  readContract: vi.fn(),
  stateFindOne: vi.fn(),
  depositFind: vi.fn(),
  nullifierFind: vi.fn(),
}));

function cursor<T>(rows: T[]) {
  return {
    sort: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue(rows) }),
  };
}

vi.mock("../src/lib/chain", () => ({
  fetchPoolLogs: mocks.fetchPoolLogs,
  network: "eip155:10143",
  poolAddress: "0x00000000000000000000000000000000000000B0",
  poolDeployBlock: 0n,
  publicClient: { readContract: mocks.readContract },
}));

vi.mock("../src/server/db/mongo", () => ({
  getIndexerState: vi.fn(async () => ({ findOne: mocks.stateFindOne })),
  getDeposits: vi.fn(async () => ({ find: mocks.depositFind })),
  getSpentNullifiers: vi.fn(async () => ({ find: mocks.nullifierFind })),
}));

describe("getPoolSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves incremental rows below the published watermark without RPC", async () => {
    const indexedAt = new Date();
    mocks.stateFindOne.mockResolvedValue({
      _id: "pool",
      scope: `eip155:10143:${POOL.toLowerCase()}`,
      publishedBlock: 25,
      publishedLeafIndex: 4,
      indexedAt,
      health: "healthy",
    });
    mocks.depositFind.mockReturnValue(
      cursor([
        {
          _id: 4,
          commitment: new Binary(Buffer.alloc(32, 1)),
          ephemeralPk: new Binary(Buffer.alloc(32, 2)),
          ciphertext: new Binary(Buffer.alloc(40, 3)),
          block: 24,
          txHash: "0xdeposit",
          ts: indexedAt,
        },
      ]),
    );
    mocks.nullifierFind.mockReturnValue(
      cursor([
        {
          _id: "aa".repeat(32),
          block: 25,
          txHash: "0xspend",
          ts: indexedAt,
        },
      ]),
    );

    const { getPoolSnapshot } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const snapshot = await getPoolSnapshot(3, 20);

    expect(mocks.depositFind).toHaveBeenCalledWith({
      _id: { $gt: 3, $lte: 4 },
    });
    expect(mocks.nullifierFind).toHaveBeenCalledWith({
      block: { $gt: 20, $lte: 25 },
    });
    expect(snapshot.deposits).toHaveLength(1);
    expect(snapshot.spentNullifiers).toEqual([
      {
        nullifierHex: "aa".repeat(32),
        block: 25,
        ts: indexedAt.toISOString(),
      },
    ]);
    expect(snapshot.index).toMatchObject({
      poolAddress: POOL,
      network: "eip155:10143",
      publishedBlock: 25,
      health: "healthy",
    });
    expect(mocks.fetchPoolLogs).not.toHaveBeenCalled();
    expect(mocks.readContract).not.toHaveBeenCalled();
  });
});
