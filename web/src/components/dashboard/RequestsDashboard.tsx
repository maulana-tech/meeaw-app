"use client";
import {
  ArrowLeft,
  ArrowRight,
  Inbox,
  Loader,
  LockKeyhole,
  Plus,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useRequestPayment } from "../../features/requests/hooks/useRequestPayment";
import type { RequestRow } from "../../features/requests/hooks/useRequests";
import { useRequests } from "../../features/requests/hooks/useRequests";
import type { PaymentRequest } from "../../features/requests/types";
import { REQUESTS_PATH } from "../../lib/auth-routes";
import { requestPool } from "../../lib/pools";
import { cn } from "../../lib/utils";
import { api } from "../../trpc/client";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useWallet } from "../WalletProvider";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { PayRequestDialog } from "./PayRequestDialog";
import { RequestPaymentStatus } from "./RequestPaymentStatus";

export function RequestsDashboard({
  onCreate = () => {},
}: {
  onCreate?: () => void;
}) {
  const [direction, setDirection] = useState<"received" | "sent">("received");
  const [selected, setSelected] = useState<PaymentRequest | null>(null);
  const [transition, setTransition] = useState<RequestRow | null>(null);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const { address, accountUnlocked, promptUnlock } = useWallet();
  const list = useRequests(direction),
    payment = useRequestPayment(selected);
  async function finishTransition() {
    if (!transition) return;
    setTransitionBusy(true);
    setTransitionError(null);
    try {
      const action =
        transition.record.status === "pending" && direction === "received"
          ? "decline"
          : "cancel";
      const input = {
        id: transition.record.id,
        revision: transition.record.revision,
      };
      if (action === "decline") await api.requests.decline.mutate(input);
      else await api.requests.cancel.mutate(input);
      list.refresh();
      setTransition(null);
    } catch (e) {
      setTransitionError(
        e instanceof Error
          ? e.message
          : "The request could not be updated. Refresh and try again.",
      );
    } finally {
      setTransitionBusy(false);
    }
  }
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/dashboard"
          aria-label="Back to dashboard"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-brand-linen/75 transition-colors hover:bg-brand-linen/10 hover:text-brand-linen focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-linen"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Link>
        <DashboardPageHeader
          title="Requests"
          description="A simple way to ask, pay, and keep track."
        />
      </div>
      <div className="dashboard-bento mx-auto max-w-6xl pb-16">
        <div
          role="tablist"
          aria-label="Request direction"
          className="flex gap-1 border-b border-brand-linen/20"
        >
          <button
            id="requests-received-tab"
            type="button"
            role="tab"
            aria-selected={direction === "received"}
            aria-controls="requests-list"
            onClick={() => {
              setSelected(null);
              setDirection("received");
            }}
            className={cn(
              "min-h-11 border-b-2 px-4 text-sm",
              direction === "received"
                ? "border-brand-linen text-brand-linen"
                : "border-transparent text-brand-linen/65 hover:text-brand-linen",
            )}
          >
            Received <span className="ml-1 tabular-nums">{list.count}</span>
          </button>
          <button
            id="requests-sent-tab"
            type="button"
            role="tab"
            aria-selected={direction === "sent"}
            aria-controls="requests-list"
            onClick={() => {
              setSelected(null);
              setDirection("sent");
            }}
            className={cn(
              "min-h-11 border-b-2 px-4 text-sm",
              direction === "sent"
                ? "border-brand-linen text-brand-linen"
                : "border-transparent text-brand-linen/65 hover:text-brand-linen",
            )}
          >
            Sent
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 py-5">
          <p className="text-sm text-brand-linen/65">
            {direction === "received"
              ? "People asking you to pay"
              : "Requests you have sent"}
          </p>
          <Button onClick={onCreate} variant="glass" disabled={!address}>
            <Plus className="size-4" aria-hidden="true" />
            New request
          </Button>
        </div>
        <div
          id="requests-list"
          role="tabpanel"
          aria-labelledby={`requests-${direction}-tab`}
        >
          {list.isLoading ? (
            <div
              className="flex min-h-24 items-center gap-3 text-sm text-brand-linen/70"
              role="status"
            >
              <Loader className="size-4 animate-spin" aria-hidden="true" />
              Loading your requests…
            </div>
          ) : list.error ? (
            <div className="flex items-center justify-between gap-4 py-7">
              <p className="text-sm">Your requests could not be loaded.</p>
              <Button variant="glass" onClick={list.refresh}>
                <RefreshCw className="size-4" />
                Try again
              </Button>
            </div>
          ) : list.rows.length === 0 &&
            !accountUnlocked &&
            direction === "received" &&
            list.count > 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-10 text-center">
              <LockKeyhole
                className="size-6 text-brand-linen/70"
                aria-hidden="true"
              />
              <p className="text-sm text-brand-linen/75">
                {list.count} incoming request{list.count === 1 ? "" : "s"}.
                Unlock to view them privately.
              </p>
              <Button variant="glass" onClick={promptUnlock}>
                Unlock Mawee
              </Button>
            </div>
          ) : list.rows.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-3 py-10 text-center">
              <Inbox
                className="size-6 text-brand-linen/70"
                aria-hidden="true"
              />
              <p className="text-sm text-brand-linen/75">
                {direction === "received"
                  ? "No payment requests yet."
                  : "You haven't sent any requests yet."}
              </p>
              <Button variant="glass" onClick={onCreate}>
                <Plus className="size-4" />
                New request
              </Button>
            </div>
          ) : (
            <div className="grid gap-3">
              {list.rows.map((row) => (
                <RequestRowView
                  key={row.record.id}
                  row={row}
                  direction={direction}
                  accountUnlocked={accountUnlocked}
                  operation={payment.operation}
                  onReview={() => setSelected(row.record)}
                  onUnlock={promptUnlock}
                  onTransition={() => setTransition(row)}
                />
              ))}
            </div>
          )}
        </div>
        {list.hasNext || list.hasPrevious ? (
          <div className="flex justify-end gap-2 pt-5">
            {list.hasPrevious && (
              <Button variant="glass" onClick={list.previousPage}>
                <ArrowLeft className="size-4" />
                Previous
              </Button>
            )}
            {list.hasNext && (
              <Button variant="glass" onClick={list.loadMore}>
                More requests
                <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        ) : null}
      </div>
      <PayRequestDialog
        request={
          list.rows.find((row) => row.record.id === selected?.id) ?? null
        }
        open={selected !== null}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
        operation={payment.operation}
        working={payment.working}
        error={payment.error}
        onPay={payment.pay}
        onCheck={payment.refresh}
        checking={payment.checking}
        statusError={payment.statusError}
      />
      <Dialog
        open={transition !== null}
        onOpenChange={(v) => !v && !transitionBusy && setTransition(null)}
      >
        <DialogContent appearance="linen" size="sm">
          <DialogHeader>
            <DialogTitle>
              {transition?.record.status === "pending" &&
              direction === "received"
                ? "Decline this request?"
                : "Cancel this request?"}
            </DialogTitle>
            <DialogDescription>
              {transition
                ? direction === "received"
                  ? `Decline @${transition.record.requester.username}'s payment request?`
                  : `Cancel the request to @${transition.record.addressee.username}?`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {transitionError ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {transitionError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={transitionBusy}
              onClick={() => setTransition(null)}
            >
              Keep request
            </Button>
            <Button
              variant="destructive"
              disabled={transitionBusy}
              onClick={() => void finishTransition()}
            >
              {transitionBusy ? (
                <Loader className="size-4 animate-spin" />
              ) : null}
              {direction === "received" ? "Decline request" : "Cancel request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
function RequestRowView({
  row,
  direction,
  accountUnlocked,
  operation,
  onReview,
  onUnlock,
  onTransition,
}: {
  row: RequestRow;
  direction: "received" | "sent";
  accountUnlocked: boolean;
  operation: ReturnType<typeof useRequestPayment>["operation"];
  onReview: () => void;
  onUnlock: () => void;
  onTransition: () => void;
}) {
  const { record } = row;
  const other = direction === "received" ? record.requester : record.addressee;
  const label =
    direction === "received"
      ? `From @${other.username}`
      : `To @${other.username}`;
  const pending = record.status === "pending";
  return (
    <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border theme-linen border-border bg-card text-card-foreground px-4 py-4 shadow-sm transition-colors hover:border-foreground/25 sm:px-5 sm:py-5">
      <div className="min-w-[12rem] flex-1">
        <p className="font-medium text-card-foreground">{label}</p>
        {row.note !== null ? (
          <p className="mt-1 break-words text-sm text-muted-foreground">
            {row.note || "Payment request"}
          </p>
        ) : (
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            {accountUnlocked
              ? "This request cannot be opened on this device."
              : "Unlock to view request details."}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-32 text-left sm:text-right">
          {row.amount !== null ? (
            <p className="font-medium tabular-nums">
              {formatAmount(row.amount)} USDC
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Unlock to view amount
            </p>
          )}
          <RequestPaymentStatus
            status={record.status}
            operation={record.operationId === operation?.id ? operation : null}
          />
        </div>
        {pending &&
          direction === "received" &&
          (record.operationId ? (
            <>
              <span className="text-sm text-muted-foreground">
                Payment is being checked
              </span>
              <Button
                variant="secondary"
                className="rounded-full"
                onClick={accountUnlocked ? onReview : onUnlock}
              >
                Check status
              </Button>
            </>
          ) : accountUnlocked && row.amount !== null && !row.unreadable ? (
            <Button
              variant="secondary"
              className="rounded-full"
              onClick={onReview}
              aria-label={`Review request from @${other.username}`}
            >
              Review
            </Button>
          ) : (
            <Button
              variant="secondary"
              className="rounded-full"
              onClick={onUnlock}
            >
              Unlock before reviewing
            </Button>
          ))}
        {pending && direction === "sent" && !record.operationId ? (
          <Button
            variant="secondary"
            className="rounded-full"
            onClick={onTransition}
            aria-label={`Cancel request to @${other.username}`}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </article>
  );
}
function formatAmount(amount: bigint) {
  const d = activeDecimals();
  const scale = 10n ** BigInt(d),
    whole = amount / scale,
    frac = (amount % scale).toString().padStart(d, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
function activeDecimals() {
  try {
    return requestPool()?.tokenDecimals ?? 6;
  } catch {
    return 6;
  }
}
