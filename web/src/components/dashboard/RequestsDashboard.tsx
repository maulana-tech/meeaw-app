"use client";
import {
  ArrowLeft,
  ArrowRight,
  Loader,
  LockKeyhole,
  Plus,
  RefreshCw,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useRequestPayment } from "../../features/requests/hooks/useRequestPayment";
import type { RequestRow } from "../../features/requests/hooks/useRequests";
import { useRequests } from "../../features/requests/hooks/useRequests";
import type { PaymentRequest } from "../../features/requests/types";
import { requestPool } from "../../lib/pools";
import { api } from "../../trpc/client";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
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
import { dashButtonPrimary, dashButtonSecondary, dashFocus } from "./styles";

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
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("mawee:request-changed"));
      }
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
  const selectDirection = (next: "received" | "sent") => {
    setSelected(null);
    setDirection(next);
  };
  return (
    <>
      <DashboardPageHeader
        title="Requests"
        description="Ask someone to pay you, and pay what you have been asked for. Amounts and notes stay encrypted."
        action={
          <button
            type="button"
            onClick={onCreate}
            disabled={!address}
            className={dashButtonPrimary}
          >
            <Plus aria-hidden="true" />
            New request
          </button>
        }
      />
      <Card appearance="linen" className="gap-4 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="dashboard-tile-title">
            {direction === "received"
              ? "People asking you to pay"
              : "Requests you have sent"}
          </h2>
          <div
            role="tablist"
            aria-label="Request direction"
            className="flex w-fit items-center rounded-full border border-(--dash-line) p-0.5"
          >
            <DirectionTab
              id="requests-received-tab"
              selected={direction === "received"}
              onSelect={() => selectDirection("received")}
            >
              Received
              {list.count > 0 ? (
                <span className="ml-1.5 tabular-nums">{list.count}</span>
              ) : null}
            </DirectionTab>
            <DirectionTab
              id="requests-sent-tab"
              selected={direction === "sent"}
              onSelect={() => selectDirection("sent")}
            >
              Sent
            </DirectionTab>
          </div>
        </div>
        <section
          id="requests-list"
          role="tabpanel"
          aria-labelledby={`requests-${direction}-tab`}
        >
          {list.isLoading ? (
            <div
              className="grid gap-2 py-1"
              role="status"
              aria-busy="true"
              aria-label="Loading requests"
            >
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-16 bg-(--dash-tint) motion-safe:animate-pulse"
                />
              ))}
            </div>
          ) : list.error ? (
            <ListMessage
              action={
                <button
                  type="button"
                  className={dashButtonSecondary}
                  onClick={list.refresh}
                >
                  <RefreshCw aria-hidden="true" />
                  Try again
                </button>
              }
            >
              Your requests could not be loaded. Check your connection and try
              again.
            </ListMessage>
          ) : list.rows.length === 0 &&
            !accountUnlocked &&
            direction === "received" &&
            list.count > 0 ? (
            <ListMessage
              action={
                <button
                  type="button"
                  className={dashButtonPrimary}
                  onClick={promptUnlock}
                >
                  <LockKeyhole aria-hidden="true" />
                  Unlock Mawee
                </button>
              }
            >
              {list.count} incoming request{list.count === 1 ? " is" : "s are"}{" "}
              encrypted to your account. Unlock to see who is asking and how
              much.
            </ListMessage>
          ) : list.rows.length === 0 ? (
            <ListMessage
              action={
                direction === "sent" ? (
                  <button
                    type="button"
                    className={dashButtonSecondary}
                    onClick={onCreate}
                    disabled={!address}
                  >
                    <Plus aria-hidden="true" />
                    New request
                  </button>
                ) : null
              }
            >
              {direction === "received"
                ? "Nobody has asked you to pay yet. Requests sent to your username show up here."
                : "You have not sent any requests yet. Ask someone to pay you by their username."}
            </ListMessage>
          ) : (
            <ul className="flex flex-col divide-y divide-(--dash-line)">
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
            </ul>
          )}
        </section>
        {list.hasNext || list.hasPrevious ? (
          <div className="flex justify-end gap-2 border-t border-(--dash-line) pt-4">
            {list.hasPrevious ? (
              <button
                type="button"
                className={`${dashButtonSecondary} h-9`}
                onClick={list.previousPage}
              >
                <ArrowLeft aria-hidden="true" />
                Previous
              </button>
            ) : null}
            {list.hasNext ? (
              <button
                type="button"
                className={`${dashButtonSecondary} h-9`}
                onClick={list.loadMore}
              >
                Next
                <ArrowRight aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
      </Card>
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
  const action =
    pending && direction === "received" ? (
      record.operationId ? (
        <button
          type="button"
          className={`${dashButtonSecondary} h-9`}
          onClick={accountUnlocked ? onReview : onUnlock}
          aria-label={`View payment to @${other.username}`}
        >
          View payment
        </button>
      ) : accountUnlocked && row.amount !== null && !row.unreadable ? (
        <button
          type="button"
          className={`${dashButtonPrimary} h-9`}
          onClick={onReview}
          aria-label={`Review request from @${other.username}`}
        >
          Review
        </button>
      ) : (
        <button
          type="button"
          className={`${dashButtonSecondary} h-9`}
          onClick={onUnlock}
        >
          Unlock to review
        </button>
      )
    ) : pending && direction === "sent" && !record.operationId ? (
      <button
        type="button"
        className={`${dashButtonSecondary} h-9`}
        onClick={onTransition}
        aria-label={`Cancel request to @${other.username}`}
      >
        Cancel
      </button>
    ) : null;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 py-4">
      <div className="flex min-w-[12rem] flex-1 items-start gap-3">
        <span
          className={`mt-2 size-1.5 shrink-0 rounded-full ${
            pending ? "bg-(--dash-accent)" : "border border-(--dash-fg)/50"
          }`}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {row.note !== null ? (
            <p className="mt-0.5 break-words text-xs text-(--dash-ash)">
              {row.note || "Payment request"}
            </p>
          ) : (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-(--dash-ash)">
              <LockKeyhole className="size-3" aria-hidden="true" />
              {accountUnlocked
                ? "This request cannot be opened on this device."
                : "Unlock to view request details."}
            </p>
          )}
        </div>
      </div>
      <div className="ml-[1.125rem] flex items-center gap-4 sm:ml-0">
        <div className="min-w-28 text-left sm:text-right">
          {row.amount !== null ? (
            <p className="text-sm font-medium tabular-nums">
              {formatAmount(row.amount)}
              <span className="ml-1 text-(--dash-ash)">USDC</span>
            </p>
          ) : (
            <p className="text-sm text-(--dash-ash)">Unlock to view amount</p>
          )}
          <RequestPaymentStatus
            status={record.status}
            operation={record.operationId === operation?.id ? operation : null}
            inFlight={Boolean(record.operationId)}
          />
        </div>
        {action}
      </div>
    </li>
  );
}
function DirectionTab({
  id,
  selected,
  onSelect,
  children,
}: {
  id: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls="requests-list"
      onClick={onSelect}
      className={`h-8 rounded-full px-3.5 text-[11px] font-semibold tracking-[0.08em] uppercase transition-colors ${dashFocus} ${
        selected
          ? "bg-(--dash-fg) text-(--dash-surface)"
          : "text-(--dash-ash) hover:text-(--dash-fg)"
      }`}
    >
      {children}
    </button>
  );
}
function ListMessage({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="py-10">
      <p className="max-w-sm text-sm leading-6 text-(--dash-ash)">{children}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
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
