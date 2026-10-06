import { hashTypedData, keccak256 } from "viem";
import { envelopeHash, proofHash } from "../requests/requestTypedData";
import { parsePoolScope } from "../requests/validation";
import type {
  SignedTransfer,
  TransferMetadata,
  TransferSubmissionBody,
} from "./types";

const participants = [
  { name: "username", type: "string" },
  { name: "wallet", type: "address" },
  { name: "notePubkey", type: "bytes32" },
  { name: "viewPubkey", type: "bytes32" },
] as const;
const fields = [
  { name: "version", type: "uint8" },
  { name: "id", type: "string" },
  { name: "sender", type: "Participant" },
  { name: "recipient", type: "Participant" },
  { name: "createdAt", type: "string" },
  { name: "recipientCommitment", type: "bytes32" },
] as const;
function domain(pool: string) {
  const p = parsePoolScope(pool);
  return {
    name: "Mawee Transfers",
    version: "1",
    chainId: p.chainId,
    verifyingContract: p.address,
  } as const;
}
function metadataMessage(m: TransferMetadata) {
  return {
    version: m.version,
    id: m.id,
    sender: m.sender,
    recipient: m.recipient,
    createdAt: m.createdAt,
    recipientCommitment: m.recipientCommitment,
  };
}
export function transferMetadataHash(m: TransferMetadata) {
  return hashTypedData({
    domain: domain(m.pool),
    types: { Participant: participants, TransferMetadata: fields },
    primaryType: "TransferMetadata",
    message: metadataMessage(m),
  });
}
export function transferTypedData(r: Omit<SignedTransfer, "signature">) {
  return {
    domain: domain(r.pool),
    types: {
      Participant: participants,
      PrivateTransfer: [
        ...fields,
        { name: "senderEnvelopeHash", type: "bytes32" },
        { name: "recipientEnvelopeHash", type: "bytes32" },
      ],
    },
    primaryType: "PrivateTransfer",
    message: {
      ...metadataMessage(r),
      senderEnvelopeHash: envelopeHash(r.senderEnvelope),
      recipientEnvelopeHash: envelopeHash(r.recipientEnvelope),
    },
  } as const;
}
export function transferDigest(r: SignedTransfer) {
  return hashTypedData(transferTypedData(r));
}
export function transferSubmissionTypedData(s: TransferSubmissionBody) {
  return {
    domain: domain(s.pool),
    primaryType: "TransferSubmission",
    types: {
      Output: [
        { name: "commitment", type: "bytes32" },
        { name: "ephemeralPk", type: "bytes32" },
        { name: "ciphertextHash", type: "bytes32" },
      ],
      TransferSubmission: [
        { name: "version", type: "uint8" },
        { name: "transferId", type: "string" },
        { name: "operationId", type: "string" },
        { name: "step", type: "uint32" },
        { name: "kind", type: "string" },
        { name: "root", type: "bytes32" },
        { name: "nullifiers", type: "bytes32[]" },
        { name: "proofHash", type: "bytes32" },
        { name: "outputs", type: "Output[]" },
        { name: "recoveryHash", type: "bytes32" },
      ],
    },
    message: {
      version: s.version,
      transferId: s.transferId,
      operationId: s.operationId,
      step: s.step,
      kind: s.kind,
      root: s.root,
      nullifiers: [...s.nullifiers],
      proofHash: proofHash(s.proof),
      outputs: s.outputs.map((o) => ({
        commitment: o.commitment,
        ephemeralPk: o.ephemeralPk,
        ciphertextHash: keccak256(o.ciphertext),
      })),
      recoveryHash: envelopeHash(s.recoveryEnvelope),
    },
  } as const;
}
export function transferSubmissionDigest(s: TransferSubmissionBody) {
  return hashTypedData(transferSubmissionTypedData(s));
}
