"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// Goes back to the previous Meaw page when there is one; a visitor who landed
// here from outside (a shared link, an email) goes to `fallback` instead.
export function BackLink({
  fallback = "/",
  label = "Back",
  className,
}: {
  fallback?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={fallback}
      onClick={(e) => {
        let internal = false;
        try {
          internal =
            new URL(document.referrer).origin === window.location.origin;
        } catch {}
        if (internal && window.history.length > 1) {
          e.preventDefault();
          window.history.back();
        }
      }}
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-full border border-(--dash-line-strong) pr-3.5 pl-2.5 text-[11px] font-semibold tracking-[0.08em] text-(--dash-fg) uppercase transition-colors hover:border-(--dash-fg) hover:bg-(--dash-fg) hover:text-(--dash-surface) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--dash-fg)",
        className,
      )}
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
