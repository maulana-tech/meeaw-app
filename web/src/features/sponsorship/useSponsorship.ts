"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../trpc/client";
import type { QuotaStatus } from "./types";
export function useSponsorship({ enabled = true }: { enabled?: boolean } = {}) {
  const { ready, authenticated, user } = usePrivy();
  const identity = `${ready}:${authenticated}:${user?.id ?? "guest"}`;
  const current = useRef(identity),
    epoch = useRef(0),
    mounted = useRef(false);
  current.current = identity;
  const [data, setData] = useState<{
    identity: string;
    status: QuotaStatus | null;
  }>({ identity, status: null });
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async (): Promise<QuotaStatus | null> => {
    if (!enabled || !ready || (authenticated && !user?.id)) return null;
    const seq = ++epoch.current,
      at = identity;
    const valid = () =>
      mounted.current && current.current === at && epoch.current === seq;
    setLoading(true);
    try {
      const status = authenticated
        ? await api.sponsorship.myQuota.query()
        : await api.sponsorship.availability.query();
      if (!valid()) return null;
      setData({ identity: at, status });
      return status;
    } catch {
      if (valid()) setData({ identity: at, status: null });
      return null;
    } finally {
      if (valid()) setLoading(false);
    }
  }, [enabled, ready, authenticated, user?.id, identity]);
  useEffect(() => {
    mounted.current = true;
    setData({ identity, status: null });
    setLoading(enabled);
    void refresh();
    const update = () => {
      void refresh();
    };
    window.addEventListener("focus", update);
    window.addEventListener("mawee:balance-changed", update);
    return () => {
      mounted.current = false;
      epoch.current++;
      window.removeEventListener("focus", update);
      window.removeEventListener("mawee:balance-changed", update);
    };
  }, [identity, enabled, refresh]);
  const status = data.identity === identity ? data.status : null;
  useEffect(() => {
    if (!enabled || !status?.resetAt) return;
    const wait = Date.parse(status.resetAt) - Date.now() + 250;
    if (wait <= 0 || wait > 86_401_000) return;
    const timer = setTimeout(() => {
      void refresh();
    }, wait);
    return () => clearTimeout(timer);
  }, [enabled, status?.resetAt, refresh]);
  return {
    status,
    loading: enabled && (loading || data.identity !== identity),
    refresh,
  };
}
