import type { Signer } from "../../lib/chain";
import type { LocalAccount, ScanResult } from "../../lib/notes";
import { nextFundingAction } from "../payments/funding";
import {
  type GenerationFundingAction,
  nextGenerationFundingAction,
} from "../privacyKeys/generationFunding";
import type { LocalPrivacyKeyring } from "../privacyKeys/types";
import { openTransfer } from "./transferCrypto";
import type {
  PoolDescriptor,
  SignedTransferSubmission,
  TransferOperation,
  TransferRecord,
} from "./types";
export type TransferRunnerPort = {
  isCurrent: () => boolean;
  operation: () => Promise<TransferOperation>;
  scan: () => Promise<ScanResult>;
  build: (
    op: TransferOperation,
    scan: ScanResult,
    action: GenerationFundingAction,
  ) => Promise<SignedTransferSubmission>;
  submit: (s: SignedTransferSubmission) => Promise<TransferOperation>;
  tick: (op: TransferOperation) => void;
};
export async function runDirectTransfer(
  context: {
    record: TransferRecord;
    account: LocalAccount;
    pool: PoolDescriptor;
    signer: Signer;
    keyring?: LocalPrivacyKeyring;
  },
  port: TransferRunnerPort,
): Promise<TransferOperation | null> {
  const current = () => port.isCurrent();
  const payload = await openTransfer(
    context.record,
    context.account,
    context.pool,
  );
  if (!current()) return null;
  if (
    context.signer.address.toLowerCase() !==
    context.record.sender.wallet.toLowerCase()
  )
    throw new Error("Unlock the sending account.");
  let operation = await port.operation();
  if (!current()) return null;
  port.tick(operation);
  for (
    let attempts = 0;
    operation.phase === "preparing" &&
    !operation.sponsorshipPause &&
    attempts < 4096;
    attempts++
  ) {
    const scan = await port.scan();
    if (!current()) return null;
    if (scan.health !== "healthy" || scan.scope !== context.pool.scope)
      throw new Error("Refresh the balance before sending.");
    const action = context.keyring
      ? nextGenerationFundingAction(
          scan.notes,
          BigInt(payload.amount),
          context.pool.scope,
          operation.fundingGeneration ?? 0,
        )
      : nextFundingAction(
          scan.notes,
          BigInt(payload.amount),
          context.pool.scope,
        );
    const submission = await port.build(operation, scan, action);
    if (!current()) return null;
    operation = await port.submit(submission);
    if (!current()) return null;
    port.tick(operation);
  }
  return operation;
}
