"use client";
import type { QuotaStatus, UnavailableReason } from "./types";
export function sponsorshipMessage(
  reason: UnavailableReason | null,
  resetAt?: string,
) {
  const reset = resetAt
    ? new Date(resetAt).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "the next daily reset";
  switch (reason) {
    case "quota":
      return `Today's gasless quota is used up. It resets ${reset}.`;
    case "budget":
    case "anonymous-budget":
      return `The daily gasless allowance is used up. Try again after ${reset}.`;
    case "balance":
      return "Gasless payments are paused for now. Check again later.";
    case "cost":
      return "Gasless can't cover this action right now. Wait and check again.";
    case "capacity":
      return "Gasless payments are busy. Keep the same action and check again shortly.";
    case "configuration":
      return "Gasless payments are unavailable right now.";
    case "initializing":
      return "Gasless payments are being prepared. Check again shortly.";
    case "rpc":
      return "Gasless availability couldn't be checked. Check again before continuing.";
    default:
      return "Gasless payments are available.";
  }
}
export function SponsorshipNotice({
  status,
  loading,
  public: publicPayer = false,
  pause,
  captured = false,
  onRefresh,
}: {
  status: QuotaStatus | null;
  loading: boolean;
  public?: boolean;
  pause?: UnavailableReason;
  captured?: boolean;
  onRefresh?: () => void;
}) {
  const reason = pause ?? status?.reason ?? null;
  const message = loading
    ? "Checking gasless allowance…"
    : !status
      ? sponsorshipMessage("rpc")
      : captured &&
          !pause &&
          ["quota", "budget", "anonymous-budget"].includes(reason ?? "")
        ? "This payment keeps its gasless reservation. Resume it to check whether it can continue."
        : reason
          ? sponsorshipMessage(reason, status.resetAt)
          : publicPayer
            ? "Gasless payments are available. A daily allowance applies."
            : `${status.remaining ?? "—"} of ${status.limit ?? "—"} gasless actions left today.`;
  return (
    <div
      role="status"
      aria-live="polite"
      className="text-sm leading-6 text-muted-foreground"
    >
      <p>{message}</p>
      {!loading && status?.available && !reason && (
        <p className="mt-1">
          Payment preparation steps are included in one action.
        </p>
      )}
      {pause && (
        <p className="mt-1">
          Your progress is saved. Resume the same payment when gasless returns.
        </p>
      )}
      {!loading && (!status || reason) && onRefresh && (
        <button
          type="button"
          className="mt-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
          onClick={onRefresh}
        >
          Check again
        </button>
      )}
    </div>
  );
}
