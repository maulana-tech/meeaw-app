import { afterEach, describe, expect, it, vi } from "vitest";

const proofs = vi.hoisted(() => ({
  transfer: vi.fn(async () => ({
    proof: {
      a: [1n, 2n],
      b: [
        [1n, 2n],
        [3n, 4n],
      ],
      c: [1n, 2n],
    },
    ms: 1,
  })),
  merge: vi.fn(),
}));
vi.mock("../src/lib/prover", () => ({
  proveTransfer: proofs.transfer,
  proveMerge: proofs.merge,
}));

import { hexToBytes } from "viem";
import { derivePrivacyKeyring } from "../src/features/privacyKeys/keyRing";
import { createSignedRequest } from "../src/features/requests/requestCrypto";
import {
  buildMergeSubmission,
  buildRequestKeyMigrationSubmission,
} from "../src/features/requests/requestProofs";
import {
  createSignedTransfer,
  openTransferEnvelope,
} from "../src/features/transfers/transferCrypto";
import { recoverTransferNotes } from "../src/features/transfers/transferNoteRecovery";
import {
  buildTransferKeyMigrationSubmission,
  recoveryBinding,
} from "../src/features/transfers/transferProofs";
import { commitment, decryptNote, ownerPk } from "../src/lib/crypto";
import type { ScanResult } from "../src/lib/notes";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import {
  testParticipant,
  testPool,
  testSigner,
} from "./helpers/requestFixtures";

afterEach(() => vi.clearAllMocks());
async function fixture() {
  const f = await makePrivacyFixture(),
    keyring = await derivePrivacyKeyring(f.root, f.rotatedState);
  const accounts = [...keyring.accounts.values()],
    own = { username: f.username, wallet: f.owner, ...f.keys[0] },
    other = await testParticipant("bob", 2);
  const notes = [
    {
      scope: testPool.scope,
      leafIndex: 0,
      amount: 15_000_000n,
      salt: 10n,
      spent: false,
      keyGeneration: 0,
    },
    {
      scope: testPool.scope,
      leafIndex: 1,
      amount: 5_000_000n,
      salt: 11n,
      spent: false,
      keyGeneration: 1,
    },
  ];
  const scan: ScanResult = {
    scope: testPool.scope,
    notes,
    leaves: await Promise.all(
      notes.map((note, i) =>
        ownerPk(accounts[i].ownerSecret).then((pk) =>
          commitment(note.amount, pk, note.salt),
        ),
      ),
    ),
    claimable: 20_000_000n,
    mirrorAvailable: true,
    indexedAt: "2026-10-08T00:00:00.000Z",
    health: "healthy",
  };
  const { record } = await createSignedRequest(
    {
      id: "00000000-0000-4000-8000-000000000041",
      pool: testPool,
      requester: other,
      addressee: own,
      amount: 20_000_000n,
      note: "old request",
      createdAt: "2026-10-08T00:00:00.000Z",
    },
    testSigner(2),
  );
  const operation = {
    id: record.id,
    requestId: record.id,
    pool: testPool.scope,
    phase: "preparing" as const,
    completedMerges: 0,
    nextStep: 0,
    txHash: null,
    updatedAt: record.createdAt,
  };
  const signed = await createSignedTransfer({
    id: "00000000-0000-4000-8000-000000000042",
    pool: testPool,
    sender: own,
    recipient: other,
    account: accounts[0],
    signer: f.signer,
    amount: 20_000_000n,
    note: "old send",
    createdAt: record.createdAt,
  });
  const transfer = {
    ...signed,
    status: "pending" as const,
    revision: 0,
    operationId: signed.id,
    receipt: null,
    updatedAt: signed.createdAt,
  };
  const transferOperation = {
    id: signed.id,
    transferId: signed.id,
    phase: "preparing" as const,
    nextStep: 0,
    txHash: null,
    updatedAt: signed.createdAt,
  };
  return {
    ...f,
    accounts,
    keyring,
    scan,
    record,
    operation,
    transfer,
    transferOperation,
    context: {
      record,
      operation,
      account: accounts[0],
      keyring,
      fundingGeneration: 1,
      scan,
      signer: f.signer,
      pool: testPool,
    },
  };
}
describe("generation ownership at proof boundaries", () => {
  it("never proves a merge across different owner generations", async () => {
    const f = await fixture();
    await expect(
      buildMergeSubmission({ ...f.context, inputIndices: [0, 1] }),
    ).rejects.toThrow();
    expect(proofs.merge).not.toHaveBeenCalled();
  });
  it("encodes an old-owner self-output as split while keeping change under its original key", async () => {
    const f = await fixture();
    const s = await buildRequestKeyMigrationSubmission(f.context, {
      kind: "key-migrate",
      inputIndex: 0,
      amount: 15_000_000n,
      fromGeneration: 0,
      toGeneration: 1,
    });
    expect(s.kind).toBe("split");
    expect(proofs.transfer.mock.calls[0][0].ownerSecret).toBe(
      f.accounts[0].ownerSecret.toString(),
    );
    expect(
      decryptNote(
        f.accounts[1].viewSk,
        hexToBytes(s.outputs[0].ephemeralPk),
        hexToBytes(s.outputs[0].ciphertext),
      )?.amount,
    ).toBe(15_000_000n);
    expect(
      decryptNote(
        f.accounts[0].viewSk,
        hexToBytes(s.outputs[1].ephemeralPk),
        hexToBytes(s.outputs[1].ciphertext),
      )?.amount,
    ).toBe(0n);
  });
  it("keeps owning generations inside the padded sender recovery frame", async () => {
    const f = await fixture();
    const s = await buildTransferKeyMigrationSubmission(
      { ...f.context, record: f.transfer, operation: f.transferOperation },
      {
        kind: "key-migrate",
        inputIndex: 0,
        amount: 15_000_000n,
        fromGeneration: 0,
        toGeneration: 1,
      },
    );
    expect(s.kind).toBe("split");
    const frame = openTransferEnvelope(
      s.recoveryEnvelope,
      f.accounts[0],
      recoveryBinding(s),
    ) as { version: number; outputs: { generation: number }[] };
    expect(frame.version).toBe(2);
    expect(frame.outputs.map((output) => output.generation)).toEqual([1, 0]);
    expect(JSON.stringify(s)).not.toContain("generation");
    const scan = {
      ...f.scan,
      leaves: [
        ...f.scan.leaves,
        ...s.outputs.map((output) => BigInt(output.commitment)),
      ],
    };
    const evidence = [
      {
        step: 0,
        txHash: `0x${"a".repeat(64)}` as const,
        confirmedAt: f.transfer.createdAt,
        outputs: s.outputs.map((output, position) => ({
          position,
          commitment: output.commitment,
          leafIndex: position + 2,
        })),
      },
    ];
    const recovered = await recoverTransferNotes({
      record: f.transfer,
      submissions: [s],
      evidence,
      account: f.accounts[0],
      scan,
      pool: testPool,
      isSpent: async () => false,
      keyring: f.keyring,
    });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      amount: 15_000_000n,
      leafIndex: 2,
      keyGeneration: 1,
      internal: true,
    });
  });
});
