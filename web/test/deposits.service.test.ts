import { Binary } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const POOL = "0x00000000000000000000000000000000000000b0";
const OLD_POOL = "0x00000000000000000000000000000000000000c0";

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
    role: "legacy",
    requestCapable: false,
  } as const;
  return { active, legacy, all: [active, legacy] };
});

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
  publicClient: { readContract: mocks.readContract },
}));

vi.mock("../src/lib/pools", () => ({
  activePool: () => pools.active,
  listPools: () => pools.all,
  findPool: (scope: string) => pools.all.find((p) => p.scope === scope) ?? null,
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

  function seed(scope: string, address: string) {
    const indexedAt = new Date();
    mocks.stateFindOne.mockResolvedValue({
      _id: `pool:${scope}`,
      scope,
      publishedBlock: 25,
      publishedLeafIndex: 4,
      indexedAt,
      health: "healthy",
    });
    mocks.depositFind.mockReturnValue(
      cursor([
        {
          _id: `${scope}:4`,
          scope,
          leafIndex: 4,
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
          _id: `${scope}:${"aa".repeat(32)}`,
          scope,
          nullifierHex: "aa".repeat(32),
          block: 25,
          txHash: "0xspend",
          ts: indexedAt,
        },
      ]),
    );
    return { indexedAt, address };
  }

  it("serves incremental rows below the published watermark without RPC", async () => {
    const { indexedAt } = seed(pools.active.scope, POOL);
    const { getPoolSnapshot } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const snapshot = await getPoolSnapshot(3, 20);

    expect(mocks.stateFindOne).toHaveBeenCalledWith({
      _id: `pool:${pools.active.scope}`,
    });
    expect(mocks.depositFind).toHaveBeenCalledWith({
      scope: pools.active.scope,
      leafIndex: { $gt: 3, $lte: 4 },
    });
    expect(mocks.nullifierFind).toHaveBeenCalledWith({
      scope: pools.active.scope,
      block: { $gt: 20, $lte: 25 },
    });
    expect(snapshot.deposits.map((d) => d.leafIndex)).toEqual([4]);
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

  it("serves a legacy pool from its own rows and watermark", async () => {
    seed(pools.legacy.scope, OLD_POOL);
    const { getPoolSnapshot } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const snapshot = await getPoolSnapshot(3, 20, pools.legacy.scope);

    expect(mocks.stateFindOne).toHaveBeenCalledWith({
      _id: `pool:${pools.legacy.scope}`,
    });
    expect(mocks.depositFind).toHaveBeenCalledWith({
      scope: pools.legacy.scope,
      leafIndex: { $gt: 3, $lte: 4 },
    });
    expect(snapshot.index.poolAddress).toBe(OLD_POOL);
  });

  it("rejects a pool that is not in the manifest", async () => {
    const { getPoolSnapshot } = await import(
      "../src/server/modules/deposits/deposits.service"
    );
    const { UnknownPoolError } = await import(
      "../src/server/modules/deposits/deposits.errors"
    );
    await expect(
      getPoolSnapshot(
        -1,
        0,
        "10143:0x00000000000000000000000000000000000000ee",
      ),
    ).rejects.toBeInstanceOf(UnknownPoolError);
    expect(mocks.depositFind).not.toHaveBeenCalled();
  });
});
