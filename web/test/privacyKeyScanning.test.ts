import { beforeEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  mirrors: new Map<string, unknown>(),
  load: vi.fn(),
  refresh: vi.fn(),
  spent: vi.fn(async () => false),
}));
vi.mock("../src/lib/poolMirror", () => ({
  loadPoolMirror: ports.load,
  refreshPoolMirror: ports.refresh,
}));
vi.mock("../src/lib/chain", () => ({ isSpent: ports.spent }));

import { derivePrivacyKeyring } from "../src/features/privacyKeys/keyRing";
import {
  commitment,
  encryptNote,
  nullifier,
  ownerPk,
  toBE32,
  viewPubkey,
} from "../src/lib/crypto";
import { scanKeyringNotes } from "../src/lib/notes";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { testPool } from "./helpers/requestFixtures";

beforeEach(() => {
  ports.mirrors.clear();
  vi.clearAllMocks();
  ports.load.mockImplementation(async (pool) => ports.mirrors.get(pool.scope));
  ports.refresh.mockImplementation(async (pool) =>
    ports.mirrors.get(pool.scope),
  );
});
describe("historical privacy note scanning", () => {
  it("reads one pool prefix and uses each note's actual owner for commitments and spent checks", async () => {
    const f = await makePrivacyFixture(),
      ring = await derivePrivacyKeyring(f.root, f.rotatedState);
    const old = f.accounts.get(0)!,
      current = f.accounts.get(1)!;
    const deposits = [];
    for (const [id, amount, account, pkAccount] of [
      [0, 15n, old, old],
      [1, 5n, current, current],
      [2, 999n, old, current],
    ] as const) {
      deposits.push({
        leafIndex: id,
        commitment: toBE32(
          await commitment(
            amount,
            await ownerPk(pkAccount.ownerSecret),
            BigInt(id + 10),
          ),
        ),
        ...encryptNote(viewPubkey(account.viewSk), amount, BigInt(id + 10)),
      });
    }
    ports.mirrors.set(testPool.scope, {
      deposits,
      spentNullifiers: [],
      spentAtByNullifier: {},
      publishedBlock: 20,
      publishedLeafIndex: 2,
      hydrated: true,
      indexedAt: "2026-10-08T00:00:00.000Z",
      health: "healthy",
    });
    const scan = await scanKeyringNotes(ring, testPool);
    expect(scan.claimable).toBe(20n);
    expect(
      scan.notes.map((note) => [
        note.leafIndex,
        note.keyGeneration,
        note.amount,
      ]),
    ).toEqual([
      [0, 0, 15n],
      [1, 1, 5n],
    ]);
    expect(ports.refresh).toHaveBeenCalledOnce();
    expect(ports.spent).toHaveBeenCalledWith(
      toBE32(await nullifier(old.ownerSecret, 0)),
      testPool,
    );
    expect(ports.spent).toHaveBeenCalledWith(
      toBE32(await nullifier(current.ownerSecret, 1)),
      testPool,
    );
    expect(scan.snapshot).toEqual({ blockNumber: 20, leafCount: 3 });
  });
  it("keeps separate pool totals while retaining historical keys in legacy pools", async () => {
    const f = await makePrivacyFixture(),
      ring = await derivePrivacyKeyring(f.root, f.rotatedState),
      old = f.accounts.get(0)!;
    const legacy = {
      ...testPool,
      scope: "31337:0x5555555555555555555555555555555555555555" as const,
      address: "0x5555555555555555555555555555555555555555" as const,
      role: "legacy" as const,
    };
    const empty = {
      deposits: [],
      spentNullifiers: [],
      publishedBlock: 20,
      publishedLeafIndex: -1,
      hydrated: true,
      indexedAt: "2026-10-08T00:00:00.000Z",
      health: "healthy",
    };
    ports.mirrors.set(testPool.scope, empty);
    ports.mirrors.set(legacy.scope, {
      ...empty,
      publishedLeafIndex: 0,
      deposits: [
        {
          leafIndex: 0,
          commitment: toBE32(
            await commitment(7n, await ownerPk(old.ownerSecret), 10n),
          ),
          ...encryptNote(viewPubkey(old.viewSk), 7n, 10n),
        },
      ],
    });
    expect((await scanKeyringNotes(ring, testPool)).claimable).toBe(0n);
    expect((await scanKeyringNotes(ring, legacy)).claimable).toBe(7n);
  });
});
