import type { AssetSymbol } from "./assets";
import {
  activePoolFor,
  activePools,
  type PoolDescriptor,
  type PoolScope,
} from "./pools";
export function resolveCheckoutPool(
  link:
    | { asset?: AssetSymbol; amount?: string | null; tokenDecimals?: number }
    | null
    | undefined,
  selected?: PoolScope,
): PoolDescriptor {
  const pool = link
    ? activePoolFor(link.asset ?? "USDC")
    : selected
      ? activePools().find((p) => p.scope === selected)
      : activePools()[0];
  if (!pool || pool.role === "legacy")
    throw new Error("This payment asset is unavailable.");
  if (
    link?.tokenDecimals !== undefined &&
    link.tokenDecimals !== pool.tokenDecimals
  )
    throw new Error("The payment asset precision changed. Refresh this link.");
  return pool;
}
