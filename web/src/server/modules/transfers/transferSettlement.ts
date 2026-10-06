import "server-only";
import type { Hex, TransactionReceipt } from "viem";
import type { SignedSubmission } from "../../../features/requests/types";
import type {
  PoolDescriptor,
  SignedTransferSubmission,
} from "../../../features/transfers/types";
import {
  encodeSubmission,
  verifyRequestReceipt,
} from "../requests/requestSettlement";

function poolSubmission(s: SignedTransferSubmission): SignedSubmission {
  return {
    version: s.version,
    requestId: s.transferId,
    operationId: s.operationId,
    step: s.step,
    pool: s.pool,
    kind: s.kind,
    root: s.root,
    nullifiers: s.nullifiers,
    proof: s.proof,
    outputs: s.outputs,
    signature: s.signature,
  };
}
export function encodeTransferSubmission(s: SignedTransferSubmission) {
  return encodeSubmission(poolSubmission(s));
}
export function verifyTransferReceipt(input: {
  pool: PoolDescriptor;
  submission: SignedTransferSubmission;
  transaction: { hash: Hex; to: Hex | null; input: Hex };
  receipt: TransactionReceipt;
  confirmations: number;
  recipientCommitment: Hex;
}) {
  return verifyRequestReceipt({
    ...input,
    submission: poolSubmission(input.submission),
    requestCommitment: input.recipientCommitment,
  });
}
