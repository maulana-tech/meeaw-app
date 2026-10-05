// @vitest-environment node
// The RPC fallback mirror must understand merges (one Deposit and two Spend
// events in one transaction) and keep equal leaf indices/nullifiers of
// different pools apart. Public queries accept only manifest scopes.
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
    role: "legacy",
    requestCapable: false,
  } as const;
  return { active, legacy, all: [active, legacy] };
});

const mocks = vi.hoisted(() => ({
  fetchPoolLogs: vi.fn(),
  readContract: vi.fn(),
  getBlock: vi.fn(),
  depositWrites: [] as unknown[],
  nullifierWrites: [] as unknown[],
  countDocuments: vi.fn(),
}));

vi.mock("../src/env.server", () => ({
  getServerEnv: () => ({ MONAD_LOGS_BLOCK_RANGE: 100 }),
}));
vi.mock("../src/server/lib/envio", () => ({
  envioConfigured: () => false,
}));
vi.mock("../src/lib/chain", () => ({
  chain: { id: 10143 },
  fetchPoolLogs: mocks.fetchPoolLogs,
  network: "eip155:10143",
  publicClient: { readContract: mocks.readContract, getBlock: mocks.getBlock },
  registryAddress: "0x00000000000000000000000000000000000000e0",
}));
vi.mock("../src/lib/pools", () => ({
  activePool: () => pools.active,
  listPools: () => pools.all,
  findPool: (scope: string) => pools.all.find((p) => p.scope === scope) ?? null,
}));
vi.mock("../src/server/db/mongo", () => {
  const states = {
    findOneAndUpdate: vi.fn(async (_filter, update) => ({
      leaseOwner: update.$set.leaseOwner,
    })),
    findOne: vi.fn(async () => null),
    updateOne: vi.fn(async () => ({})),
  };
  return {
    getIndexerState: vi.fn(async () => states),
    getDeposits: vi.fn(async () => ({
      bulkWrite: vi.fn(async (ops: unknown[]) => {
        mocks.depositWrites.push(...ops);
      }),
      countDocuments: mocks.countDocuments,
    })),
    getSpentNullifiers: vi.fn(async () => ({
      bulkWrite: vi.fn(async (ops: unknown[]) => {
        mocks.nullifierWrites.push(...ops);
      }),
    })),
  };
});

import {
  poolSnapshotInput,
  poolStatsInput,
} from "../src/server/modules/deposits/deposits.schema";
import { syncPoolIndex } from "../src/server/modules/deposits/deposits.service";

const NULL_A = "aa".repeat(32);
const NULL_B = "bb".repeat(32);

function mergeLogs(tx: string) {
  return [
    {
      blockNumber: 10n,
      txHash: tx,
      kind: "deposit",
      deposit: {
        leafIndex: 0,
        commitment: new Uint8Array(32).fill(1),
        ephemeralPk: new Uint8Array(32).fill(2),
        ciphertext: new Uint8Array(48).fill(3),
      },
    },
    { blockNumber: 10n, txHash: tx, kind: "spend", spent: { nullifierHex: NULL_A } },
    { blockNumber: 10n, txHash: tx, kind: "spend", spent: { nullifierHex: NULL_B } },
  ];
}

type UpsertOp = {
  updateOne: { filter: { _id: string }; update: { $set: { scope: string } } };
};
const ids = (ops: unknown[]) => (ops as UpsertOp[]).map((o) => o.updateOne.filter._id);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.depositWrites.length = 0;
  mocks.nullifierWrites.length = 0;
  mocks.getBlock.mockResolvedValue({ timestamp: 1_760_000_000n });
  mocks.readContract.mockResolvedValue(1);
  mocks.countDocuments.mockResolvedValue(1);
});

describe("RPC fallback mirror", () => {
  it("records a merge as one note and two spent nullifiers in its pool", async () => {
    mocks.fetchPoolLogs.mockResolvedValue({
      logs: mergeLogs("0xmerge"),
      scannedTo: 10n,
      latestBlock: 10n,
    });

    const result = await syncPoolIndex(pools.active);

    expect(result).toMatchObject({
      status: "synced",
      depositsUpserted: 1,
      nullifiersUpserted: 2,
    });
    expect(ids(mocks.depositWrites)).toEqual([`${pools.active.scope}:0`]);
    expect(ids(mocks.nullifierWrites)).toEqual([
      `${pools.active.scope}:${NULL_A}`,
      `${pools.active.scope}:${NULL_B}`,
    ]);
    expect(mocks.fetchPoolLogs).toHaveBeenCalledWith(
      expect.objectContaining({ pool: pools.active }),
    );
  });

  it("keeps the same leaf index and nullifier in two pools apart", async () => {
    mocks.fetchPoolLogs.mockImplementation(async () => ({
      logs: mergeLogs("0xsame"),
      scannedTo: 10n,
      latestBlock: 10n,
    }));

    await syncPoolIndex(pools.active);
    await syncPoolIndex(pools.legacy);

    const depositIds = ids(mocks.depositWrites);
    expect(depositIds).toEqual([
      `${pools.active.scope}:0`,
      `${pools.legacy.scope}:0`,
    ]);
    expect(new Set(ids(mocks.nullifierWrites)).size).toBe(4);
    const scopes = (mocks.depositWrites as UpsertOp[]).map(
      (o) => o.updateOne.update.$set.scope,
    );
    expect(scopes).toEqual([pools.active.scope, pools.legacy.scope]);
  });
});

describe("public pool query inputs", () => {
  it("accept only a normalized chain:address scope", () => {
    const scope = pools.legacy.scope;
    expect(poolSnapshotInput.parse({ pool: scope })?.pool).toBe(scope);
    expect(poolStatsInput.parse({ pool: scope })?.pool).toBe(scope);
    for (const bad of [
      "0x00000000000000000000000000000000000000c0",
      "10143:0x00000000000000000000000000000000000000C0",
      "10143:c0",
      "x:0x00000000000000000000000000000000000000c0",
    ]) {
      expect(poolSnapshotInput.safeParse({ pool: bad }).success).toBe(false);
      expect(poolStatsInput.safeParse({ pool: bad }).success).toBe(false);
    }
  });
});
