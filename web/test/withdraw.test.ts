// @vitest-environment node

import { beforeEach, vi } from "vitest";
import type { Signer } from "../src/lib/chain";
import { poolWithdraw } from "../src/lib/chain";
import type { LocalAccount, MyNote, ScanResult } from "../src/lib/notes";
import {
  claimableNotes,
  isValidDestination,
  largestNote,
  withdrawAll,
} from "../src/lib/withdraw";

// Stub every network/proving dependency so `withdrawAll` runs its real
// orchestration (validate once, loop, aggregate) without the prover or the
// chain; each note's `poolWithdraw` is the seam we drive for success/failure.
vi.mock("../src/lib/prover", () => ({
  proveWithdraw: vi.fn(async () => ({ proof: new Uint8Array(), ms: 10 })),
}));
vi.mock("../src/lib/crypto", () => ({
  merkleProof: vi.fn(async () => ({
    root: 1n,
    pathElements: [] as bigint[],
    pathIndices: [] as number[],
  })),
  nullifier: vi.fn(async () => 2n),
  recipientField: vi.fn(() => 3n),
  toBE32: vi.fn(() => new Uint8Array(32)),
  TREE_DEPTH: 20,
}));
vi.mock("../src/lib/chain", () => ({
  poolWithdraw: vi.fn(async () => "0xhash"),
  isEvmAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value.trim()),
  revertErrorName: () => null,
}));

const note = (leafIndex: number, amount: bigint, spent = false): MyNote => ({
  leafIndex,
  amount,
  salt: 1n,
  spent,
});

describe("claimableNotes", () => {
  it("keeps only unspent notes, largest first", () => {
    const notes = [
      note(0, 5_0000000n),
      note(1, 10_0000000n, true), // spent — excluded
      note(2, 3_0000000n),
      note(3, 12_0000000n),
    ];
    expect(claimableNotes(notes).map((n) => n.leafIndex)).toEqual([3, 0, 2]);
  });

  it("returns an empty list when everything is spent", () => {
    expect(claimableNotes([note(0, 5n, true)])).toEqual([]);
  });
});

describe("largestNote", () => {
  it("is the biggest single unspent note (withdraw is full-note)", () => {
    const notes = [
      note(0, 5_0000000n),
      note(1, 9_0000000n),
      note(2, 20n, true),
    ];
    expect(largestNote(notes)).toBe(9_0000000n);
  });

  it("is zero with no claimable notes", () => {
    expect(largestNote([note(0, 5n, true)])).toBe(0n);
  });
});

describe("isValidDestination", () => {
  const ADDR = "0x00000000000000000000000000000000000000A1";

  it("accepts a Monad (EVM) address", () => {
    expect(isValidDestination(ADDR)).toBe(true);
    expect(isValidDestination(` ${ADDR} `)).toBe(true);
  });

  it("rejects a username handle or empty input", () => {
    expect(isValidDestination("@alice")).toBe(false);
    expect(isValidDestination("")).toBe(false);
    expect(isValidDestination("not-an-address")).toBe(false);
    expect(
      isValidDestination(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      ),
    ).toBe(false);
  });
});

describe("withdrawAll", () => {
  const G = "0x00000000000000000000000000000000000000A1";
  const acct = {
    ownerSecret: 7n,
    viewSk: new Uint8Array(),
  } as unknown as LocalAccount;
  const scan = {
    notes: [],
    leaves: [],
    claimable: 0n,
  } as unknown as ScanResult;
  const signer = {} as Signer;
  const mockPoolWithdraw = vi.mocked(poolWithdraw);

  beforeEach(() => {
    mockPoolWithdraw.mockReset();
    mockPoolWithdraw.mockResolvedValue("0xhash");
  });

  it("cashes out every claimable note, largest-first, summing the total", async () => {
    const notes = [
      note(0, 5_0000000n),
      note(1, 10_0000000n),
      note(2, 3_0000000n),
    ];
    const res = await withdrawAll({
      signer,
      acct,
      scan,
      notes,
      destination: G,
    });

    expect(res.failed).toEqual([]);
    expect(res.succeeded).toHaveLength(3);
    expect(res.total).toBe(18_0000000n);
    // poolWithdraw's 3rd arg is the note amount — assert largest-first order.
    const amounts = mockPoolWithdraw.mock.calls.map((c) => c[2]);
    expect(amounts).toEqual([10_0000000n, 5_0000000n, 3_0000000n]);
  });

  it("ignores already-spent notes", async () => {
    const notes = [note(0, 5_0000000n), note(1, 9_0000000n, true)];
    const res = await withdrawAll({
      signer,
      acct,
      scan,
      notes,
      destination: G,
    });

    expect(res.succeeded).toHaveLength(1);
    expect(res.total).toBe(5_0000000n);
    expect(mockPoolWithdraw).toHaveBeenCalledTimes(1);
  });

  it("continues past a failed note and reports it (no rollback)", async () => {
    mockPoolWithdraw.mockImplementation(async (_signer, _dest, amount) => {
      if (amount === 5_0000000n) throw new Error("relay rejected");
      return "0xhash";
    });
    const notes = [note(0, 5_0000000n), note(1, 10_0000000n)];
    const res = await withdrawAll({
      signer,
      acct,
      scan,
      notes,
      destination: G,
    });

    expect(res.succeeded).toHaveLength(1);
    expect(res.total).toBe(10_0000000n);
    expect(res.failed).toEqual([
      { leafIndex: 0, amount: 5_0000000n, error: "relay rejected" },
    ]);
  });

  it("returns a zeroed result when nothing is claimable", async () => {
    const res = await withdrawAll({
      signer,
      acct,
      scan,
      notes: [note(0, 5n, true)],
      destination: G,
    });

    expect(res).toEqual({
      total: 0n,
      succeeded: [],
      failed: [],
    });
    expect(mockPoolWithdraw).not.toHaveBeenCalled();
  });
});
