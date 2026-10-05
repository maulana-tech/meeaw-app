// The pools this deployment knows about. Exactly one is active (deposits and
// payment requests go there); legacy pools stay discoverable and withdrawable,
// but are never merged across or used to fund a request.
//
// NEXT_PUBLIC_MAWEE_POOLS is a public JSON manifest. It holds addresses only —
// the strict schema rejects anything else, so no RPC credential can ride along.
// Without a manifest, the old single-pool variables describe one pool that can
// keep working as before but is never request-capable.

import { z } from "zod";
import { env } from "../env";
import type { PoolDescriptor, PoolScope } from "../features/requests/types";

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
    scope: scopeKey(e.chainId, e.address),
  }));
  const scopes = new Set(pools.map((p) => p.scope));
  if (scopes.size !== pools.length)
    throw new Error("NEXT_PUBLIC_MAWEE_POOLS lists a pool twice.");
  if (pools.some((p) => p.chainId !== input.chainId))
    throw new Error("NEXT_PUBLIC_MAWEE_POOLS has a pool on another chain.");
  if (pools.filter((p) => p.role === "active").length !== 1)
    throw new Error("NEXT_PUBLIC_MAWEE_POOLS needs exactly one active pool.");
  if (pools.some((p) => p.role === "legacy" && p.requestCapable))
    throw new Error("Legacy pools are withdrawal-only.");
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
      },
    });
  }
  return cached;
}

export function activePool(): PoolDescriptor {
  const active = listPools().find((p) => p.role === "active");
  if (!active) throw new Error("No active pool is configured.");
  return active;
}

export function legacyPools(): readonly PoolDescriptor[] {
  return listPools().filter((p) => p.role === "legacy");
}

/** The active pool when it accepts payment requests, otherwise null. */
export function requestPool(): PoolDescriptor | null {
  const active = activePool();
  return active.requestCapable ? active : null;
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
