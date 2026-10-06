"use client";
import { ASSETS } from "../../lib/assets";
import {
  activePools,
  type PoolDescriptor,
  type PoolScope,
} from "../../lib/pools";
export function PaymentAssetSelect({
  value,
  onChange,
  kind,
  disabled = false,
}: {
  value: PoolScope;
  onChange: (pool: PoolDescriptor) => void;
  kind: "request" | "transfer" | "payment";
  disabled?: boolean;
}) {
  const pools = activePools().filter((p) =>
    kind === "payment"
      ? true
      : kind === "request"
        ? p.requestCapable
        : (p.transferCapable ?? p.requestCapable),
  );
  return (
    <label className="grid gap-2 text-sm font-medium">
      Asset
      <select
        aria-label="Payment asset"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const pool = pools.find((p) => p.scope === e.target.value);
          if (pool) onChange(pool);
        }}
        className="min-h-11 rounded-lg border border-input bg-card px-3 text-base"
      >
        {!pools.some((p) => p.scope === value) && (
          <option value={value} disabled>
            Choose an available asset
          </option>
        )}
        {pools.map((p) => (
          <option key={p.scope} value={p.scope}>
            {ASSETS[p.asset].label}
          </option>
        ))}
      </select>
    </label>
  );
}
