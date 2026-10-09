import { getAddress, isAddress } from "viem";
import { z } from "zod";

const address = z
  .string()
  .refine((v) => isAddress(v, { strict: false }))
  .transform((v) => getAddress(v));
export const actionReference = z.object({
  actionId: z.string().min(1).max(160),
});
export const withdrawBatchInput = z.object({
  id: z.string().uuid(),
  pool: z.string().regex(/^\d{1,16}:0x[0-9a-f]{40}$/),
  recipient: address,
  nullifiers: z
    .array(
      z
        .string()
        .regex(/^0x[0-9a-fA-F]{64}$/)
        .transform((v) => v.toLowerCase()),
    )
    .min(1)
    .max(16)
    .refine(
      (values) => new Set(values).size === values.length,
      "Duplicate notes are not allowed.",
    ),
});
export type WithdrawBatchInput = z.infer<typeof withdrawBatchInput>;
