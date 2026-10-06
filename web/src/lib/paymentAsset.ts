import { ASSETS, type AssetSymbol } from "./assets";
import { type PoolScope, resolvePool } from "./pools";
export function paymentAsset(scope: PoolScope) {
  const pool = resolvePool(scope);
  return {
    symbol: pool.asset,
    label: ASSETS[pool.asset].label,
    decimals: pool.tokenDecimals,
  };
}
export function formatAssetUnits(units: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Unsupported token precision.");
  const sign = units < 0n ? "-" : "",
    value = units < 0n ? -units : units,
    base = 10n ** BigInt(decimals),
    whole = value / base;
  const fraction = decimals
    ? (value % base).toString().padStart(decimals, "0").replace(/0+$/, "")
    : "";
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}
export function formatPaymentAmount(units: bigint, scope: PoolScope) {
  const asset = paymentAsset(scope);
  return `${formatAssetUnits(units, asset.decimals)} ${asset.label}`;
}
export function requirePaymentPool(
  scope: PoolScope,
  kind: "transfer" | "request",
) {
  const pool = resolvePool(scope),
    enabled =
      kind === "transfer"
        ? (pool.transferCapable ?? pool.requestCapable)
        : pool.requestCapable;
  if (pool.role !== "active" || !enabled)
    throw new Error(`This pool does not support ${kind} payments.`);
  return pool;
}
export function assetLabelFor(symbol: AssetSymbol) {
  return ASSETS[symbol].label;
}
