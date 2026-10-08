import { afterEach, describe, expect, it, vi } from "vitest";
import { accountForGeneration } from "../src/features/privacyKeys/keyRing";

const ports = vi.hoisted(() => ({
  pool: null as unknown,
  admit: vi.fn(async () => ({})),
  prove: vi.fn(async () => ({ proof: { a: [], b: [], c: [] }, ms: 1 })),
  withdraw: vi.fn(async () => `0x${"a".repeat(64)}`),
}));
vi.mock("../src/lib/chain", () => ({
  network: "eip155:31337",
  isEvmAddress: (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value),
  poolWithdraw: ports.withdraw,
  revertErrorName: () => null,
}));
vi.mock("../src/lib/prover", () => ({ proveWithdraw: ports.prove }));
vi.mock("../src/trpc/client", () => ({
  api: {
    privacyKeys: {
      admitCashout: { mutate: ports.admit },
      finishCashout: { mutate: vi.fn() },
    },
  },
}));
vi.mock("../src/lib/pools", async (original) => ({
  ...(await original<object>()),
  resolvePool: () => ports.pool,
}));

import { derivePrivacyKeyring } from "../src/features/privacyKeys/keyRing";
import {
  clearPrivacyKeyring,
  installPrivacyKeyring,
} from "../src/features/privacyKeys/session";
import { prepareReceipt } from "../src/features/receipts/prepareReceipt";
import {
  bytesToHex,
  commitment,
  merkleProof,
  ownerPk,
  toBE32,
} from "../src/lib/crypto";
import type { ScanResult } from "../src/lib/notes";
import { withdrawNote } from "../src/lib/withdraw";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { testPool } from "./helpers/requestFixtures";

afterEach(() => {
  clearPrivacyKeyring();
  vi.clearAllMocks();
});
async function fixture() {
  const f = await makePrivacyFixture(),
    ring = await derivePrivacyKeyring(f.root, f.rotatedState);
  const old = accountForGeneration(ring, 0),
    amount = 15_000_000n,
    salt = 10n;
  ports.pool = testPool;
  const leaf = await commitment(amount, await ownerPk(old.ownerSecret), salt),
    path = await merkleProof([leaf], 0, testPool.depth);
  const note = {
    scope: testPool.scope,
    leafIndex: 0,
    amount,
    salt,
    spent: false,
    keyGeneration: 0,
  };
  const scan: ScanResult = {
    scope: testPool.scope,
    leaves: [leaf],
    notes: [note],
    claimable: amount,
    mirrorAvailable: true,
    indexedAt: "2026-10-08T00:00:00.000Z",
    health: "healthy",
    snapshot: { blockNumber: 100, leafCount: 1 },
  };
  const load = vi.fn(async () => ({
    status: "available" as const,
    snapshot: {
      pool: testPool.scope,
      chainId: testPool.chainId,
      blockNumber: 100,
      blockHash: `0x${"2".repeat(64)}` as const,
      root: `0x${bytesToHex(toBE32(path.root))}` as const,
      leafCount: 1,
      token: testPool.token,
      tokenDecimals: testPool.tokenDecimals,
      headBlock: 105,
      confirmed: true,
    },
  }));
  installPrivacyKeyring(ring);
  return { ...f, ring, old, note, scan, load };
}
describe("historical note ownership at export and spending", () => {
  it("does not acquire an account ticket when proving fails", async () => {
    const f = await fixture();
    ports.prove.mockRejectedValueOnce(new Error("proof failed"));
    await expect(
      withdrawNote({
        signer: f.signer,
        acct: f.old,
        scan: f.scan,
        note: f.note,
        destination: f.owner,
      }),
    ).rejects.toThrow("proof failed");
    expect(ports.admit).not.toHaveBeenCalled();
    expect(ports.withdraw).not.toHaveBeenCalled();
  });
  it("cash-outs an old note with its actual secret while the active key differs", async () => {
    const f = await fixture();
    await withdrawNote({
      signer: f.signer,
      acct: accountForGeneration(f.ring, 1),
      scan: f.scan,
      note: f.note,
      destination: f.owner,
    });
    expect(ports.prove.mock.calls[0][0].ownerSecret).toBe(
      f.old.ownerSecret.toString(),
    );
  });
  it("anchors an old note receipt with its matching public owner key", async () => {
    const f = await fixture();
    const receipt = await prepareReceipt({
      acct: accountForGeneration(f.ring, 1),
      scan: f.scan,
      note: f.note,
      load: f.load,
    });
    expect(receipt.ownerPk).toBe((await ownerPk(f.old.ownerSecret)).toString());
  });
  it("refuses misleading generation labels before proof generation or export", async () => {
    const f = await fixture();
    for (const id of [1, 64]) {
      await expect(
        withdrawNote({
          signer: f.signer,
          acct: accountForGeneration(f.ring, 1),
          scan: f.scan,
          note: { ...f.note, keyGeneration: id },
          destination: f.owner,
        }),
      ).rejects.toThrow();
      await expect(
        prepareReceipt({
          acct: accountForGeneration(f.ring, 1),
          scan: f.scan,
          note: { ...f.note, keyGeneration: id },
          load: f.load,
        }),
      ).rejects.toThrow();
    }
    expect(ports.prove).not.toHaveBeenCalled();
    expect(ports.withdraw).not.toHaveBeenCalled();
  });
});
