import type { Hex } from "viem";
import { z } from "zod";
import type { RegistryScope } from "../../../features/privacyKeys/types";

const hex = (length: number) =>
  z
    .string()
    .regex(new RegExp(`^0x[0-9a-fA-F]{${length * 2}}$`))
    .transform((v) => v.toLowerCase() as Hex);
const address = hex(20),
  hash = hex(32),
  generation = z.number().int().min(0).max(63);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const registryScopeSchema = z
  .string()
  .regex(/^[1-9][0-9]*:0x[0-9a-fA-F]{40}$/)
  .refine((v) => Number.isSafeInteger(Number(v.split(":")[0])))
  .transform((v) => v.toLowerCase() as RegistryScope);
export const publicKeyPairSchema = z.strictObject({
  notePubkey: hash,
  viewPubkey: hash,
});
const evidence = z.strictObject({
  block: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  blockHash: hash,
  txHash: hash.nullable(),
});
const username = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_]+$/);
const deadline = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,77})$/)
  .refine((v) => BigInt(v) < 2n ** 256n);
export const rotationIntentSchema = z
  .strictObject({
    version: z.literal(1),
    id: z.uuid(),
    owner: address,
    registry: registryScopeSchema,
    username,
    expectedRevision: revision,
    from: generation,
    to: generation,
    oldKeys: publicKeyPairSchema,
    newKeys: publicKeyPairSchema,
    deadline,
    signature: hex(65),
  })
  .refine(
    (v) =>
      v.to === v.from + 1 &&
      v.oldKeys.notePubkey !== v.newKeys.notePubkey &&
      v.oldKeys.viewPubkey !== v.newKeys.viewPubkey,
    "Invalid privacy key successor",
  );
export const rotationOperationSchema = z.strictObject({
  intent: rotationIntentSchema,
  phase: z.enum([
    "prepared",
    "submitted",
    "confirming",
    "confirmed",
    "failed",
    "needsReconciliation",
    "conflict",
  ]),
  txHash: hash.nullable(),
  updatedAt: z.iso.datetime(),
  registryAuthorization: z
    .strictObject({ nonce: deadline, deadline, signature: hex(65) })
    .optional(),
  authorizationEvidence: evidence.optional(),
  searchEvidence: evidence.optional(),
});
export const privacyKeyStateSchema = z
  .strictObject({
    version: z.literal(1),
    owner: address,
    registry: registryScopeSchema,
    username,
    revision,
    activeGeneration: generation,
    generations: z
      .array(
        z.strictObject({
          ...publicKeyPairSchema.shape,
          id: generation,
          rotatedAt: z.iso.datetime().optional(),
          evidence,
        }),
      )
      .min(1)
      .max(64),
    pending: rotationOperationSchema.nullable(),
  })
  .refine(
    (v) =>
      v.generations.length === v.activeGeneration + 1 &&
      v.generations.every((entry, id) => entry.id === id) &&
      new Set(v.generations.map((entry) => entry.notePubkey)).size ===
        v.generations.length &&
      new Set(v.generations.map((entry) => entry.viewPubkey)).size ===
        v.generations.length,
    "Privacy history must be complete with distinct generation pairs",
  );
export const bootstrapPrivacyKeysInput = z.strictObject({
  keys: publicKeyPairSchema,
});
export const privacyRotationIdInput = z.strictObject({ id: z.uuid() });
export const registryAuthorizationSchema = z.strictObject({
  nonce: deadline,
  deadline,
  signature: hex(65),
});
export const submitPrivacyRotationInput = z.strictObject({
  id: z.uuid(),
  authorization: registryAuthorizationSchema,
  mode: z.enum(["relay", "wallet"]).optional(),
});
export const markPrivacyRotationInput = z.strictObject({
  id: z.uuid(),
  txHash: hash,
});
export const cashoutCaptureInput = z.strictObject({
  sponsorBatchId: z.uuid().optional(),
  operationId: z.uuid(),
  fundingGeneration: generation,
  keyRevision: revision,
  pool: z.string().regex(/^[1-9][0-9]*:0x[0-9a-f]{40}$/),
  nullifier: hash,
});
export const cashoutFinishInput = z.strictObject({
  operationId: z.uuid(),
  accountTicketId: z.uuid(),
  fundingGeneration: generation,
  keyRevision: revision,
});
