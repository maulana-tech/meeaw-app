import { z } from "zod";

export const listDepositsInput = z
  .object({ since: z.number().int().gte(-1).optional() })
  .optional();

export const depositOutput = z.object({
  leafIndex: z.number(),
  commitmentHex: z.string(),
  ephemeralPkHex: z.string(),
  ciphertextHex: z.string(),
  block: z.number(),
  txHash: z.string(),
  ts: z.string(),
});

export const poolSnapshotInput = z
  .object({
    afterLeafIndex: z.number().int().gte(-1).optional(),
    spentAfterBlock: z.number().int().nonnegative().optional(),
  })
  .optional();

export const poolSnapshotOutput = z.object({
  deposits: depositOutput.array(),
  spentNullifiers: z
    .object({
      nullifierHex: z.string().regex(/^[0-9a-f]{64}$/),
      block: z.number().int().nonnegative(),
      ts: z.string(),
    })
    .array(),
  index: z.object({
    poolAddress: z.string(),
    network: z.string(),
    publishedBlock: z.number().int().nonnegative(),
    publishedLeafIndex: z.number().int().gte(-1),
    indexedAt: z.string(),
    health: z.enum(["healthy", "stale", "degraded"]),
  }),
});

export const poolStatsOutput = z.object({
  source: z.enum(["envio", "rpc"]),
  notes: z.number().int().nonnegative(),
  spent: z.number().int().nonnegative(),
  anonymitySet: z.number().int().nonnegative(),
  withdrawals: z.number().int().nonnegative().nullable(),
  shieldedTransfers: z.number().int().nonnegative().nullable(),
  accounts: z.number().int().nonnegative().nullable(),
  paused: z.boolean(),
});

export type ListDepositsInput = z.infer<typeof listDepositsInput>;
export type DepositOutput = z.infer<typeof depositOutput>;
export type PoolSnapshotOutput = z.infer<typeof poolSnapshotOutput>;
export type PoolStatsOutput = z.infer<typeof poolStatsOutput>;
