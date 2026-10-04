// Transport contracts for private payment requests. These describe what crosses
// the client/server boundary; decrypted payloads (`RequestPayload`) only ever
// live in browser memory and must never be persisted or logged.

export type Hex = `0x${string}`;

/** `${chainId}:${lowercase pool address}` */
export type PoolScope = `${number}:${string}`;

export type RequestStatus = "pending" | "paid" | "declined" | "cancelled";

export type OperationPhase =
  | "preparing"
  | "submitting"
  | "submitted"
  | "confirmed"
  | "failed"
  | "needsReconciliation";

export type Participant = {
  username: string;
  wallet: Hex;
  notePubkey: Hex;
  viewPubkey: Hex;
};

export type PoolDescriptor = {
  scope: PoolScope;
  chainId: number;
  address: Hex;
  deployBlock: number;
  token: Hex;
  tokenDecimals: number;
  depth: 20;
  confirmations: number;
  role: "active" | "legacy";
  requestCapable: boolean;
};

export type RequestMetadata = {
  version: 1;
  id: string;
  pool: PoolScope;
  requester: Participant;
  addressee: Participant;
  createdAt: string;
  recipientCommitment: Hex;
};

export type RequestPayload = {
  metadata: RequestMetadata;
  /** Token base units as a decimal string. */
  amount: string;
  note: string;
  /** Recipient note salt as a decimal field element. */
  salt: string;
};

export type Envelope = { ephemeralPk: Hex; ciphertext: Hex };

export type SignedRequest = RequestMetadata & {
  requesterEnvelope: Envelope;
  addresseeEnvelope: Envelope;
  signature: Hex;
};

export type PaymentRequest = SignedRequest & {
  status: RequestStatus;
  revision: number;
  operationId: string | null;
  updatedAt: string;
  receipt: { txHash: Hex; leafIndex: number; block: number } | null;
};

export type RequestPage = {
  items: PaymentRequest[];
  nextCursor: string | null;
};

export type NoteOutput = {
  commitment: Hex;
  ephemeralPk: Hex;
  ciphertext: Hex;
};

export type ProofWire = {
  a: readonly [string, string];
  b: readonly [readonly [string, string], readonly [string, string]];
  c: readonly [string, string];
};

export type SubmissionKind = "merge" | "split" | "payment";

export type SubmissionBody = {
  version: 1;
  requestId: string;
  operationId: string;
  step: number;
  pool: PoolScope;
  kind: SubmissionKind;
  root: Hex;
  nullifiers: readonly Hex[];
  proof: ProofWire;
  outputs: readonly NoteOutput[];
};

export type SignedSubmission = SubmissionBody & { signature: Hex };

export type PaymentOperation = {
  id: string;
  requestId: string;
  pool: PoolScope;
  phase: OperationPhase;
  completedMerges: number;
  nextStep: number;
  txHash: Hex | null;
  updatedAt: string;
};
