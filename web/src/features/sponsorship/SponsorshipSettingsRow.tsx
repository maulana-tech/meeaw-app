"use client";
import { dashCell } from "../../components/dashboard/styles";
import { Button } from "../../components/ui/button";
import { SponsorshipNotice } from "./SponsorshipNotice";
import { useSponsorship } from "./useSponsorship";
export function SponsorshipSettingsRow() {
  const quota = useSponsorship(),
    known = quota.status?.configured && !quota.loading;
  return (
    <section className={`${dashCell} p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="dashboard-tile-title">Gasless allowance</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={quota.loading}
          onClick={() => {
            void quota.refresh();
          }}
        >
          Check allowance
        </Button>
      </div>
      <div className="mt-3 max-w-xl">
        <SponsorshipNotice status={quota.status} loading={quota.loading} />
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-4 text-sm text-(--dash-ash)">
        {(
          [
            ["Remaining", quota.status?.remaining],
            ["Used", quota.status?.used],
            ["Pending", quota.status?.reserved],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt>{label}</dt>
            <dd className="mt-1 break-words text-2xl font-medium text-(--dash-fg) tabular-nums">
              {known ? (value ?? "—") : "—"}
            </dd>
          </div>
        ))}
      </dl>
      {quota.status?.configured && (
        <p className="mt-4 text-xs leading-5 text-(--dash-ash)">
          Daily reset:{" "}
          <time dateTime={quota.status.resetAt}>
            {new Date(quota.status.resetAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>{" "}
          (your local time).
        </p>
      )}
    </section>
  );
}
