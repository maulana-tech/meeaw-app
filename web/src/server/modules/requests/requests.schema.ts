import { z } from "zod";
import {
  envelopeSchema,
  participantSchema,
  poolScopeSchema,
  requestIdSchema,
  signedRequestSchema,
} from "../../../features/requests/validation";

// Transport schemas for the requests router. Inputs never carry plaintext
// amounts or notes: a request arrives as signed metadata plus two opaque,
// fixed-size envelopes.

export const createRequestInput = signedRequestSchema;

/** Opaque, bounded pagination cursor. */
export const listRequestsInput = z
  .strictObject({ cursor: z.string().min(1).max(200).optional() })
  .optional();

export const requestIdInput = z.strictObject({ id: requestIdSchema });

export const requestTransitionInput = z.strictObject({
  id: requestIdSchema,
  revision: z.number().int().nonnegative(),
});

const hex = z.string().regex(/^0x[0-9a-f]*$/i);

export const paymentRequestOutput = z.strictObject({
  version: z.literal(1),
  id: requestIdSchema,
  pool: poolScopeSchema,
  requester: participantSchema,
  addressee: participantSchema,
  createdAt: z.string(),
  recipientCommitment: hex,
  requesterEnvelope: envelopeSchema,
  addresseeEnvelope: envelopeSchema,
  signature: hex,
  status: z.enum(["pending", "paid", "declined", "cancelled"]),
  revision: z.number().int().nonnegative(),
  operationId: z.string().nullable(),
  updatedAt: z.string(),
  receipt: z
    .strictObject({
      txHash: hex,
      leafIndex: z.number().int().nonnegative(),
      block: z.number().int().nonnegative(),
    })
    .nullable(),
});

export const requestPageOutput = z.strictObject({
  items: paymentRequestOutput.array(),
  nextCursor: z.string().nullable(),
});

export const pendingCountOutput = z.number().int().nonnegative();
