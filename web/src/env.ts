import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);
const optionalUrl = z.preprocess(
  emptyToUndefined,
  z.string().trim().url().optional(),
);
const optionalAddress = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed EVM address")
    .optional(),
);

export const publicEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  // 10143 = Monad testnet, 143 = Monad mainnet, 31337 = local Hardhat node.
  NEXT_PUBLIC_MONAD_CHAIN_ID: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(10143),
  ),
  NEXT_PUBLIC_MONAD_RPC_URL: optionalUrl,
  NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS: optionalAddress,
  NEXT_PUBLIC_MAWEE_POOL_ADDRESS: optionalAddress,
  NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).default(0),
  ),
  NEXT_PUBLIC_USDC_ADDRESS: optionalAddress,
  NEXT_PUBLIC_USDC_DECIMALS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(18).default(6),
  ),
  // True when the pool asset is the testnet MockUSDC anyone can mint.
  NEXT_PUBLIC_USDC_MINTABLE: z.preprocess(
    emptyToUndefined,
    z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  ),
  NEXT_PUBLIC_POOL_DEPTH: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(32).default(20),
  ),
  NEXT_PUBLIC_PRIVY_APP_ID: optionalString,
});

/**
 * Keep every public variable as a direct property access. Next.js only embeds
 * NEXT_PUBLIC_* values in browser bundles when it can see this static form.
 */
export function getPublicEnv() {
  return publicEnvSchema.parse({
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_MONAD_CHAIN_ID: process.env.NEXT_PUBLIC_MONAD_CHAIN_ID,
    NEXT_PUBLIC_MONAD_RPC_URL: process.env.NEXT_PUBLIC_MONAD_RPC_URL,
    NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS:
      process.env.NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS,
    NEXT_PUBLIC_MAWEE_POOL_ADDRESS: process.env.NEXT_PUBLIC_MAWEE_POOL_ADDRESS,
    NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK:
      process.env.NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK,
    NEXT_PUBLIC_USDC_ADDRESS: process.env.NEXT_PUBLIC_USDC_ADDRESS,
    NEXT_PUBLIC_USDC_DECIMALS: process.env.NEXT_PUBLIC_USDC_DECIMALS,
    NEXT_PUBLIC_USDC_MINTABLE: process.env.NEXT_PUBLIC_USDC_MINTABLE,
    NEXT_PUBLIC_POOL_DEPTH: process.env.NEXT_PUBLIC_POOL_DEPTH,
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
  });
}

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const env: PublicEnv = getPublicEnv();
