import { z } from "zod";
import { poolScopeSchema } from "../../../features/requests/validation";

const hash = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((v) => v as `0x${string}`);
const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const receiptChainInput = z.strictObject({
  pool: poolScopeSchema,
  blockNumber: safeInteger,
  blockHash: hash.optional(),
});
export const receiptChainOutput = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("available"),
    snapshot: z.strictObject({
      pool: poolScopeSchema,
      chainId: safeInteger,
      blockNumber: safeInteger,
      blockHash: hash,
      root: hash,
      leafCount: safeInteger.max(2 ** 20),
      token: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .transform((v) => v as `0x${string}`),
      tokenDecimals: z.number().int().min(0).max(18),
      headBlock: safeInteger,
      confirmed: z.boolean(),
    }),
  }),
  z.strictObject({
    status: z.literal("unavailable"),
    reason: z.string().max(80),
  }),
  z.strictObject({ status: z.literal("mismatch"), reason: z.string().max(80) }),
]);
