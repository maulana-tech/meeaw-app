import type { Hex } from "viem";
import type { LocalAccount } from "../../lib/notes";
import type { ActionTicket, UnavailableReason } from "../sponsorship/types";

export type RegistryScope = `${number}:${string}`;
export type KeyGenerationId = number;
export type PublicKeyPair = { notePubkey: Hex; viewPubkey: Hex };
export type GenerationEvidence = {
  block: number;
  blockHash: Hex;
  txHash: Hex | null;
};
export type KeyGeneration = PublicKeyPair & {
  rotatedAt?: string;
  id: KeyGenerationId;
  evidence: GenerationEvidence;
};
export type RotationPhase =
  | "prepared"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed"
  | "needsReconciliation"
  | "conflict";
export type RotationIntent = {
  version: 1;
  id: string;
  owner: Hex;
  registry: RegistryScope;
  username: string;
  expectedRevision: number;
  from: KeyGenerationId;
  to: KeyGenerationId;
  oldKeys: PublicKeyPair;
  newKeys: PublicKeyPair;
  deadline: string;
  signature: Hex;
};
export type RotationOperation = {
  sponsorshipAction?: ActionTicket;
  sponsorshipPause?: UnavailableReason;
  intent: RotationIntent;
  phase: RotationPhase;
  txHash: Hex | null;
  updatedAt: string;
  registryAuthorization?: { nonce: string; deadline: string; signature: Hex };
  authorizationEvidence?: GenerationEvidence;
  searchEvidence?: GenerationEvidence;
};
export type PrivacyKeyState = {
  version: 1;
  owner: Hex;
  registry: RegistryScope;
  username: string;
  revision: number;
  activeGeneration: KeyGenerationId;
  generations: readonly KeyGeneration[];
  pending: RotationOperation | null;
};
export type LocalPrivacyKeyring = {
  owner: Hex;
  registry: RegistryScope;
  revision: number;
  activeGeneration: KeyGenerationId;
  accounts: ReadonlyMap<KeyGenerationId, LocalAccount>;
};
export type AccountTicket = {
  id: string;
  operationId: string;
  owner: Hex;
  registry: RegistryScope;
  revision: number;
  fundingGeneration: KeyGenerationId;
  kind: "spend" | "recovery-change";
};
export type FundingCapture = {
  fundingGeneration?: number;
  keyRevision?: number;
  accountTicketId?: string;
};
