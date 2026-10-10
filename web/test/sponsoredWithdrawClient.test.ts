import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  admit: vi.fn(),
  finish: vi.fn(),
  withdraw: vi.fn(),
  prove: vi.fn(),
}));
vi.mock("../src/lib/chain", () => ({
  gaslessEnabled: async () => true,
  isEvmAddress: (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v),
  revertErrorName: () => null,
  poolWithdraw: mocks.withdraw,
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    sponsorship: {
      admitWithdrawBatch: { mutate: mocks.admit },
      finishWithdrawBatch: { mutate: mocks.finish },
    },
  },
}));
vi.mock("../src/lib/prover", () => ({ proveWithdraw: mocks.prove }));
vi.mock("../src/lib/crypto", () => ({
  commitment: async () => 1n,
  ownerPk: async () => 1n,
  merkleProof: async () => ({ root: 1n, pathElements: [], pathIndices: [] }),
  nullifier: async (_secret: bigint, leaf: number) => BigInt(leaf + 2),
  recipientField: () => 3n,
  toBE32: (v: bigint) => {
    const b = new Uint8Array(32);
    b[31] = Number(v);
    return b;
  },
  TREE_DEPTH: 20,
}));

import type { Signer } from "../src/lib/chain";
import { activePool } from "../src/lib/pools";
import { withdrawAll } from "../src/lib/withdraw";

const scope = activePool().scope;
const notes = [
  { scope, leafIndex: 0, amount: 3n, salt: 1n, spent: false },
  { scope, leafIndex: 1, amount: 2n, salt: 1n, spent: false },
];
const params = {
  signer: { address: "0x1111111111111111111111111111111111111111" } as Signer,
  acct: { ownerSecret: 1n, viewSk: new Uint8Array(32) },
  scan: {
    scope,
    leaves: [1n, 1n],
    notes,
    claimable: 5n,
    mirrorAvailable: true,
    indexedAt: "2026-10-08T00:00:00Z",
    health: "healthy" as const,
  },
  notes,
  destination: "0x2222222222222222222222222222222222222222",
};
beforeEach(() => {
  vi.clearAllMocks();
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
  });
  mocks.admit.mockResolvedValue({});
  mocks.finish.mockResolvedValue(undefined);
  mocks.prove.mockResolvedValue({ proof: {}, ms: 1 });
  mocks.withdraw.mockResolvedValue("0xhash");
});
it("admits a complete batch before any proof or transaction", async () => {
  mocks.admit.mockRejectedValueOnce(Error("budget exhausted"));
  await expect(withdrawAll(params)).rejects.toThrow("budget exhausted");
  expect(mocks.prove).not.toHaveBeenCalled();
  expect(mocks.withdraw).not.toHaveBeenCalled();
});
it("resumes partial cash-out with the original parent and full membership", async () => {
  mocks.withdraw
    .mockResolvedValueOnce("0xfirst")
    .mockRejectedValueOnce(Error("RPC unavailable"));
  expect((await withdrawAll(params)).failed).toHaveLength(1);
  const original = mocks.admit.mock.calls[0][0];
  expect(original.nullifiers).toHaveLength(2);
  expect(mocks.finish).not.toHaveBeenCalled();
  expect(
    (await withdrawAll({ ...params, notes: [notes[1]] })).failed,
  ).toHaveLength(0);
  expect(mocks.admit.mock.calls[1][0]).toEqual(original);
  expect(mocks.withdraw.mock.calls[2][7]).toBe(original.id);
  expect(mocks.finish).toHaveBeenCalledWith({ id: original.id });
});
it("does not retain a rejected oversized or budget-denied selection", async () => {
  const oversized = Array.from({ length: 17 }, (_, i) => ({
    ...notes[0],
    leafIndex: i,
  }));
  await expect(
    withdrawAll({
      ...params,
      notes: oversized,
      scan: { ...params.scan, leaves: Array(17).fill(1n) },
    }),
  ).rejects.toThrow();
  mocks.admit.mockRejectedValueOnce({ data: { sponsorshipReason: "budget" } });
  await expect(withdrawAll(params)).rejects.toBeDefined();
  const added = { ...notes[0], leafIndex: 2 };
  await expect(
    withdrawAll({
      ...params,
      notes: [...notes, added],
      scan: { ...params.scan, leaves: [1n, 1n, 1n] },
    }),
  ).resolves.toMatchObject({ failed: [] });
});
it("closes a canonically reverted batch and retries the unspent note with a new parent", async () => {
  mocks.withdraw.mockResolvedValueOnce("0xfirst").mockRejectedValueOnce({
    data: {
      relayOutcome: { state: "reverted", txHash: `0x${"a".repeat(64)}` },
    },
  });
  expect((await withdrawAll(params)).failed).toHaveLength(1);
  const first = mocks.admit.mock.calls[0][0];
  expect(mocks.finish).toHaveBeenCalledWith({ id: first.id });
  await withdrawAll({ ...params, notes: [notes[1]] });
  expect(mocks.admit.mock.calls[1][0].id).not.toBe(first.id);
});
