"use client";

import { ChevronRight, Download, FileCheck } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useMemo, useState } from "react";
import { HISTORY_PATH } from "../../lib/auth-routes";
import { fromBaseUnits } from "../../lib/crypto";
import type { MyNote } from "../../lib/notes";
import { activePool } from "../../lib/pools";
import { buildActivityRows,csvActivity } from "../../features/payments/activityRows";
import type { ActivityRow } from "../../features/payments/activityTypes";
import { cn } from "../../lib/utils";
import { Card } from "../ui/card";
import { DiscloseDialog } from "./DiscloseDialog";
import { dashButtonSecondary, dashFocus, dashIconButton } from "./styles";

type ActivityEvent = ActivityRow;

const TABS = ["All", "Received", "Sent", "Cashed out"] as const;
type Tab = (typeof TABS)[number];

function toEvents(notes: MyNote[]): ActivityEvent[] {
  return [...buildActivityRows({notes,transfers:[],payloads:new Map(),evidence:[],viewer:"0x0000000000000000000000000000000000000000"})];
}

function formatWhen(value: string | undefined): string {
  if (!value) return "Private note";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Private note";
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function exportCsv(events: readonly ActivityEvent[]) {
  const blob = new Blob([csvActivity(events)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mawee-receipts.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ActivityFeed({
  notes,
  rows,
  onTransferOpen,
  loading,
  limit,
  showSeeAll = false,
  showExport = false,
  showFilters = true,
  title = "History",
  emptyAction,
  className,
}: {
  notes: MyNote[];
  rows?:readonly ActivityRow[];
  onTransferOpen?:(id:string)=>void;
  loading: boolean;
  limit?: number;
  showSeeAll?: boolean;
  showExport?: boolean;
  showFilters?: boolean;
  title?: string;
  emptyAction?: ReactNode;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>("All");
  const [discloseLeaf, setDiscloseLeaf] = useState<number | null>(null);
  const events = useMemo(() => rows??toEvents(notes), [notes,rows]);
  const filtered = useMemo(() => {
    if (tab === "Received") return events.filter((e) => e.kind === "received");
    if (tab === "Sent") return events.filter((e) => e.kind === "sent");
    if (tab === "Cashed out")
      return events.filter((e) => e.kind === "cashedOut");
    return events;
  }, [events, tab]);
  const displayed = limit === undefined ? filtered : filtered.slice(0, limit);
  const skeletonCount = limit ?? 5;

  return (
    <Card
      appearance="linen"
      id="activity"
      className={cn("h-full gap-4 p-6", className)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="dashboard-tile-title">{title}</h2>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {showFilters ? (
            <fieldset className="flex max-w-full flex-wrap items-center rounded-full border border-(--dash-line) p-0.5">
              <legend className="sr-only">Filter activity</legend>
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                  className={`h-8 rounded-full px-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors ${dashFocus} ${
                    tab === t
                      ? "bg-(--dash-fg) text-(--dash-surface)"
                      : "text-(--dash-ash) hover:text-(--dash-fg)"
                  }`}
                >
                  {t}
                </button>
              ))}
            </fieldset>
          ) : null}
          {showExport ? (
            <button
              type="button"
              className={`${dashButtonSecondary} h-9`}
              onClick={() => exportCsv(filtered)}
              disabled={loading || filtered.length === 0}
            >
              <Download aria-hidden="true" />
              Export CSV
            </button>
          ) : null}
          {showSeeAll ? (
            <Link
              href={HISTORY_PATH}
              className={`inline-flex items-center gap-0.5 rounded-(--dash-radius-sm) text-sm text-(--dash-ash) transition-colors hover:text-(--dash-fg) ${dashFocus}`}
            >
              See all
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      </div>

      <section aria-label="Activity history">
        <ul className="flex flex-col divide-y divide-(--dash-line)">
          {loading && (
            <li className="grid gap-2 py-1" aria-label="Loading history">
              {Array.from({ length: skeletonCount }, (_, item) => item).map(
                (item) => (
                  <div
                    key={item}
                    className="h-12 rounded-(--dash-radius-sm) bg-(--dash-tint) motion-safe:animate-pulse"
                  />
                ),
              )}
            </li>
          )}

          {!loading && filtered.length === 0 && (
            <li className="py-10">
              <p className="max-w-sm text-sm leading-6 text-(--dash-ash)">
                {tab === "Cashed out"
                  ? "Nothing cashed out yet."
                  : tab === "Received"
                    ? "No payments received yet."
                    : "No payments yet. Share your pay link to receive your first."}
              </p>
              {tab === "All" && emptyAction ? (
                <div className="mt-4">{emptyAction}</div>
              ) : null}
            </li>
          )}

          {!loading &&
            displayed.map((event) => (
              <li
                key={event.id}
                className="flex min-h-14 items-center gap-3 py-3"
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    event.kind === "received"
                      ? "bg-(--dash-accent)"
                      : "border border-(--dash-fg)/50"
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {{received:"Payment received",sent:"Payment sent",cashedOut:"Cashed out",attempt:"Transfer attempt",unclassified:"Payment details loading"}[event.kind]}
                    {event.counterparty&&<span className="ml-1.5 text-(--dash-ash)">@{event.counterparty}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-(--dash-ash)">
                    {formatWhen(event.at)}
                    {event.status!=="confirmed"&&` · ${event.status==="pending"?"In progress":"Failed"}`}
                  </div>
                  {event.note&&<p className="mt-1 break-words whitespace-pre-wrap text-xs text-(--dash-ash)">{event.note}</p>}
                </div>
                <div className="shrink-0 text-right text-sm font-medium tabular-nums">
                  {event.amount===null?"Locked":`${event.kind==="received"?"+":event.kind==="sent"||event.kind==="cashedOut"?"−":""}${fromBaseUnits(event.amount)}`}
                  {event.amount!==null&&<span className="ml-1 text-(--dash-ash)">USDC</span>}
                </div>
                {event.transferId&&onTransferOpen?<button type="button" className={dashIconButton} onClick={()=>onTransferOpen(event.transferId!)} aria-label="View transfer"><ChevronRight aria-hidden="true"/></button>:event.kind === "received"&&event.leafIndex!==null&&event.scope===activePool().scope ? (
                  <button
                    type="button"
                    className={dashIconButton}
                    onClick={() => setDiscloseLeaf(event.leafIndex)}
                    aria-label="Prove payment"
                    title="Download a proof of this payment (PDF)"
                  >
                    <FileCheck aria-hidden="true" />
                  </button>
                ) : (
                  <span className="size-9 shrink-0" aria-hidden="true" />
                )}
              </li>
            ))}
        </ul>
      </section>

      <DiscloseDialog
        open={discloseLeaf !== null}
        onClose={() => setDiscloseLeaf(null)}
        leafIndex={discloseLeaf}
      />
    </Card>
  );
}
