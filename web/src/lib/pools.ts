// The pools this deployment knows about. Each pool holds one stablecoin
// (`asset`); exactly one pool per asset is active and takes new deposits.
// Legacy pools stay discoverable and withdrawable, but are never merged across
// or used to fund a request. At most one active pool accepts payment requests.
//
// NEXT_PUBLIC_MAWEE_POOLS is a public JSON manifest. It holds addresses only —
// the strict schema rejects anything else, so no RPC credential can ride along.
// Without a manifest, the old single-pool variables describe one pool that can
// keep working as before but is never request-capable.

import { z } from "zod";
import { env } from "../env";
import type { PoolDescriptor, PoolScope } from "../features/requests/types";
import { ASSET_SYMBOLS, ASSETS, MONAD_MAINNET_CHAIN_ID } from "./assets";

export type { PoolDescriptor, PoolScope };

const MAX_MANIFEST_CHARS = 8192;
const MAX_POOLS = 8;
const ZERO = "0x0000000000000000000000000000000000000000";

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => v.toLowerCase() as `0x${string}`);

const manifestEntry = z.strictObject({
  chainId: z.number().int().positive(),
  address,
  deployBlock: z.number().int().nonnegative(),
  token: address,
  tokenDecimals: z.number().int().min(0).max(18),
  depth: z.literal(20),
  confirmations: z.number().int().min(1).max(64).default(1),
  role: z.enum(["active", "legacy"]),
  requestCapable: z.boolean(),
  transferCapable: z.boolean().optional(),
  // Optional so manifests written before multi-asset pools stay valid.
  asset: z.enum(ASSET_SYMBOLS).default("USDC"),
  // Absent on older manifests: their USDC pool keeps following
  // NEXT_PUBLIC_USDC_MINTABLE, every other asset defaults to not mintable.
  mintable: z.boolean().optional(),
});

export function scopeKey(chainId: number, addr: `0x${string}`): PoolScope {
  return `${chainId}:${addr.toLowerCase()}`;
}

export function scopedLeafId(scope: PoolScope, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0)
    throw new Error("Invalid leaf index.");
  return `${scope}:${index}`;
}

/** Key of a pool's browser IndexedDB mirror; unchanged from single-pool days. */
export function mirrorScope(pool: PoolDescriptor): string {
  return `eip155:${pool.chainId}:${pool.address}`;
}

