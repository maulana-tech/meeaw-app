"use client";
import { ASSETS } from "../../lib/assets";
import {
  activePools,
  type PoolDescriptor,
  type PoolScope,
} from "../../lib/pools";
import { CoinIcon } from "../ui/coin-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

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
  const selected = pools.find((p) => p.scope === value);
  return (
    <div className="grid gap-2 text-sm font-medium">
      <span>Asset</span>
      <Select
        value={selected ? value : null}
        disabled={disabled}
        onValueChange={(scope) => {
          const pool = pools.find((p) => p.scope === scope);
          if (pool) onChange(pool);
        }}
      >
        <SelectTrigger aria-label="Payment asset">
          <SelectValue
            className="flex min-w-0 items-center gap-2.5"
            placeholder="Choose an available asset"
          >
            {(scope: PoolScope | null) => {
              const pool = pools.find((p) => p.scope === scope);
              if (!pool) return "Choose an available asset";
              const asset = ASSETS[pool.asset];
              return (
                <>
                  <CoinIcon symbol={asset.label} logo={asset.logo} />
                  <span className="truncate">{asset.label}</span>
                </>
              );
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {pools.map((p) => {
            const asset = ASSETS[p.asset];
            return (
              <SelectItem key={p.scope} value={p.scope}>
                <CoinIcon symbol={asset.label} logo={asset.logo} />
                <span className="min-w-0">
                  <span className="block font-medium">{asset.label}</span>
                  <span className="block text-xs font-normal text-foreground/60">
                    {asset.name}
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
