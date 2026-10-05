import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
}));

vi.mock("../src/trpc/client", () => ({
  api: { deposits: { snapshot: { query: mocks.snapshot } } },
}));

const ACTIVE = {
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
} as const;
const LEGACY = {
  ...ACTIVE,
  scope: "10143:0x00000000000000000000000000000000000000c0",
  address: "0x00000000000000000000000000000000000000c0",
  role: "legacy",
  requestCapable: false,
} as const;

vi.mock("../src/lib/pools", () => ({
  activePool: () => ACTIVE,
  mirrorScope: (p: { chainId: number; address: string }) =>
    `eip155:${p.chainId}:${p.address}`,
}));

function response(
  leafIndex: number,
  publishedBlock: number,
  nullifierHex: string,
  poolAddress: string = ACTIVE.address,
) {
  return {
    deposits: [
      {
        leafIndex,
        commitmentHex: "01".repeat(32),
        ephemeralPkHex: "02".repeat(32),
        ciphertextHex: "03".repeat(40),
        block: publishedBlock,
        txHash: `tx-${leafIndex}`,
        ts: new Date().toISOString(),
      },
    ],
    spentNullifiers: [
      {
        nullifierHex,
        block: publishedBlock,
        ts: new Date(2026, 7, leafIndex + 1).toISOString(),
      },
    ],
    index: {
      poolAddress,
      network: "eip155:10143",
      publishedBlock,
      publishedLeafIndex: leafIndex,
      indexedAt: new Date().toISOString(),
      health: "healthy" as const,
    },
  };
}

describe("poolMirror", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.snapshot.mockReset();
  });

  it("requests and merges only changes after its local watermarks", async () => {
    const firstNullifier = "aa".repeat(32);
    const secondNullifier = "bb".repeat(32);
    mocks.snapshot
      .mockResolvedValueOnce(response(0, 10, firstNullifier))
      .mockResolvedValueOnce(response(1, 12, secondNullifier));

    const { refreshPoolMirror } = await import("../src/lib/poolMirror");
    const first = await refreshPoolMirror();
    const second = await refreshPoolMirror();

    expect(mocks.snapshot).toHaveBeenNthCalledWith(1, {
      pool: ACTIVE.scope,
      afterLeafIndex: -1,
      spentAfterBlock: 0,
    });
    expect(mocks.snapshot).toHaveBeenNthCalledWith(2, {
      pool: ACTIVE.scope,
      afterLeafIndex: 0,
      spentAfterBlock: 10,
    });
    expect(first.deposits).toHaveLength(1);
    expect(second.deposits.map((row) => row.leafIndex)).toEqual([0, 1]);
    expect(second.spentNullifiers).toEqual([firstNullifier, secondNullifier]);
    expect(second.spentAtByNullifier).toMatchObject({
      [firstNullifier]: new Date(2026, 7, 1).toISOString(),
      [secondNullifier]: new Date(2026, 7, 2).toISOString(),
    });
  });

  it("deduplicates concurrent refreshes", async () => {
    let resolveRequest!: (value: ReturnType<typeof response>) => void;
    mocks.snapshot.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { refreshPoolMirror } = await import("../src/lib/poolMirror");

    const first = refreshPoolMirror();
    const second = refreshPoolMirror();
    resolveRequest(response(0, 10, "aa".repeat(32)));

    expect(await first).toEqual(await second);
    expect(mocks.snapshot).toHaveBeenCalledTimes(1);
  });

  it("keeps a separate mirror per pool, so equal leaf indices never mix", async () => {
    mocks.snapshot
      .mockResolvedValueOnce(response(0, 10, "aa".repeat(32)))
      .mockResolvedValueOnce(response(0, 7, "bb".repeat(32), LEGACY.address));
    const { refreshPoolMirror, loadPoolMirror } = await import(
      "../src/lib/poolMirror"
    );
    await refreshPoolMirror(ACTIVE);
    await refreshPoolMirror(LEGACY);

    expect(mocks.snapshot).toHaveBeenLastCalledWith({
      pool: LEGACY.scope,
      afterLeafIndex: -1,
      spentAfterBlock: 0,
    });
    const active = await loadPoolMirror(ACTIVE);
    const legacy = await loadPoolMirror(LEGACY);
    expect(active.scope).toBe(`eip155:10143:${ACTIVE.address}`);
    expect(legacy.scope).toBe(`eip155:10143:${LEGACY.address}`);
    expect(active.spentNullifiers).toEqual(["aa".repeat(32)]);
    expect(legacy.spentNullifiers).toEqual(["bb".repeat(32)]);
  });

  it("refuses a snapshot that answers for another pool", async () => {
    mocks.snapshot.mockResolvedValueOnce(
      response(0, 10, "aa".repeat(32), ACTIVE.address),
    );
    const { refreshPoolMirror, loadPoolMirror } = await import(
      "../src/lib/poolMirror"
    );
    await expect(refreshPoolMirror(LEGACY)).rejects.toThrow("different pool");
    expect((await loadPoolMirror(LEGACY)).deposits).toEqual([]);
  });
});
