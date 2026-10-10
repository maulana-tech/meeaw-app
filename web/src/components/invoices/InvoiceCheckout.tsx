"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type Hex, hexToBytes } from "viem";
import { PayForm } from "../../app/pay/[username]/PayForm";
import { invoiceStatus } from "../../features/invoices/input";
import type { InvoiceView } from "../../features/invoices/types";
import type { PaymentLink } from "../../features/paymentLinks/types";
import { chain, explorerTxUrl } from "../../lib/chain";
import { formatAssetUnits } from "../../lib/paymentAsset";
import { api } from "../../trpc/client";
import { DashboardBackground } from "../dashboard/DashboardBackground";
import {
  dashButtonPrimary,
  dashButtonSecondary,
  dashCell,
} from "../dashboard/styles";
import { MeawMascot } from "../MeawMascot";

export const invoiceDate = (value: string) =>
  new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  });
const labels = {
  pending: "Pending",
  paid: "Paid",
  void: "Void",
  overdue: "Overdue",
} as const;
const receiptKey = (token: string) => `meaw:invoice-receipt:${token}`;
const attemptKey = (token: string) => `meaw:invoice-attempt:${token}`;
export function InvoiceCheckout({ token }: { token: string }) {
  const query = useQuery({
    queryKey: ["invoice-public", token],
    queryFn: () => api.invoices.publicGet.query({ token }),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "paid" ? false : 5000,
  });
  const [confirmed, setConfirmed] = useState<{
    token: string;
    invoice: InvoiceView;
  } | null>(null);
  const [receipt, setReceipt] = useState<{ token: string; hash: Hex } | null>(
    null,
  );
  const [checking, setChecking] = useState(false),
    [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState<{
    token: string;
    active: boolean;
  } | null>(null);
  const session = useRef(token),
    mounted = useRef(true);
  session.current = token;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      const hash = sessionStorage.getItem(receiptKey(token));
      if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash))
        setReceipt({ token, hash: hash as Hex });
      if (sessionStorage.getItem(attemptKey(token)) === "1")
        setUncertain({ token, active: true });
    } catch {}
  }, [token]);
  const invoice = confirmed?.token === token ? confirmed.invoice : query.data;
  const hash = receipt?.token === token ? receipt.hash : null;
  const unresolved = uncertain?.token === token && uncertain.active;
  async function confirm(txHash?: Hex) {
    const at = token;
    setChecking(true);
    setNotice("");
    try {
      const paid = txHash
        ? await api.invoices.checkPayment.mutate({ token: at, txHash })
        : await api.invoices.checkPayment.mutate({ token: at });
      if (mounted.current && session.current === at) {
        if (paid.status === "paid") setConfirmed({ token: at, invoice: paid });
        else if (
          paid.paymentOutcome === "reverted" &&
          txHash &&
          paid.verifiedRevertHash?.toLowerCase() === txHash.toLowerCase()
        ) {
          invoiceLifecycle.onReleased();
          setNotice(
            "The payment reverted. You can review the invoice and pay again.",
          );
        } else
          setNotice(
            "No confirmed payment was found yet. Keep checking this invoice before making another payment.",
          );
      }
    } catch {
      if (mounted.current && session.current === at)
        setNotice(
          "Payment submitted. Confirmation is pending; check its status before paying again.",
        );
    } finally {
      if (mounted.current && session.current === at) setChecking(false);
    }
  }
  async function onPaid(value: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value))
      throw new Error("Receipt hash unavailable. Check the invoice status.");
    const txHash = value as Hex;
    try {
      sessionStorage.setItem(receiptKey(token), txHash);
    } catch {}
    if (!mounted.current || session.current !== token) return;
    setReceipt({ token, hash: txHash });
    try {
      const paid = await api.invoices.confirmPayment.mutate({ token, txHash });
      if (mounted.current && session.current === token)
        setConfirmed({ token, invoice: paid });
    } catch {
      if (mounted.current && session.current === token)
        setNotice(
          "Payment submitted. Confirmation is pending; check its status before paying again.",
        );
    }
  }
  const invoiceLifecycle = {
    onSubmitting: () => {
      try {
        sessionStorage.setItem(attemptKey(token), "1");
        if (sessionStorage.getItem(attemptKey(token)) !== "1")
          throw new Error("Unavailable");
      } catch {
        throw new Error(
          "This browser cannot keep payment status. Use another browser before paying.",
        );
      }
    },
    onSubmitted: (value: string) => {
      if (!/^0x[0-9a-fA-F]{64}$/.test(value)) return;
      try {
        sessionStorage.setItem(receiptKey(token), value);
      } catch {}
      if (mounted.current && session.current === token)
        setReceipt({ token, hash: value as Hex });
    },
    onUncertain: () => {
      if (mounted.current && session.current === token) {
        setUncertain({ token, active: true });
        setNotice(
          "Payment status is uncertain. Check this invoice before paying again.",
        );
      }
    },
    onReleased: () => {
      try {
        sessionStorage.removeItem(attemptKey(token));
        sessionStorage.removeItem(receiptKey(token));
      } catch {}
      if (mounted.current && session.current === token) {
        setUncertain({ token, active: false });
        setReceipt(null);
      }
    },
  };
  const amount = (units: string) =>
    invoice
      ? `${formatAssetUnits(BigInt(units), invoice.tokenDecimals)} ${invoice.asset}`
      : "";
  const state = invoice ? invoiceStatus(invoice.status, invoice.dueDate) : null;
  let checkout = null;
  if (
    invoice?.checkout &&
    invoice.status === "pending" &&
    !hash &&
    !unresolved &&
    !query.isError
  ) {
    const link: PaymentLink = {
      id: invoice.id,
      owner: invoice.username,
      slug: invoice.token,
      asset: invoice.asset,
      tokenDecimals: invoice.tokenDecimals,
      amount: invoice.amount,
      description: null,
      label: null,
      status: "pending",
      state: "active",
      createdAt: invoice.createdAt,
      updatedAt: null,
      archivedAt: null,
    };
    const account = {
      owner: invoice.checkout.recipientWallet,
      note_pubkey: hexToBytes(invoice.checkout.notePubkey),
      view_pubkey: hexToBytes(invoice.checkout.viewPubkey),
      created: 0n,
    };
    checkout = (
      <PayForm
        account={account}
        username={invoice.username}
        link={link}
        invoice={invoice.checkout}
        onPaid={onPaid}
        invoiceLifecycle={invoiceLifecycle}
      />
    );
  }
  return (
    <DashboardBackground>
      <main
        id="main-content"
        className="mx-auto min-h-svh max-w-5xl px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6"
      >
        <header className="mb-8 flex items-center justify-between gap-4">
          <Link href="/" className="text-xl font-medium tracking-tight">
            Meaw
          </Link>
          {chain.testnet && (
            <p className="text-xs text-(--dash-ash)">
              Testnet invoice · test funds
            </p>
          )}
        </header>
        {!invoice ? (
          query.isError ? (
            <section
              role="alert"
              className={`${dashCell} border border-(--dash-line) p-6`}
            >
              <h1 className="text-xl">Invoice unavailable</h1>
              <p className="my-3 text-sm text-(--dash-ash)">
                The link may be invalid, or the service could not be reached.
              </p>
              <button
                type="button"
                className={dashButtonSecondary}
                onClick={() => void query.refetch()}
              >
                Try again
              </button>
            </section>
          ) : (
            <p role="status">Loading invoice…</p>
          )
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <article
              className={`${dashCell} border border-(--dash-line-solid) p-5 sm:p-8`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="dashboard-tile-title">
                    Invoice from @{invoice.username}
                  </p>
                  <h1 className="mt-3 break-all text-3xl font-normal tracking-tight">
                    {invoice.number}
                  </h1>
                </div>
                <span className="rounded-full border border-(--dash-line) px-3 py-1 text-sm">
                  {state ? labels[state] : ""}
                </span>
              </div>
              <dl className="my-7 grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-(--dash-ash)">Bill to</dt>
                  <dd className="mt-1 break-words font-medium">
                    {invoice.clientName}
                  </dd>
                </div>
                <div>
                  <dt className="text-(--dash-ash)">Due date (UTC)</dt>
                  <dd className="mt-1">{invoiceDate(invoice.dueDate)}</dd>
                </div>
              </dl>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Invoice line items</caption>
                  <thead className="border-y border-(--dash-line) text-(--dash-ash)">
                    <tr>
                      <th className="py-3 font-normal" scope="col">
                        Description
                      </th>
                      <th className="px-3 py-3 font-normal" scope="col">
                        Qty
                      </th>
                      <th className="py-3 text-right font-normal" scope="col">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item) => (
                      <tr
                        key={item.id}
                        className="border-b border-(--dash-line)"
                      >
                        <td className="min-w-32 break-words py-4">
                          {item.description}
                          <span className="mt-1 block text-xs text-(--dash-ash)">
                            {amount(item.unitPrice)} each
                          </span>
                        </td>
                        <td className="px-3 py-4 tabular-nums">
                          {item.quantity}
                        </td>
                        <td className="py-4 text-right whitespace-nowrap tabular-nums">
                          {amount(
                            (
                              BigInt(item.unitPrice) * BigInt(item.quantity)
                            ).toString(),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-6 flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-sm text-(--dash-ash)">Total due</span>
                <strong className="text-2xl font-medium tabular-nums">
                  {amount(invoice.amount)}
                </strong>
              </div>
              {invoice.notes && (
                <p className="mt-7 break-words whitespace-pre-wrap text-sm leading-6 text-(--dash-ash)">
                  {invoice.notes}
                </p>
              )}
              <p className="mt-7 border-t border-(--dash-line) pt-4 text-xs leading-5 text-(--dash-ash)">
                Invoice details are visible to anyone with this link. The
                recipient's private balance and spending history stay protected.
              </p>
            </article>
            <aside className="grid gap-4" aria-label="Invoice payment">
              {checkout}
              {checkout && notice && (
                <p role="status" className="text-sm text-(--dash-ash)">
                  {notice}
                </p>
              )}
              {invoice.status === "paid" && (
                <section
                  className={`${dashCell} border border-(--dash-line) p-6`}
                  role="status"
                >
                  <MeawMascot mood="success" />
                  <h2 className="mt-4 text-xl">Invoice paid</h2>
                  <p className="mt-2 text-sm text-(--dash-ash)">
                    Payment has been verified for @{invoice.username}.
                  </p>
                  {invoice.voidedAt && (
                    <p className="mt-2 text-sm">
                      Payment was confirmed after this invoice was voided.
                    </p>
                  )}
                </section>
              )}
              {invoice.status === "void" && (
                <section
                  className={`${dashCell} border border-(--dash-line) p-6`}
                >
                  <h2 className="text-xl">Invoice voided</h2>
                  <p className="mt-2 text-sm text-(--dash-ash)">
                    Checkout is closed. An already-submitted payment can still
                    be confirmed.
                  </p>
                </section>
              )}
              {(hash || unresolved) && invoice.status !== "paid" && (
                <section
                  className={`${dashCell} border border-(--dash-line) p-6`}
                >
                  <h2 className="text-xl">
                    {hash ? "Payment submitted" : "Check your payment"}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-(--dash-ash)">
                    {notice ||
                      "Check this payment's status. You do not need to send it again."}
                  </p>
                  <button
                    type="button"
                    className={`${dashButtonPrimary} mt-4 min-h-11`}
                    disabled={checking}
                    onClick={() => void confirm(hash ?? undefined)}
                  >
                    {checking ? "Checking payment…" : "Check payment status"}
                  </button>
                </section>
              )}
              {query.isError && invoice.status === "pending" && !hash && (
                <p role="alert" className="text-sm">
                  Invoice status cannot be checked.{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void query.refetch()}
                  >
                    Retry before paying
                  </button>
                  .
                </p>
              )}
              {(invoice.paidTx || hash) && (
                <a
                  href={explorerTxUrl(invoice.paidTx ?? hash ?? "")}
                  rel="noreferrer"
                  target="_blank"
                  className="text-sm underline underline-offset-4"
                >
                  View payment transaction
                </a>
              )}
            </aside>
          </div>
        )}
      </main>
    </DashboardBackground>
  );
}
