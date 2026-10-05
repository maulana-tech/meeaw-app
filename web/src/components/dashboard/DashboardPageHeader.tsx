import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DashboardPageHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-[clamp(1.9rem,3vw,2.6rem)] leading-tight font-normal tracking-tight">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-(--dash-ash)">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