export function parsePoolManifest(input: {
  manifest: string | undefined;
  chainId: number;
  legacy: {
    address: string | undefined;
    deployBlock: number;
    token: string | undefined;
    tokenDecimals: number;
    mintable: boolean;
  };
}): readonly PoolDescriptor[] {
  if (!input.manifest) {
    const addr = (input.legacy.address ?? ZERO).toLowerCase() as `0x${string}`;
    return [
      {
        scope: scopeKey(input.chainId, addr),
        chainId: input.chainId,
        address: addr,
        deployBlock: input.legacy.deployBlock,
        token: (input.legacy.token ?? ZERO).toLowerCase() as `0x${string}`,
        tokenDecimals: input.legacy.tokenDecimals,
        depth: 20,
        confirmations: 1,
        role: "active",
        requestCapable: false,
        transferCapable: false,
        asset: "USDC",
        mintable: input.legacy.mintable,
      },
    ];
  }
  if (input.manifest.length > MAX_MANIFEST_CHARS)
    throw new Error("NEXT_PUBLIC_MAWEE_POOLS is too large.");
  let raw: unknown;
  try {
    raw = JSON.parse(input.manifest);
  } catch {
    throw new Error("NEXT_PUBLIC_MAWEE_POOLS is not valid JSON.");
  }
  const entries = z.array(manifestEntry).min(1).max(MAX_POOLS).parse(raw);

  const pools: PoolDescriptor[] = entries.map((e) => ({
    ...e,
    transferCapable: e.transferCapable ?? e.requestCapable,
    mintable: e.mintable ?? (e.asset === "USDC" && input.legacy.mintable),
    scope: scopeKey(e.chainId, e.address),
  }));
  const scopes = new Set(pools.map((p) => p.scope));
  if (scopes.size !== pools.length)
    throw new Error("NEXT_PUBLIC_MAWEE_POOLS lists a pool twice.");
  if (pools.some((p) => p.chainId !== input.chainId))
    throw new Error("NEXT_PUBLIC_MAWEE_POOLS has a pool on another chain.");
  const actives = pools.filter((p) => p.role === "active");
  if (actives.length === 0)
    throw new Error("NEXT_PUBLIC_MAWEE_POOLS needs an active pool.");
  if (new Set(actives.map((p) => p.asset)).size !== actives.length)
    throw new Error(
      "NEXT_PUBLIC_MAWEE_POOLS has two active pools for one asset.",
    );
  if (pools.some((p) => p.role === "legacy" && p.requestCapable))
    throw new Error("Legacy pools are withdrawal-only.");
  if (pools.some((p) => p.role === "legacy" && p.transferCapable))
    throw new Error("Legacy pools are withdrawal-only.");
  // ponytail: amounts are formatted with one app-wide decimals setting, so every
  // pool must match it. Per-pool formatting is needed before an 18-decimal
  // asset (e.g. WMON) can be added.
  if (pools.some((p) => p.tokenDecimals !== input.legacy.tokenDecimals))
    throw new Error("Every pool must use NEXT_PUBLIC_USDC_DECIMALS decimals.");
  if (input.chainId === MONAD_MAINNET_CHAIN_ID) {
    for (const p of pools) {
      if (p.mintable) throw new Error("Mainnet pools cannot be mintable.");
      if (p.token !== ASSETS[p.asset].mainnetAddress)
        throw new Error(`${p.asset} pool does not hold the canonical token.`);
    }
  }
  return pools;
}

let cached: readonly PoolDescriptor[] | null = null;

export function listPools(): readonly PoolDescriptor[] {
  if (!cached) {
    cached = parsePoolManifest({
      manifest: env.NEXT_PUBLIC_MAWEE_POOLS,
      chainId: env.NEXT_PUBLIC_MONAD_CHAIN_ID,
      legacy: {
        address: env.NEXT_PUBLIC_MAWEE_POOL_ADDRESS,
        deployBlock: env.NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK,
        token: env.NEXT_PUBLIC_USDC_ADDRESS,
        tokenDecimals: env.NEXT_PUBLIC_USDC_DECIMALS,
        mintable:
          env.NEXT_PUBLIC_USDC_MINTABLE &&
          env.NEXT_PUBLIC_MONAD_CHAIN_ID !== MONAD_MAINNET_CHAIN_ID,
      },
    });
  }
  return cached;
}

/** Every pool that takes new deposits, one per asset, USDC first. */
export function activePools(): readonly PoolDescriptor[] {
  return listPools()
    .filter((p) => p.role === "active")
    .sort((a, b) => Number(b.asset === "USDC") - Number(a.asset === "USDC"));
}

/**
 * The primary active pool: USDC when configured. Callers that are not
 * asset-aware yet (requests, history defaults) keep using this one.
 */
export function activePool(): PoolDescriptor {
  const active = activePools()[0];
  if (!active) throw new Error("No active pool is configured.");
  return active;
}

export function activePoolFor(asset: string): PoolDescriptor | null {
  return activePools().find((p) => p.asset === asset) ?? null;
}

export function legacyPools(): readonly PoolDescriptor[] {
  return listPools().filter((p) => p.role === "legacy");
}

/** The active pool that accepts payment requests, otherwise null. */
export function requestPool(asset?: string): PoolDescriptor | null {
  return (
    activePools().find(
      (p) => p.requestCapable && (!asset || p.asset === asset),
    ) ?? null
  );
}

/** Only approved scopes resolve; arbitrary caller-supplied pools never do. */
export function findPool(scope: string): PoolDescriptor | null {
  return listPools().find((p) => p.scope === scope) ?? null;
}

export function resolvePool(scope: string): PoolDescriptor {
  const pool = findPool(scope);
  if (!pool) throw new Error("Unknown pool.");
  return pool;
}
