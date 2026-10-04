import "server-only";

import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);
export const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  MONGODB_URI: optionalString,
  CRON_SECRET: optionalString,
  PRIVY_APP_ID: optionalString,
  PRIVY_APP_SECRET: optionalString,
  // Hot wallet that submits users' signed/proved transactions and pays gas.
  // Keep it funded with only a small amount of MON.
  RELAYER_PRIVATE_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hex key")
      .optional(),
  ),
  // RPC for the relayer's writes (e.g. Alchemy:
  // https://monad-testnet.g.alchemy.com/v2/<key>). Server-only because the
  // URL embeds an API key. Falls back to NEXT_PUBLIC_MONAD_RPC_URL.
  RELAYER_RPC_URL: z.preprocess(
    emptyToUndefined,
    z.string().trim().url().optional(),
  ),
  // Envio HyperIndex GraphQL endpoint (indexer/). When set, wallet scanning
  // and pool stats read from Envio instead of the eth_getLogs poller.
  ENVIO_GRAPHQL_URL: z.preprocess(
    emptyToUndefined,
    z.string().trim().url().optional(),
  ),
  // Max block span per eth_getLogs request; public Monad RPCs cap this.
  MONAD_LOGS_BLOCK_RANGE: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(100_000).default(100),
  ),
});

export function getServerEnv() {
  return serverEnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    MONGODB_URI: process.env.MONGODB_URI,
    CRON_SECRET: process.env.CRON_SECRET,
    PRIVY_APP_ID: process.env.PRIVY_APP_ID,
    PRIVY_APP_SECRET: process.env.PRIVY_APP_SECRET,
    RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY,
    ENVIO_GRAPHQL_URL: process.env.ENVIO_GRAPHQL_URL,
    RELAYER_RPC_URL: process.env.RELAYER_RPC_URL,
    MONAD_LOGS_BLOCK_RANGE: process.env.MONAD_LOGS_BLOCK_RANGE,
  });
}

export type ServerEnv = z.infer<typeof serverEnvSchema>;
