"use client";

import { useEffect, useState } from "react";
import { getPrivacyKeyring } from "../../features/privacyKeys/session";
import { getAccount, scanKeyringNotes, scanMyNotes } from "../../lib/notes";
import { legacyPools, type PoolScope } from "../../lib/pools";

/**
 * Unspent balance per legacy pool, for showing that withdraw-only funds exist.
 * Legacy balances are never added to the active balance: they cannot fund
 * payment requests. A failed scan is left out rather than shown as zero.
 */
export function useLegacyBalances(
  address: string | null | undefined,
): ReadonlyMap<PoolScope, bigint> {
  const [balances, setBalances] = useState<ReadonlyMap<PoolScope, bigint>>(
    () => new Map(),
  );
  const ring = getPrivacyKeyring();

  useEffect(() => {
    const account = address ? getAccount() : null;
    const pools = legacyPools();
    if (!account || pools.length === 0) {
      setBalances(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<PoolScope, bigint>();
      for (const pool of pools) {
        try {
          const scan = ring
            ? await scanKeyringNotes(ring, pool)
            : await scanMyNotes(account, { pool });
          next.set(pool.scope, scan.claimable);
        } catch {
          // Unknown, not zero: keep it out of the map.
        }
      }
      if (!cancelled && getPrivacyKeyring() === ring) setBalances(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [address, ring]);

  return balances;
}
