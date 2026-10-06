import { createSignedTransfer } from "../../src/features/transfers/transferCrypto";
import {
  testAccount,
  testParticipant,
  testPool,
  testSigner,
} from "./requestFixtures";
import type { TransferRecord } from "../../src/features/transfers/types";
export async function makeTransferFixture(
  amount = 20_000_000n,
  note = "Lunch",
) {
  const sender = testAccount(1),
    recipient = testAccount(2),
    signer = testSigner(1);
  const r = await createSignedTransfer({
    id: "00000000-0000-4000-8000-0000000000a1",
    pool: testPool,
    sender: await testParticipant("alice", 1),
    recipient: await testParticipant("bob", 2),
    account: sender,
    signer,
    amount,
    note,
    createdAt: "2026-10-06T00:00:00.000Z",
  });
  const record: TransferRecord = {
    ...r,
    status: "pending",
    revision: 0,
    operationId: r.id,
    updatedAt: r.createdAt,
    receipt: null,
  };
  const operation = {
    id: r.id,
    transferId: r.id,
    phase: "preparing" as const,
    nextStep: 0,
    txHash: null,
    updatedAt: r.createdAt,
  };
  return {
    record,
    operation,
    sender,
    recipient,
    outsider: testAccount(3),
    signer,
    pool: testPool,
  };
}
