import path from "node:path";
import { describe, expect, it } from "vitest";
import { hexToBytes, verifyTypedData } from "viem";
import { commitment, ownerPk, decryptNote } from "../src/lib/crypto";
import { buildTransferSubmission } from "../src/features/transfers/transferProofs";
import { transferSubmissionTypedData } from "../src/features/transfers/transferTypedData";
import { makeTransferFixture } from "./helpers/transferFixtures";
import type { ScanResult } from "../src/lib/notes";
describe("direct transfer proofs", () => {
  it("uses the fixed recipient commitment and returns private change with real artifacts", async () => {
    const f = await makeTransferFixture(),
      pk = await ownerPk(f.sender.ownerSecret);
    const scan: ScanResult = {
      scope: f.pool.scope,
      notes: [
        {
          scope: f.pool.scope,
          leafIndex: 0,
          amount: 25_000_000n,
          salt: 1n,
          spent: false,
        },
      ],
      leaves: [await commitment(25_000_000n, pk, 1n)],
      claimable: 25_000_000n,
      mirrorAvailable: true,
      indexedAt: new Date().toISOString(),
      health: "healthy",
    };
    const s = await buildTransferSubmission(
      {
        record: f.record,
        operation: f.operation,
        account: f.sender,
        scan,
        pool: f.pool,
        signer: f.signer,
        artifactRoot: path.resolve("public/zk"),
      },
      { kind: "payment", inputIndex: 0 },
    );
    expect(s.outputs[0].commitment).toBe(f.record.recipientCommitment);
    expect(
      decryptNote(
        f.recipient.viewSk,
        hexToBytes(s.outputs[0].ephemeralPk),
        hexToBytes(s.outputs[0].ciphertext),
      )?.amount,
    ).toBe(20_000_000n);
    expect(
      decryptNote(
        f.sender.viewSk,
        hexToBytes(s.outputs[1].ephemeralPk),
        hexToBytes(s.outputs[1].ciphertext),
      )?.amount,
    ).toBe(5_000_000n);
    expect(
      await verifyTypedData({
        address: f.record.sender.wallet,
        ...transferSubmissionTypedData(s),
        signature: s.signature,
      }),
    ).toBe(true);
  }, 60000);
});
