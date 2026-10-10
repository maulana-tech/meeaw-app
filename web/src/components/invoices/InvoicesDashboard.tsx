"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Plus, QrCode } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { invoiceStatus } from "../../features/invoices/input";
import type { InvoiceView } from "../../features/invoices/types";
import { SIGN_IN_PATH } from "../../lib/auth-routes";
import { formatAssetUnits } from "../../lib/paymentAsset";
import { api } from "../../trpc/client";
import { DashboardPageHeader } from "../dashboard/DashboardPageHeader";
import { PaymentQrDialog } from "../dashboard/PaymentQrDialog";
import {
  dashButtonPrimary,
  dashButtonSecondary,
  dashCell,
  dashFocus,
  dashIconButton,
} from "../dashboard/styles";
import { MeawMascot } from "../MeawMascot";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useWallet } from "../WalletProvider";
import { CreateInvoiceDialog } from "./CreateInvoiceDialog";

export function InvoicesDashboard() {
  const { address, username, sessionReady } = useWallet();
  const [createOpen, setCreateOpen] = useState(false),
    [origin, setOrigin] = useState("");
  const [page, setPage] = useState<{ owner: string; cursor?: string }>({
    owner: "",
  });
  const cursor = page.owner === address ? page.cursor : undefined;
  const query = useQuery({
    queryKey: ["owner-invoices", address, cursor ?? "first"],
    enabled: Boolean(address) && sessionReady,
    queryFn: () => api.invoices.list.query({ cursor }),
    refetchInterval: 15_000,
    retry: false,
  });
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  useEffect(() => {
    if (sessionReady && !address) window.location.replace(SIGN_IN_PATH);
  }, [sessionReady, address]);
  if (!sessionReady || !address)
    return <p role="status">Loading your invoices…</p>;
  return (
    <>
      <DashboardPageHeader
        title="Invoices"
        description="Create a bill, share its link and track verified payments."
        action={
          <button
            type="button"
            className={`${dashButtonPrimary} min-h-11`}
            onClick={() => setCreateOpen(true)}
            disabled={!username}
          >
            <Plus aria-hidden="true" />
            New invoice
          </button>
        }
      />
      {!username && (
        <p className="mb-5 text-sm text-(--dash-ash)">
          Claim your Meaw username before creating an invoice.
        </p>
      )}
      {query.isError && (
        <section role="alert" className="mb-5 text-sm">
          <p>Invoices could not be loaded.</p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className={`${dashButtonSecondary} mt-3`}
          >
            Try again
          </button>
        </section>
      )}
      {query.isLoading ? (
        <p role="status">Loading invoices…</p>
      ) : query.data?.items.length === 0 ? (
        <section
          className={`${dashCell} border border-(--dash-line-solid) p-8`}
        >
          <MeawMascot mood="idle" />
          <h2 className="mt-5 text-xl">Your first invoice starts here</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-(--dash-ash)">
            Set a total in USDC or AUSD. Share the link with your client and see
            when the payment is verified.
          </p>
        </section>
      ) : (
        <section
          aria-label="Your invoices"
          className="divide-y divide-(--dash-line-solid) border border-(--dash-line-solid)"
        >
          {query.data?.items.map((invoice) => (
            <InvoiceRow
              key={`${address}:${invoice.id}`}
              invoice={invoice}
              origin={origin}
              onChanged={() => void query.refetch()}
            />
          ))}
        </section>
      )}
      {(cursor || query.data?.nextCursor) && (
        <div className="mt-5 flex gap-3">
          {cursor && (
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={() => setPage({ owner: address })}
            >
              Latest invoices
            </button>
          )}
          {query.data?.nextCursor && (
            <button
              type="button"
              className={dashButtonSecondary}
              onClick={() =>
                setPage({
                  owner: address,
                  cursor: query.data?.nextCursor ?? undefined,
                })
              }
            >
              Older invoices
            </button>
          )}
        </div>
      )}
      <CreateInvoiceDialog
        key={address}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          setCreateOpen(false);
          setPage({ owner: address });
          void query.refetch();
        }}
      />
    </>
  );
}
function InvoiceRow({
  invoice,
  origin,
  onChanged,
}: {
  invoice: InvoiceView;
  origin: string;
  onChanged: () => void;
}) {
  const [qrOpen, setQrOpen] = useState(false),
    [voidOpen, setVoidOpen] = useState(false),
    [working, setWorking] = useState(false),
    [message, setMessage] = useState("");
  const trigger = useRef<HTMLButtonElement>(null),
    alive = useRef(true),
    busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const url = `${origin}/i/${invoice.token}`,
    status = invoiceStatus(invoice.status, invoice.dueDate);
  const labels = {
    pending: "Pending",
    paid: "Paid",
    void: "Void",
    overdue: "Overdue",
  };
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      if (alive.current) setMessage("Invoice link copied.");
    } catch {
      if (alive.current)
        setMessage("Copy failed. Open the invoice and copy its address.");
    }
  }
  async function cancel() {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setMessage("");
    try {
      await api.invoices.void.mutate({ id: invoice.id });
      if (alive.current) {
        setVoidOpen(false);
        onChanged();
      }
    } catch (e) {
      if (alive.current)
        setMessage(
          e instanceof Error ? e.message : "Invoice could not be voided.",
        );
    } finally {
      busy.current = false;
      if (alive.current) setWorking(false);
    }
  }
  return (
    <article className={`${dashCell} p-5 sm:p-6`}>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <a
            href={`/i/${invoice.token}`}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex items-center gap-2 break-all text-lg font-medium ${dashFocus}`}
          >
            {invoice.number}
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
          </a>
          <p className="mt-1 break-words text-sm text-(--dash-ash)">
            {invoice.clientName} · Due {invoice.dueDate} UTC
          </p>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-lg whitespace-nowrap tabular-nums">
            {formatAssetUnits(BigInt(invoice.amount), invoice.tokenDecimals)}{" "}
            {invoice.asset}
          </p>
          <span className="rounded-full border border-(--dash-line) px-3 py-1 text-xs">
            {labels[status]}
          </span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`${dashButtonSecondary} min-h-11`}
          disabled={!origin}
          onClick={() => void copy()}
        >
          <Copy aria-hidden="true" />
          Copy link
        </button>
        <button
          type="button"
          ref={trigger}
          className={`${dashIconButton} size-11`}
          aria-label={`QR for ${invoice.number}`}
          disabled={!origin}
          onClick={() => setQrOpen(true)}
        >
          <QrCode aria-hidden="true" />
        </button>
        {invoice.status === "pending" && (
          <button
            type="button"
            className={`${dashButtonSecondary} min-h-11`}
            onClick={() => setVoidOpen(true)}
          >
            Void invoice
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="mt-3 text-sm text-(--dash-ash)">
          {message}
        </p>
      )}
      <PaymentQrDialog
        open={qrOpen}
        onOpenChange={setQrOpen}
        url={url}
        asset={invoice.asset}
        triggerRef={trigger}
      />
      <Dialog
        open={voidOpen}
        onOpenChange={(value) => {
          if (!busy.current) setVoidOpen(value);
        }}
      >
        <DialogContent appearance="linen" size="sm" showCloseButton={!working}>
          <DialogHeader>
            <DialogTitle>Void {invoice.number}?</DialogTitle>
            <DialogDescription>
              Closes checkout for this invoice. An already-submitted payment can
              still be confirmed; its evidence is preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={working}
              onClick={() => setVoidOpen(false)}
            >
              Keep invoice
            </Button>
            <Button
              type="button"
              disabled={working || invoice.status !== "pending"}
              onClick={() => void cancel()}
            >
              {working ? "Voiding…" : "Confirm void"}
            </Button>
          </div>
          {message && (
            <p role="alert" className="text-sm">
              {message}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </article>
  );
}
