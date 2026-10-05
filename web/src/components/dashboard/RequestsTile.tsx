"use client";
import { ArrowUpRight, Inbox } from "lucide-react";
import Link from "next/link";
import { usePendingRequestsCount } from "../../features/requests/hooks/usePendingRequestsCount";
import { REQUESTS_PATH } from "../../lib/auth-routes";
import { dashFocus } from "./styles";
export function RequestsTile() {
  const { count, isLoading, isError } = usePendingRequestsCount();
  return (
    <Link
      href={REQUESTS_PATH}
      aria-label="Open payment requests"
      className={`group block border border-(--dash-line-solid) bg-(--dash-surface) p-5 text-(--dash-fg) transition-colors hover:bg-(--dash-tint) ${dashFocus}`}
    >
      <div className="flex items-center justify-between gap-4">
        <h2 className="dashboard-tile-title">Requests</h2>
        <Inbox className="size-5 text-(--dash-ash)" aria-hidden="true" />
      </div>
      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-mono text-4xl tabular-nums">
          {isLoading || isError ? "—" : count}
        </span>
        <span className="text-sm text-(--dash-ash)">waiting for you</span>
      </div>
      <span className="mt-5 flex items-center gap-2 text-sm font-medium">
        View payment requests
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </span>
    </Link>
  );
}
