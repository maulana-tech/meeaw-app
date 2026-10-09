"use client";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Loader,
  LockKeyhole,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { RequestRow } from "../../features/requests/hooks/useRequests";
import type { PaymentOperation } from "../../features/requests/types";
import { SponsorshipNotice } from "../../features/sponsorship/SponsorshipNotice";
import { useSponsorship } from "../../features/sponsorship/useSponsorship";
import { ASSETS } from "../../lib/assets";
import { fromBaseUnits } from "../../lib/crypto";
import { findPool } from "../../lib/pools";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";
import { useMyNotes } from "./useMyNotes";
export function PayRequestDialog({
  request,
  open,
  onOpenChange,
  operation,
  working,
  error,
  onPay,
  onCheck = async () => null,
  checking = false,
  statusError = null,
}: {
  request: RequestRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  operation: PaymentOperation | null;
  working: boolean;
  error: string | null;
  onPay: () => Promise<unknown>;
  onCheck?: () => Promise<unknown>;
  checking?: boolean;
  statusError?: string | null;
}) {
  const { address, accountUnlocked, promptUnlock } = useWallet();
  const sponsorship = useSponsorship({ enabled: open });
  const record = request?.record ?? null,
    amount = request?.amount ?? null;
  const pool = record ? findPool(record.pool) : null;
  const asset = pool ? ASSETS[pool.asset ?? "USDC"].label : "Unknown asset";
  const notes = useMyNotes(
    address && accountUnlocked && pool?.role === "active" ? address : undefined,
    pool ?? undefined,
  );
  const balance = notes.claimable;
  const balanceReady =
    accountUnlocked &&
    Boolean(pool?.requestCapable) &&
    !notes.loading &&
    !notes.refreshing &&
    !notes.stale &&
    !notes.error &&
    notes.indexedAt !== null;
  const status = request?.record.status;
  const confirmed = status === "paid" || operation?.phase === "confirmed";
  const waiting =
    !confirmed &&
    !operation?.sponsorshipPause &&
    (operation?.phase === "submitting" ||
      operation?.phase === "submitted" ||
      operation?.phase === "needsReconciliation" ||
      Boolean(record?.operationId && !operation));
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!record?.id || !waiting) return;
    const timer = setTimeout(() => setSlow(true), 30000);
    return () => clearTimeout(timer);
  }, [record?.id, waiting]);
  const progress = operation
    ? operation.sponsorshipPause
      ? {
          title: "Gasless payment paused",
          detail:
            "Your progress is saved. Resume this payment when gasless returns.",
        }
      : operation.phase === "preparing"
        ? {
            title: "Preparing payment",
            detail: `${operation.completedMerges} balance merge${operation.completedMerges === 1 ? "" : "s"} complete. Keep this window open.`,
          }
        : operation.phase === "confirmed"
          ? { title: "Payment confirmed", detail: "Settled on Monad." }
          : operation.phase === "failed"
            ? {
                title: "This attempt failed",
                detail: "Your funds remain available. You can try again.",
              }
            : operation.txHash
              ? {
                  title: "Payment sent",
                  detail: "Waiting for confirmation on Monad.",
                }
              : {
                  title: "Submitting payment",
                  detail: "Checking the submission.",
                }
    : record?.operationId
      ? {
          title: "Checking your earlier payment",
          detail:
            "Checking the existing private payment before allowing another attempt.",
        }
      : null;
  const followUp = waiting
    ? slow
      ? "This is taking longer than usual. We are still checking, so do not pay again."
      : "You can close this window. The request updates automatically."
    : null;
  const showBalance = !waiting && !confirmed;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent appearance="linen" size="sm">
        <DialogHeader>
          <DialogTitle>
            {confirmed
              ? "Payment confirmed"
              : waiting
                ? "Payment in progress"
                : "Pay this request"}
          </DialogTitle>
          <DialogDescription>
            {confirmed
              ? "This request has been paid."
              : waiting
                ? "Your payment is on its way. No further action is needed."
                : "Review the payment before you confirm."}
          </DialogDescription>
        </DialogHeader>
        {request && record && amount !== null ? (
          <div className="grid gap-4">
            {!confirmed && !waiting && (
              <SponsorshipNotice
                status={sponsorship.status}
                loading={sponsorship.loading}
                pause={operation?.sponsorshipPause}
                captured={Boolean(operation?.sponsorshipAction)}
                onRefresh={() => {
                  void sponsorship.refresh();
                }}
              />
            )}
            <div className="py-2 text-center">
              <p className="text-sm text-muted-foreground">
                Requested by @{record.requester.username}
              </p>
              <p className="mt-3 font-heading text-4xl font-medium tabular-nums">
                {fromBaseUnits(amount)}{" "}
                <span className="text-base">{asset}</span>
              </p>
              <p className="mx-auto mt-2 max-w-sm break-words text-sm text-muted-foreground">
                {request.note || "Payment request"}
              </p>
            </div>
            <div className="grid gap-2 border-t border-border pt-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Pay from</span>
                <span className="font-medium">Private Meaw balance</span>
              </div>
              {showBalance ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">
                    Available in this pool
                  </span>
                  <span className="tabular-nums">
                    {balanceReady
                      ? `${fromBaseUnits(balance)} ${asset}`
                      : notes.loading || notes.refreshing
                        ? "Checking private balance…"
                        : pool?.role === "legacy"
                          ? "Previous pool balance"
                          : "Balance unavailable"}
                  </span>
                </div>
              ) : null}
            </div>
            {showBalance && balanceReady && balance < amount ? (
              <p className="text-sm text-muted-foreground">
                Add or receive at least {fromBaseUnits(amount - balance)}{" "}
                {asset}
                in this pool before paying.
              </p>
            ) : null}
            {progress ? (
              <div
                className="flex items-start gap-3 rounded-xl bg-foreground/5 p-3.5 text-sm"
                role="status"
                aria-live="polite"
              >
                <span className="mt-0.5 shrink-0" aria-hidden="true">
                  {operation?.phase === "confirmed" ? (
                    <CheckCircle2 className="size-4" />
                  ) : operation?.phase === "failed" ? (
                    <CircleAlert className="size-4 text-destructive" />
                  ) : (
                    <Loader className="size-4 animate-spin" />
                  )}
                </span>
                <div className="grid gap-1">
                  <p className="font-medium">{progress.title}</p>
                  <p className="text-muted-foreground">{progress.detail}</p>
                  {followUp ? (
                    <p className="text-muted-foreground">{followUp}</p>
                  ) : null}
                  {waiting && statusError ? (
                    <p className="text-muted-foreground">{statusError}</p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {waiting ? (
              <div
                className={
                  slow || statusError ? "grid grid-cols-2 gap-2" : "grid"
                }
              >
                {slow || statusError ? (
                  <Button
                    variant="secondary"
                    className="min-h-11"
                    disabled={checking}
                    onClick={() => void onCheck().catch(() => {})}
                  >
                    {checking ? (
                      <Loader
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : null}
                    {checking ? "Checking…" : "Check status"}
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              </div>
            ) : null}
            {error ? (
              <ToastFeedback
                message={error}
                variant="error"
                toastId="request-pay-error"
              />
            ) : null}
            {!accountUnlocked ? (
              <Button className="min-h-11" onClick={promptUnlock}>
                Unlock before paying
              </Button>
            ) : null}
            {accountUnlocked &&
            record.status === "pending" &&
            (!record.operationId ||
              operation?.phase === "preparing" ||
              operation?.sponsorshipPause) &&
            (operation?.sponsorshipPause ||
              (operation?.phase !== "submitted" &&
                operation?.phase !== "needsReconciliation" &&
                operation?.phase !== "submitting")) &&
            operation?.phase !== "confirmed" ? (
              <Button
                className="min-h-11"
                disabled={
                  working ||
                  (!record.operationId &&
                    (sponsorship.loading || !sponsorship.status?.available)) ||
                  !balanceReady ||
                  balance < amount ||
                  notes.error !== null
                }
                onClick={() => void onPay().catch(() => {})}
              >
                {working || notes.refreshing ? (
                  <Loader className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {operation?.sponsorshipPause
                  ? "Resume payment"
                  : operation?.completedMerges
                    ? "Continue payment"
                    : `Pay ${fromBaseUnits(amount)} ${asset}`}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
            {record.status === "pending" && !accountUnlocked ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <LockKeyhole className="size-3.5" />
                The balance and note are encrypted to your unlocked account.
              </p>
            ) : null}
          </div>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">
            This request could not be opened on this device.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
