import { describe, expect, it } from "vitest";
import {
  encodeTransferSubmission,
  verifyTransferReceipt,
} from "../src/server/modules/transfers/transferSettlement";
import type { SignedTransferSubmission } from "../src/features/transfers/types";
import { testPool } from "./helpers/requestFixtures";
import type { TransactionReceipt } from "viem";
const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const s: SignedTransferSubmission = {
  version: 1,
  transferId: "00000000-0000-4000-8000-0000000000a1",
  operationId: "00000000-0000-4000-8000-0000000000a1",
  step: 0,
  pool: testPool.scope,
  kind: "payment",
  root: hex(1),
  nullifiers: [hex(2)],
  proof: {
    a: ["1", "2"],
    b: [
      ["1", "2"],
      ["1", "2"],
    ],
    c: ["1", "2"],
  },
  outputs: [
    { commitment: hex(3), ephemeralPk: hex(4), ciphertext: "0x1234" },
    { commitment: hex(5), ephemeralPk: hex(6), ciphertext: "0x1234" },
  ],
  recoveryEnvelope: { ephemeralPk: hex(7), ciphertext: "0x1234" },
  signature: "0x1234",
};
describe("transfer settlement evidence", () => {
  it("encodes a pool transfer and rejects unrelated or unconfirmed receipt", () => {
    const data = encodeTransferSubmission(s);
    expect(data.startsWith("0x")).toBe(true);
    const receipt = {
      to: testPool.address,
      status: "success",
      transactionHash: hex(8),
      logs: [],
    } as unknown as TransactionReceipt;
    const input = {
      pool: testPool,
      submission: s,
      transaction: { hash: hex(8), to: testPool.address, input: data },
      receipt,
      confirmations: 0,
      recipientCommitment: hex(3),
    };
    expect(verifyTransferReceipt(input).valid).toBe(false);
    expect(
      verifyTransferReceipt({
        ...input,
        confirmations: 1,
        transaction: { ...input.transaction, input: "0x1234" },
      }).valid,
    ).toBe(false);
    expect(
      verifyTransferReceipt({
        ...input,
        confirmations: 1,
        recipientCommitment: hex(9),
      }).valid,
    ).toBe(false);
  });
});
