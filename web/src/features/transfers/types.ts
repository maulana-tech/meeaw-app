import type { Signer } from "../../lib/chain";
import type { LocalAccount, ScanResult } from "../../lib/notes";
import type {
  Envelope,
  Hex,
  NoteOutput,
  Participant,
  PoolDescriptor,
  PoolScope,
  ProofWire,
} from "../requests/types";
import type { ActionTicket, UnavailableReason } from "../sponsorship/types";

export type { Envelope, Hex, NoteOutput, PoolDescriptor, PoolScope, ProofWire };
export type TransferParticipant = Participant;
export type TransferMetadata = {
  version: 1;
  id: string;
  pool: PoolScope;
  sender: Participant;
  recipient: Participant;
  createdAt: string;
  recipientCommitment: Hex;
};
export type TransferPayload = {
  metadata: TransferMetadata;
  amount: string;
  note: string;
  salt: string;
};
export type SignedTransfer = TransferMetadata & {
  senderEnvelope: Envelope;
  recipientEnvelope: Envelope;
  signature: Hex;
};
export type TransferReceipt = {
  txHash: Hex;
  leafIndex: number;
  block: number;
  confirmedAt: string;
};
export type TransferRecord = SignedTransfer & {
  status: "pending" | "confirmed" | "failed";
  revision: number;
  operationId: string;
  updatedAt: string;
  receipt: TransferReceipt | null;
};
export type TransferPage = {
  items: TransferRecord[];
  nextCursor: string | null;
};
export type TransferOperation = {
  sponsorshipAction?: ActionTicket;
  sponsorshipPause?: UnavailableReason;
  fundingGeneration?: number;
  keyRevision?: number;
  accountTicketId?: string;
  id: string;
  transferId: string;
  phase:
    | "preparing"
    | "submitting"
    | "submitted"
    | "confirmed"
    | "failed"
    | "needsReconciliation";
  nextStep: number;
  txHash: Hex | null;
  updatedAt: string;
};
export type TransferSubmissionBody = {
  version: 1;
  transferId: string;
  operationId: string;
  step: number;
  pool: PoolScope;
  kind: "merge" | "split" | "payment";
  root: Hex;
  nullifiers: readonly Hex[];
  proof: ProofWire;
  outputs: readonly NoteOutput[];
  recoveryEnvelope: Envelope;
};
export type SignedTransferSubmission = TransferSubmissionBody & {
  signature: Hex;
};
export type ConfirmedTransferStep = {
  step: number;
  txHash: Hex;
  block: number;
  confirmedAt: string;
  outputs: readonly { position: number; leafIndex: number; commitment: Hex }[];
};
export type TransferEvidence = {
  submissions: SignedTransferSubmission[];
  steps: ConfirmedTransferStep[];
};
export type TransferRecoveryPage = {
  items: {
    transferId: string;
    submission: SignedTransferSubmission;
    evidence: ConfirmedTransferStep | null;
  }[];
  nextCursor: string | null;
};
export type CreateTransferInput = {
  id: string;
  pool: PoolDescriptor;
  sender: Participant;
  recipient: Participant;
  account: LocalAccount;
  signer: Signer;
  amount: bigint;
  note: string;
  createdAt: string;
};
export type TransferProofContext = {
  record: TransferRecord;
  operation: TransferOperation;
  account: LocalAccount;
  scan: ScanResult;
  pool: PoolDescriptor;
  signer: Signer;
  artifactRoot?: string;
  keyring?: import("../privacyKeys/types").LocalPrivacyKeyring;
  fundingGeneration?: number;
  isCurrent?: () => boolean;
};
