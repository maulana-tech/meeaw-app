import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Grainy violet nebula used behind the hero and the closing call to action. */
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
        "grain pointer-events-none absolute inset-0 overflow-hidden",
        variant === "dark"
          ? "bg-void [background-image:radial-gradient(60%_70%_at_28%_78%,rgba(91,43,255,0.95),transparent_62%),radial-gradient(48%_55%_at_80%_8%,rgba(226,76,155,0.85),transparent_60%),radial-gradient(45%_50%_at_8%_30%,rgba(45,59,255,0.75),transparent_65%),radial-gradient(70%_60%_at_95%_95%,rgba(131,110,249,0.35),transparent_70%)]"
          : "bg-mist [background-image:radial-gradient(55%_75%_at_62%_88%,rgba(91,43,255,0.95),transparent_62%),radial-gradient(50%_65%_at_98%_30%,rgba(226,76,155,0.9),transparent_60%),radial-gradient(45%_60%_at_45%_45%,rgba(131,110,249,0.55),transparent_70%)]",
        className,
      )}
    />
  );
}

const pillBase =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

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
  "bg-indigo-glow text-white hover:bg-violet focus-visible:ring-violet focus-visible:ring-offset-void",
);

/** Small uppercase monospace label, e.g. "/// HOW IT WORKS". */
export function MonoLabel({
  children,
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "font-landing-mono text-xs uppercase tracking-[0.22em]",
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
