// One control vocabulary for the dashboard. Colours come from the --dash-*
// tokens in globals.css, so every class works in light and dark mode.
// Shape is binary: controls are pills, panels and cells are sharp.

export const dashFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--dash-fg) focus-visible:ring-offset-2 focus-visible:ring-offset-(--dash-bg)";

const dashButtonBase = `inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-[13px] font-semibold tracking-[0.08em] whitespace-nowrap uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40 [&_svg]:size-4 ${dashFocus}`;

/** Solid ink pill under paper text. */
export const dashButtonPrimary = `${dashButtonBase} bg-(--dash-fg) text-(--dash-surface) hover:opacity-85`;

/** Hairline pill that fills with ink on hover. */
export const dashButtonSecondary = `${dashButtonBase} border border-(--dash-line-strong) text-(--dash-fg) hover:border-(--dash-fg) hover:bg-(--dash-fg) hover:text-(--dash-surface)`;

export const dashIconButton = `flex size-9 shrink-0 items-center justify-center rounded-full text-(--dash-fg)/60 transition-colors hover:bg-(--dash-tint) hover:text-(--dash-fg) disabled:cursor-not-allowed disabled:opacity-40 [&_svg]:size-4 ${dashFocus}`;

/** Hairline frame whose children become sharp cells divided by 1px lines. */
export const dashLedger =
  "dash-ledger grid gap-px overflow-hidden border border-(--dash-line-solid) bg-(--dash-line-solid)";

export const dashCell = "min-w-0 bg-(--dash-surface)";
