import { describe, expect, it } from "vitest";
import {
  recoverTransferNotes,
  recoverParticipantTransfers,
} from "../src/features/transfers/transferNoteRecovery";
import { makeTransferFixture } from "./helpers/transferFixtures";
import type { ScanResult } from "../src/lib/notes";
describe("direct transfer note recovery", () => {
  it("does not request sender step evidence for 500 already-discovered recipient payments", async () => {
    const f = await makeTransferFixture();
    let batches = 0,
      pages = 0;
    const records = Array.from({ length: 500 }, (_, index) => ({
      ...f.record,
      id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
      status: "confirmed" as const,
      receipt: {
        txHash: `0x${"11".repeat(32)}` as const,
        leafIndex: index,
        block: 1,
        confirmedAt: f.record.createdAt,
      },
    }));
    const notes = records.map((_, leafIndex) => ({
      scope: f.pool.scope,
      leafIndex,
      amount: 20_000_000n,
      salt: 1n,
      spent: false,
    }));
    const scan: ScanResult = {
      scope: f.pool.scope,
      notes,
      leaves: [],
      claimable: 10_000_000_000n,
      mirrorAvailable: true,
      indexedAt: f.record.createdAt,
      health: "healthy",
    };
    const result = await recoverParticipantTransfers(
      f.recipient,
      f.pool,
      scan,
      {
        list: async (cursor) => {
          pages++;
          const at = Number(cursor ?? 0);
          return {
            items: records.slice(at, at + 20),
            nextCursor: at + 20 < 500 ? String(at + 20) : null,
          };
        },
        batch: async () => {
          batches++;
          throw new Error("Unnecessary sender recovery query");
        },
      },
    );
    expect(batches).toBe(0);
    expect(pages).toBe(25);
    expect(result.notes).toHaveLength(500);
    expect(result.claimable).toBe(10_000_000_000n);
  }, 60000);
  it("restores only the matching owned leaf and preserves spent evidence", async () => {
    const f = await makeTransferFixture();
    const record = {
      ...f.record,
      status: "confirmed" as const,
      receipt: {
        txHash: `0x${"11".repeat(32)}` as const,
        leafIndex: 0,
        block: 1,
        confirmedAt: "2026-10-06T00:00:00.000Z",
      },
    };
    const scan: ScanResult = {
      scope: f.pool.scope,
      notes: [],
      leaves: [BigInt(record.recipientCommitment)],
      claimable: 0n,
      mirrorAvailable: true,
      indexedAt: record.createdAt,
      health: "healthy",
    };
    const input = {
      record,
      submissions: [],
      evidence: [],
      account: f.recipient,
      scan,
      pool: f.pool,
      isSpent: async () => true,
    };
    const notes = await recoverTransferNotes(input);
    expect(notes).toHaveLength(1);
    expect(notes[0].amount).toBe(20_000_000n);
    expect(notes[0].spent).toBe(true);
    expect(
      await recoverTransferNotes({ ...input, account: f.outsider }),
    ).toEqual([]);
    await expect(
      recoverTransferNotes({
        ...input,
        scan: {
          ...scan,
          scope: "31337:0x2222222222222222222222222222222222222222",
        },
      }),
    ).rejects.toThrow();
  });
});
