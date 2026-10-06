"use client";

import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { PoolDescriptor } from "../lib/pools";
import { api } from "../trpc/client";

type Stats = Awaited<ReturnType<typeof api.deposits.stats.query>>;

/**
 * How many unspent notes a withdrawal could have come from. A bigger set
 * means stronger unlinkability, so it is worth showing payers and recipients.
 */
export function PrivacyPoolStat({
  className = "",
  pool,
}: {
  className?: string;
  pool?: PoolDescriptor;
}) {
  const [stats, setStats] = useState<Stats | null>(null);
  const scope = pool?.scope;

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    api.deposits.stats
      .query(scope ? { pool: scope } : undefined)
      .then((value) => {
        if (!cancelled) setStats(value);
      })
      .catch(() => {
        // Stats are informational; hide the badge if they are unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  if (!stats || stats.notes === 0) return null;
  const set = stats.anonymitySet.toLocaleString("en-US");
  return (
    <p
      className={`flex items-center justify-center gap-2 text-xs text-brand-linen/60 ${className}`}
      title={`${stats.notes.toLocaleString("en-US")} notes created, ${stats.spent.toLocaleString("en-US")} spent`}
    >
      <ShieldCheck className="size-4" aria-hidden="true" />
      <span>
        Hidden among <strong className="text-brand-linen/85">{set}</strong>{" "}
        private {stats.anonymitySet === 1 ? "payment" : "payments"} in the pool
      </span>
    </p>
  );
}
