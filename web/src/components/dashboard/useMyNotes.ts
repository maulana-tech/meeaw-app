"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getAccount, type MyNote, scanMyNotes } from "../../lib/notes";
import type { PoolDescriptor } from "../../lib/pools";

type NotesState = {
  notes: MyNote[];
  claimable: bigint;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  indexedAt: string | null;
  error: string | null;
  refresh: () => void;
};

/** Notes in one pool: the active pool unless `pool` names a legacy one. */
export function useMyNotes(
  address: string | null | undefined,
  pool?: PoolDescriptor,
): NotesState {
  const [notes, setNotes] = useState<MyNote[]>([]);
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [indexedAt, setIndexedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const hasResult = useRef(false);
  const previousKey = useRef<string>(`${address}|${pool?.scope}`);

  useEffect(() => {
    void tick;
    const key = `${address}|${pool?.scope}`;
    if (previousKey.current !== key) {
      hasResult.current = false;
      previousKey.current = key;
    }
    const account = address ? getAccount() : null;
    if (!account) {
      setNotes([]);
      setClaimable(0n);
      setLoading(false);
      setRefreshing(false);
      setStale(false);
      setIndexedAt(null);
      setError(null);
      hasResult.current = false;
      return;
    }
    let cancelled = false;
    const initiallyLoaded = hasResult.current;
    setLoading(!initiallyLoaded);
    setRefreshing(initiallyLoaded);
    setError(null);

    const applyResult = (result: Awaited<ReturnType<typeof scanMyNotes>>) => {
      setNotes(result.notes);
      setClaimable(result.claimable);
      setIndexedAt(result.indexedAt);
      setStale(result.health !== "healthy");
      hasResult.current = true;
    };

    void (async () => {
      try {
        if (!initiallyLoaded) {
          const cached = await scanMyNotes(account, {
            refresh: false,
            pool,
            includeRequestRecovery: true,
            includeTransferRecovery: true,
          });
          if (!cancelled && cached.mirrorAvailable) {
            applyResult(cached);
            setLoading(false);
            setRefreshing(true);
          }
        }
        const result = await scanMyNotes(account, {
          pool,
          includeRequestRecovery: true,
          includeTransferRecovery: true,
        });
        if (!cancelled) applyResult(result);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load notes");
        setStale(hasResult.current);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, tick, pool]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!address) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("mawee:balance-changed", refresh);
    document.addEventListener("visibilitychange", onFocus);
    const id = window.setInterval(onFocus, 20_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("mawee:balance-changed", refresh);
      document.removeEventListener("visibilitychange", onFocus);
      window.clearInterval(id);
    };
  }, [address, refresh]);

  return {
    notes,
    claimable,
    loading,
    refreshing,
    stale,
    indexedAt,
    error,
    refresh,
  };
}
