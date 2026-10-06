import { z } from "zod";
import {
  envelopeSchema,
  MAX_REQUEST_AMOUNT,
  parseRequestAmount,
  participantSchema,
  poolScopeSchema,
  requestIdSchema,
  SNARK_FIELD,
  signedSubmissionSchema,
  submissionBodySchema,
  validateRequestNote,
} from "../requests/validation";

const signatureSchema = signedSubmissionSchema.shape.signature;

export const parseTransferAmount = parseRequestAmount;
export const validateTransferNote = validateRequestNote;
const metadata = {
  version: z.literal(1),
  id: requestIdSchema,
  pool: poolScopeSchema,
  sender: participantSchema,
  recipient: participantSchema,
  createdAt: z
    .string()
    .refine(
      (v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v,
    ),
  recipientCommitment: submissionBodySchema.shape.root,
};
function rejectSelf(
  v: {
    sender: { wallet: string; username: string };
    recipient: { wallet: string; username: string };
  },
  ctx: z.RefinementCtx,
) {
  if (
    v.sender.wallet.toLowerCase() === v.recipient.wallet.toLowerCase() ||
    v.sender.username === v.recipient.username
  )
    ctx.addIssue({
      code: "custom",
      message: "You cannot send to yourself.",
      path: ["recipient"],
    });
}
export const transferMetadataSchema = z
  .strictObject(metadata)
  .superRefine(rejectSelf);
export const signedTransferSchema = z
  .strictObject({
    ...metadata,
    senderEnvelope: envelopeSchema,
    recipientEnvelope: envelopeSchema,
    signature: signatureSchema,
  })
  .superRefine(rejectSelf);
const decimal = (max: bigint) =>
  z
    .string()
    .regex(/^(0|[1-9]\d{0,77})$/)
    .refine((v) => BigInt(v) < max);
export const transferPayloadSchema = z.strictObject({
  metadata: transferMetadataSchema,
  amount: decimal(MAX_REQUEST_AMOUNT + 1n).refine((v) => BigInt(v) > 0n),
  note: z.string().refine((v) => v === v.trim() && [...v].length <= 200),
  salt: decimal(SNARK_FIELD),
});
export const transferSubmissionSchema = submissionBodySchema
  .omit({ requestId: true })
  .extend({
    transferId: requestIdSchema,
    recoveryEnvelope: envelopeSchema,
    signature: signatureSchema,
  })
  .superRefine((s, ctx) => {
    if (
      s.nullifiers.length !== (s.kind === "merge" ? 2 : 1) ||
      s.outputs.length !== (s.kind === "merge" ? 1 : 2) ||
      new Set(s.nullifiers.map((n) => n.toLowerCase())).size !==
        s.nullifiers.length
    )
      ctx.addIssue({ code: "custom", message: "Invalid submission shape." });
  });
