import type { ReactNode } from "react";

/** Locked / empty / setup state for a dashboard page, in the ledger style. */
export function DashboardNotice({
  label,
  title,
  children,
  action,
  art,
}: {
  label: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  art?: ReactNode;
}) {
  return (
    <section className="rounded-(--dash-radius) border border-(--dash-line-solid) bg-(--dash-surface) p-6 sm:p-8">
      {art ? <div className="mb-5">{art}</div> : null}
      <p className="dashboard-tile-title flex items-center gap-2">
        <span
          className="size-1.5 rounded-full bg-(--dash-accent)"
          aria-hidden="true"
        />
        {label}
      </p>
      <h2 className="mt-5 text-2xl font-normal tracking-tight">{title}</h2>
      <div className="mt-2 max-w-md text-sm leading-6 text-(--dash-ash)">
        {children}
      </div>
      {action ? <div className="mt-6">{action}</div> : null}
    </section>
  );
}
