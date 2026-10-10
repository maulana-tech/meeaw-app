"use client";

import { agoraFundingUrl } from "../lib/agora";
import type { PoolDescriptor } from "../lib/pools";

export function AgoraFundingNotice({
  pool,
  onRefresh,
  disabled = false,
  className = "",
}: {
  pool: PoolDescriptor;
  onRefresh: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const url = agoraFundingUrl(pool);
  if (!url) return null;
  const action =
    "inline-flex min-h-11 items-center text-xs font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2";
  return (
    <div className={`grid gap-1 text-sm leading-6 ${className}`}>
      <p>
        Fund this wallet with Agora's official test AUSD on Monad Testnet. Use
        the faucet listed in Agora's documentation, then refresh your wallet
        balance.
      </p>
      <div className="flex flex-wrap gap-x-5">
        <a
          className={action}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Agora testnet faucet
        </a>
        <button
          className={`${action} disabled:opacity-50`}
          type="button"
          onClick={onRefresh}
          disabled={disabled}
        >
          Refresh wallet balance
        </button>
      </div>
    </div>
  );
}
