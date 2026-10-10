"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { invoiceInput, invoiceTotal } from "../../features/invoices/input";
import type { InvoiceView } from "../../features/invoices/types";
import { formatAssetUnits } from "../../lib/paymentAsset";
import { activePoolFor } from "../../lib/pools";
import { api } from "../../trpc/client";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { useWallet } from "../WalletProvider";

const emptyLine = () => ({
  id: "initial",
  description: "",
  quantity: "1",
  unitPrice: "",
});
export function CreateInvoiceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreated: (invoice: InvoiceView) => void;
}) {
  const wallet = useWallet(),
    assets = (["USDC", "AUSD"] as const).filter((asset) => {
      const p = activePoolFor(asset);
      return (
        p?.role === "active" &&
        p.tokenDecimals === 6 &&
        (p.requestCapable || p.transferCapable)
      );
    });
  const [number, setNumber] = useState(""),
    [clientName, setClientName] = useState(""),
    [dueDate, setDueDate] = useState(
      new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    ),
    [notes, setNotes] = useState("");
  const [asset, setAsset] = useState<"USDC" | "AUSD">(assets[0] ?? "USDC"),
    [lines, setLines] = useState([emptyLine()]),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false);
  const identity = `${wallet.address}:${wallet.username}:${open}`,
    session = useRef(identity),
    mounted = useRef(true),
    busy = useRef(false);
  session.current = identity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const inputItems = lines.map(({ description, quantity, unitPrice }) => ({
    description,
    quantity: Number(quantity),
    unitPrice,
  }));
  let total: bigint | null = null;
  try {
    if (
      lines.every(
        (l) =>
          Number.isInteger(Number(l.quantity)) &&
          Number(l.quantity) > 0 &&
          /^\d+(\.\d{1,6})?$/.test(l.unitPrice),
      )
    )
      total = invoiceTotal(inputItems);
  } catch {}
  function change(
    id: string,
    key: "description" | "quantity" | "unitPrice",
    value: string,
  ) {
    setLines((items) =>
      items.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    );
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    const parsed = invoiceInput.safeParse({
      username: wallet.username,
      number,
      clientName,
      dueDate,
      asset,
      notes,
      items: inputItems,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message ?? "Review the invoice details.",
      );
      return;
    }
    const at = session.current;
    busy.current = true;
    setWorking(true);
    try {
      const invoice = await api.invoices.create.mutate(parsed.data);
      if (mounted.current && session.current === at) {
        onCreated(invoice);
        onOpenChange(false);
        setNumber("");
        setClientName("");
        setNotes("");
        setLines([emptyLine()]);
      }
    } catch (e) {
      if (mounted.current && session.current === at)
        setError(
          e instanceof Error
            ? e.message
            : "Invoice could not be created. Check your list before retrying.",
        );
    } finally {
      busy.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy.current) onOpenChange(value);
      }}
    >
      <DialogContent appearance="linen" size="lg" showCloseButton={!working}>
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>
            Publish an invoice and share its payment link. Details are visible
            to the server and anyone with the link.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void submit(event)}
          className="grid gap-5"
          aria-label="Create invoice"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm" htmlFor="invoice-number">
              Invoice number
              <Input
                id="invoice-number"
                appearance="linen"
                className="min-h-11"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="INV-2026-001"
                maxLength={40}
                required
              />
            </label>
            <label className="grid gap-2 text-sm" htmlFor="invoice-client">
              Client name
              <Input
                id="invoice-client"
                appearance="linen"
                className="min-h-11"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                maxLength={120}
                required
              />
            </label>
            <label className="grid gap-2 text-sm" htmlFor="invoice-due">
              Due date (UTC)
              <Input
                id="invoice-due"
                appearance="linen"
                className="min-h-11"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </label>
            <label className="grid gap-2 text-sm" htmlFor="invoice-asset">
              Payment asset
              <select
                id="invoice-asset"
                className="min-h-11 rounded-lg border border-input bg-card px-3 text-base"
                value={asset}
                onChange={(e) => setAsset(e.target.value as "USDC" | "AUSD")}
                disabled={working}
              >
                {assets.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="grid gap-4">
            <legend className="mb-3 text-sm font-medium">Line items</legend>
            {lines.map((item, index) => (
              <div
                key={item.id}
                className="grid grid-cols-[minmax(0,1fr)_2.75rem] gap-3 border-b border-border pb-4"
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_4.5rem_7.5rem]">
                  <label
                    className="grid gap-2 text-sm"
                    htmlFor={`invoice-desc-${item.id}`}
                  >
                    Description {index + 1}
                    <Input
                      id={`invoice-desc-${item.id}`}
                      appearance="linen"
                      className="min-h-11"
                      value={item.description}
                      onChange={(e) =>
                        change(item.id, "description", e.target.value)
                      }
                      maxLength={200}
                      required
                    />
                  </label>
                  <label
                    className="grid gap-2 text-sm"
                    htmlFor={`invoice-qty-${item.id}`}
                  >
                    Quantity {index + 1}
                    <Input
                      id={`invoice-qty-${item.id}`}
                      appearance="linen"
                      className="min-h-11"
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={item.quantity}
                      onChange={(e) =>
                        change(item.id, "quantity", e.target.value)
                      }
                      required
                    />
                  </label>
                  <label
                    className="grid gap-2 text-sm"
                    htmlFor={`invoice-price-${item.id}`}
                  >
                    Unit price {index + 1} · {asset}
                    <Input
                      id={`invoice-price-${item.id}`}
                      appearance="linen"
                      className="min-h-11"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={item.unitPrice}
                      onChange={(e) =>
                        change(item.id, "unitPrice", e.target.value)
                      }
                      required
                    />
                  </label>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-6 min-h-11"
                  size="icon"
                  aria-label={`Remove line ${index + 1}`}
                  disabled={lines.length === 1 || working}
                  onClick={() =>
                    setLines((items) =>
                      items.filter((line) => line.id !== item.id),
                    )
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            ))}
          </fieldset>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 justify-self-start"
            disabled={lines.length >= 25 || working}
            onClick={() =>
              setLines((items) => [
                ...items,
                { ...emptyLine(), id: crypto.randomUUID() },
              ])
            }
          >
            <Plus aria-hidden="true" />
            Add line
          </Button>
          <label className="grid gap-2 text-sm" htmlFor="invoice-notes">
            Notes (optional)
            <textarea
              id="invoice-notes"
              className="min-h-20 w-full rounded-lg border border-input bg-card p-3 text-base"
              value={notes}
              maxLength={1000}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-t border-border pt-4">
            <span>Total</span>
            <strong className="text-xl font-medium tabular-nums">
              {total === null ? "—" : `${formatAssetUnits(total, 6)} ${asset}`}
            </strong>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            The amount, recipient and invoice details are fixed after
            publication. You can void a pending invoice and create a
            replacement.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            className="min-h-11"
            disabled={working || assets.length === 0 || !wallet.username}
          >
            {working ? "Creating invoice…" : "Create invoice"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
