// EIP-712 payloads for private payment requests and their payment submissions.
// The browser signs and the server verifies the same struct, so these builders
// are shared. Every field is explicitly typed; nothing depends on JSON key order.

import { concatHex, encodeAbiParameters, hashTypedData, keccak256 } from "viem";
import type {
  Envelope,
  Hex,
  NoteOutput,
  ProofWire,
  SignedRequest,
  SubmissionBody,
} from "./types";
import { parsePoolScope } from "./validation";

/** A request with or without its signature; the signature is never hashed. */
type UnsignedRequest = Omit<SignedRequest, "signature"> & { signature?: Hex };

export const REQUEST_DOMAIN_NAME = "Mawee Requests";
export const REQUEST_DOMAIN_VERSION = "1";

const participantFields = [
  { name: "username", type: "string" },
  { name: "wallet", type: "address" },
  { name: "notePubkey", type: "bytes32" },
  { name: "viewPubkey", type: "bytes32" },
] as const;

export const requestTypes = {
  Participant: participantFields,
  PaymentRequest: [
    { name: "version", type: "uint8" },
    { name: "id", type: "string" },
    { name: "requester", type: "Participant" },
    { name: "addressee", type: "Participant" },
    { name: "createdAt", type: "string" },
    { name: "recipientCommitment", type: "bytes32" },
    { name: "requesterEnvelopeHash", type: "bytes32" },
    { name: "addresseeEnvelopeHash", type: "bytes32" },
  ],
} as const;

export const submissionTypes = {
  Output: [
    { name: "commitment", type: "bytes32" },
    { name: "ephemeralPk", type: "bytes32" },
    { name: "ciphertextHash", type: "bytes32" },
  ],
  RequestSubmission: [
    { name: "version", type: "uint8" },
    { name: "requestId", type: "string" },
    { name: "operationId", type: "string" },
    { name: "step", type: "uint32" },
    { name: "kind", type: "string" },
    { name: "root", type: "bytes32" },
    { name: "nullifiers", type: "bytes32[]" },
    { name: "proofHash", type: "bytes32" },
    { name: "outputs", type: "Output[]" },
  ],
} as const;

function requestDomain(pool: string) {
  const { chainId, address } = parsePoolScope(pool);
  return {
    name: REQUEST_DOMAIN_NAME,
    version: REQUEST_DOMAIN_VERSION,
    chainId,
    verifyingContract: address,
  } as const;
}

/** ephemeralPk is fixed at 32 bytes, so packed concatenation is unambiguous. */
export function envelopeHash(envelope: Envelope): Hex {
  return keccak256(concatHex([envelope.ephemeralPk, envelope.ciphertext]));
}

export function proofHash(proof: ProofWire): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256[2]" },
        { type: "uint256[2][2]" },
        { type: "uint256[2]" },
      ],
      [
        [BigInt(proof.a[0]), BigInt(proof.a[1])],
        [
          [BigInt(proof.b[0][0]), BigInt(proof.b[0][1])],
          [BigInt(proof.b[1][0]), BigInt(proof.b[1][1])],
        ],
        [BigInt(proof.c[0]), BigInt(proof.c[1])],
      ],
    ),
  );
}

function outputMessage(output: NoteOutput) {
  return {
    commitment: output.commitment,
    ephemeralPk: output.ephemeralPk,
    ciphertextHash: keccak256(output.ciphertext),
  };
}

/** Typed data for the requester's signature. The signature itself is excluded. */
export function requestTypedData(record: UnsignedRequest) {
  const participant = (p: SignedRequest["requester"]) => ({
    username: p.username,
    wallet: p.wallet,
    notePubkey: p.notePubkey,
    viewPubkey: p.viewPubkey,
  });
  return {
    domain: requestDomain(record.pool),
    types: requestTypes,
    primaryType: "PaymentRequest",
    message: {
      version: record.version,
      id: record.id,
      requester: participant(record.requester),
      addressee: participant(record.addressee),
      createdAt: record.createdAt,
      recipientCommitment: record.recipientCommitment,
      requesterEnvelopeHash: envelopeHash(record.requesterEnvelope),
      addresseeEnvelopeHash: envelopeHash(record.addresseeEnvelope),
    },
  } as const;
}

/** Typed data for the payer's signature over one consolidation or payment step. */
export function submissionTypedData(body: SubmissionBody) {
  return {
    domain: requestDomain(body.pool),
    types: submissionTypes,
    primaryType: "RequestSubmission",
    message: {
      version: body.version,
      requestId: body.requestId,
      operationId: body.operationId,
      step: body.step,
      kind: body.kind,
      root: body.root,
      nullifiers: [...body.nullifiers],
      proofHash: proofHash(body.proof),
      outputs: body.outputs.map(outputMessage),
    },
  } as const;
}

export function requestDigest(record: UnsignedRequest): Hex {
  return hashTypedData(requestTypedData(record));
}

export function submissionDigest(body: SubmissionBody): Hex {
  return hashTypedData(submissionTypedData(body));
}
