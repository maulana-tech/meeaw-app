import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountForGeneration,
  derivePrivacyKeyring,
} from "../src/features/privacyKeys/keyRing";
import {
  clearPrivacyKeyring,
  installPrivacyKeyring,
} from "../src/features/privacyKeys/session";
import {
  createSignedRequest,
  openRequest,
} from "../src/features/requests/requestCrypto";
import { recoverPaidRequestOutputs } from "../src/features/requests/requestNoteRecovery";
import {
  createSignedTransfer,
  openTransfer,
} from "../src/features/transfers/transferCrypto";
import { commitment, ownerPk } from "../src/lib/crypto";
import type { ScanResult } from "../src/lib/notes";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { testParticipant, testPool } from "./helpers/requestFixtures";

afterEach(clearPrivacyKeyring);
describe("immutable records after privacy rotation", () => {
  it("recovers a late paid old-key request alongside current funds with one history page", async () => {
    const f = await makePrivacyFixture(),
      ring = await derivePrivacyKeyring(f.root, f.rotatedState);
    const { record, payload } = await createSignedRequest(
      {
        id: "00000000-0000-4000-8000-000000000034",
        pool: testPool,
        requester: { username: f.username, wallet: f.owner, ...f.keys[0] },
        addressee: await testParticipant("bob", 2),
        amount: 15_000_000n,
        note: "late old key",
        createdAt: "2026-10-08T00:00:00.000Z",
      },
      f.signer,
    );
    const current = {
      scope: testPool.scope,
      leafIndex: 1,
      amount: 5_000_000n,
      salt: 99n,
      keyGeneration: 1,
      spent: false,
    };
    const scan: ScanResult = {
      scope: testPool.scope,
      notes: [current],
      leaves: [
        BigInt(record.recipientCommitment),
        await commitment(
          current.amount,
          await ownerPk(accountForGeneration(ring, 1).ownerSecret),
          current.salt,
        ),
      ],
      claimable: current.amount,
      mirrorAvailable: true,
      indexedAt: "2026-10-08T00:00:00.000Z",
      health: "healthy",
    };
    const page = vi.fn(async () => ({
      items: [
        {
          ...record,
          status: "paid" as const,
          revision: 2,
          operationId: record.id,
          updatedAt: record.createdAt,
          receipt: { txHash: `0x${"a".repeat(64)}`, leafIndex: 0, block: 100 },
        },
      ],
      nextCursor: null,
    }));
    const restored = await recoverPaidRequestOutputs(
      accountForGeneration(ring, 1),
      testPool,
      scan,
      page,
      async () => false,
      ring,
    );
    expect(restored.claimable).toBe(20_000_000n);
    expect(
      restored.notes.map((note) => [note.leafIndex, note.keyGeneration]),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(page).toHaveBeenCalledOnce();
    expect(restored.notes[0].salt).toBe(BigInt(payload.salt));
  });
  it("opens old sender/requester envelopes through their retained public pair without rewriting signed records", async () => {
    const f = await makePrivacyFixture(),
      other = await testParticipant("bob", 2);
    const own = { username: f.username, wallet: f.owner, ...f.keys[0] };
    const { record: request } = await createSignedRequest(
      {
        id: "00000000-0000-4000-8000-000000000031",
        pool: testPool,
        requester: own,
        addressee: other,
        amount: 20_000_000n,
        note: "old request",
        createdAt: "2026-10-08T00:00:00.000Z",
      },
      f.signer,
    );
    const transfer = await createSignedTransfer({
      id: "00000000-0000-4000-8000-000000000032",
      pool: testPool,
      sender: own,
      recipient: other,
      account: f.accounts.get(0)!,
      signer: f.signer,
      amount: 20_000_000n,
      note: "old send",
      createdAt: "2026-10-08T00:00:00.000Z",
    });
    const before = JSON.stringify([request, transfer]);
    const ring = await derivePrivacyKeyring(f.root, f.rotatedState);
    installPrivacyKeyring(ring);
    expect(
      (await openRequest(request, accountForGeneration(ring, 1), testPool))
        .note,
    ).toBe("old request");
    expect(
      (await openTransfer(transfer, accountForGeneration(ring, 1), testPool))
        .note,
    ).toBe("old send");
    expect(JSON.stringify([request, transfer])).toBe(before);
  });
  it("does not join separately matching note and viewing keys into a participant account", async () => {
    const f = await makePrivacyFixture(),
      ring = await derivePrivacyKeyring(f.root, f.rotatedState);
    const { record } = await createSignedRequest(
      {
        id: "00000000-0000-4000-8000-000000000033",
        pool: testPool,
        requester: {
          username: f.username,
          wallet: f.owner,
          notePubkey: f.keys[0].notePubkey,
          viewPubkey: f.keys[1].viewPubkey,
        },
        addressee: await testParticipant("bob", 2),
        amount: 20_000_000n,
        note: "invalid pair",
        createdAt: "2026-10-08T00:00:00.000Z",
      },
      f.signer,
    );
    installPrivacyKeyring(ring);
    await expect(
      openRequest(record, accountForGeneration(ring, 1), testPool),
    ).rejects.toThrow();
  });
});
