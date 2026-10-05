import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Flat section background (paper). Kept as a component so sections that
 * layered the old nebula keep their stacking without a gradient. */
export function Nebula({
  variant = "dark",
  className,
}: {
  variant?: "dark" | "light";
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0",
        variant === "dark" ? "bg-void" : "bg-mist",
        className,
      )}
    />
  );
}

const pillBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-[13px] font-semibold uppercase tracking-[0.08em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export const pillOutlineDark = cn(
  pillBase,
  "border border-starlight/70 text-starlight hover:bg-starlight hover:text-void focus-visible:ring-starlight focus-visible:ring-offset-void",
);

export const pillOutlineLight = cn(
  pillBase,
  "border border-graphite/80 text-graphite hover:bg-graphite hover:text-mist focus-visible:ring-graphite focus-visible:ring-offset-mist",
);

export const pillSolidViolet = cn(
  pillBase,
  "bg-indigo-glow text-white hover:opacity-85 focus-visible:ring-violet focus-visible:ring-offset-void",
);

/** Small uppercase tracked label (the "label-data" voice), e.g. "HOW IT WORKS". */
export function MonoLabel({
  children,
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-xs font-medium uppercase tracking-[0.12em]",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Content width + hairline frame shared by every section. */
export function Frame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-14",
        className,
      )}
    >
      {children}
    </div>
  );
}
