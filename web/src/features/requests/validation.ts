import { z } from "zod";
import type { Hex, PoolScope } from "./types";

// BN254 scalar field (note commitments, nullifiers, roots, owner keys).
export const SNARK_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
// BN254 base field (Groth16 proof point coordinates).
export const PROOF_FIELD =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const MAX_REQUEST_AMOUNT = (1n << 64n) - 1n;
export const MAX_NOTE_CHARS = 200;

// Envelope ciphertext = nonce(24) ‖ XChaCha20-Poly1305(frame(4096)) ‖ tag(16).
// The frame is fixed-size padding, so ciphertext length never reveals note length.
export const REQUEST_FRAME_SIZE = 4096;
export const ENVELOPE_CIPHERTEXT_BYTES = 24 + REQUEST_FRAME_SIZE + 16;

export function parseRequestAmount(raw: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Invalid token precision.");
  const text = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error("Enter a valid amount.");
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error("Too many decimal places.");
  const units =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units <= 0n || units > MAX_REQUEST_AMOUNT)
    throw new Error("Amount is outside the supported range.");
  return units;
}

/** Counts Unicode code points, so an emoji is one character, not two. */
export function validateRequestNote(note: string): string {
  const text = note.trim();
  if ([...text].length > MAX_NOTE_CHARS)
    throw new Error(`Use ${MAX_NOTE_CHARS} characters or fewer.`);
  return text;
}

export function parsePoolScope(scope: string): {
  chainId: number;
  address: Hex;
} {
  const match = /^([1-9]\d{0,15}):(0x[0-9a-f]{40})$/.exec(scope);
  if (!match) throw new Error("Invalid pool scope.");
  const chainId = Number(match[1]);
  if (!Number.isSafeInteger(chainId)) throw new Error("Invalid pool scope.");
  return { chainId, address: match[2] as Hex };
}

const hexBytes = (bytes: number) =>
  z
    .string()
    .regex(
      new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`),
    ) as unknown as z.ZodType<Hex>;

const fieldElement = hexBytes(32).refine(
  (v) => BigInt(v) < SNARK_FIELD,
  "not a field element",
) as unknown as z.ZodType<Hex>;

const decimalBelow = (bound: bigint) =>
  z
    .string()
    .regex(/^(0|[1-9]\d{0,77})$/)
    .refine((v) => BigInt(v) < bound, "out of range");

export const poolScopeSchema = z.string().refine((v) => {
  try {
    parsePoolScope(v);
    return true;
  } catch {
    return false;
  }
}, "invalid pool scope") as unknown as z.ZodType<PoolScope>;

export const requestIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );

const canonicalTimestamp = z.string().refine((v) => {
  const t = Date.parse(v);
  return Number.isFinite(t) && new Date(t).toISOString() === v;
}, "timestamp must be canonical ISO-8601 UTC");

const walletSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase() as Hex);

export const participantSchema = z.strictObject({
  // Signed snapshot: must already be canonical (no trimming or lowercasing here).
  username: z.string().regex(/^[a-z0-9_]{3,32}$/),
  wallet: walletSchema,
  notePubkey: fieldElement,
  viewPubkey: hexBytes(32),
});

export const envelopeSchema = z.strictObject({
  ephemeralPk: hexBytes(32),
  ciphertext: hexBytes(ENVELOPE_CIPHERTEXT_BYTES),
});

const signatureSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2}){65,2048}$/) as unknown as z.ZodType<Hex>;

const metadataShape = {
  version: z.literal(1),
  id: requestIdSchema,
  pool: poolScopeSchema,
  requester: participantSchema,
  addressee: participantSchema,
  createdAt: canonicalTimestamp,
  recipientCommitment: fieldElement,
};

type ParticipantPair = {
  requester: { username: string; wallet: string };
  addressee: { username: string; wallet: string };
};

function rejectSelfRequest(value: ParticipantPair, ctx: z.RefinementCtx) {
  if (
    value.requester.wallet.toLowerCase() ===
      value.addressee.wallet.toLowerCase() ||
    value.requester.username === value.addressee.username
  )
    ctx.addIssue({
      code: "custom",
      message: "You cannot request a payment from yourself.",
      path: ["addressee"],
    });
}

export const requestMetadataSchema = z
  .strictObject(metadataShape)
  .superRefine(rejectSelfRequest);

export const signedRequestSchema = z
  .strictObject({
    ...metadataShape,
    requesterEnvelope: envelopeSchema,
    addresseeEnvelope: envelopeSchema,
    signature: signatureSchema,
  })
  .superRefine(rejectSelfRequest);

export const requestPayloadSchema = z.strictObject({
  metadata: requestMetadataSchema,
  amount: decimalBelow(MAX_REQUEST_AMOUNT + 1n).refine(
    (v) => BigInt(v) > 0n,
    "amount must be positive",
  ),
  note: z
    .string()
    .refine(
      (v) => v === v.trim() && [...v].length <= MAX_NOTE_CHARS,
      "invalid note",
    ),
  salt: decimalBelow(SNARK_FIELD),
});

const proofCoord = decimalBelow(PROOF_FIELD);
export const proofWireSchema = z.strictObject({
  a: z.tuple([proofCoord, proofCoord]),
  b: z.tuple([
    z.tuple([proofCoord, proofCoord]),
    z.tuple([proofCoord, proofCoord]),
  ]),
  c: z.tuple([proofCoord, proofCoord]),
});

export const noteOutputSchema = z.strictObject({
  commitment: fieldElement,
  ephemeralPk: hexBytes(32),
  // Ordinary note ciphertexts are 88 bytes; bound calldata without fixing format.
  ciphertext: z
    .string()
    .regex(/^0x([0-9a-fA-F]{2}){1,512}$/) as unknown as z.ZodType<Hex>,
});

export const submissionBodySchema = z.strictObject({
  version: z.literal(1),
  requestId: requestIdSchema,
  operationId: requestIdSchema,
  step: z.number().int().min(0).max(4096),
  pool: poolScopeSchema,
  kind: z.enum(["merge", "split", "payment"]),
  root: fieldElement,
  nullifiers: z.array(fieldElement).min(1).max(2),
  proof: proofWireSchema,
  outputs: z.array(noteOutputSchema).min(1).max(2),
});

export const signedSubmissionSchema = submissionBodySchema.extend({
  signature: signatureSchema,
});
