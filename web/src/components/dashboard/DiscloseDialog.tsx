"use client";

import { Download, Loader } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPrivacyKeyring } from "../../features/privacyKeys/session";
import { downloadReceiptJson } from "../../features/receipts/downloadReceiptJson";
import { prepareReceipt } from "../../features/receipts/prepareReceipt";
import { loadReceiptSnapshot } from "../../features/receipts/receiptClient";
import type { ReceiptV2 } from "../../features/receipts/receiptTypes";
import { downloadDisclosurePdf } from "../../lib/disclosurePdf";
import type { LocalAccount } from "../../lib/notes";
import { getAccount, scanKeyringNotes, scanMyNotes } from "../../lib/notes";
import { assetLabelFor, formatAssetUnits } from "../../lib/paymentAsset";
import { activePool, type PoolDescriptor } from "../../lib/pools";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { linenInsetClass } from "../ui/glass";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";

type Step = "building" | "ready" | "error";

export function DiscloseDialog({
  open,
  onClose,
  leafIndex,
  pool: providedPool,
}: {
  open: boolean;
  onClose: () => void;
  leafIndex: number | null;
  pool?: PoolDescriptor;
}) {
  const { username, address, accountUnlocked } = useWallet();
  const pool = providedPool ?? activePool();
  const [step, setStep] = useState<Step>("building");
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ReceiptV2 | null>(null);

  const session = `${address}:${accountUnlocked}:${open}:${pool.scope}:${leafIndex}`;
  const identity = useRef(session),
    generation = useRef(0);
  identity.current = session;
  const prepared = useRef<{
    account: LocalAccount;
    session: string;
    generation: number;
  } | null>(null);
  const build = useCallback(async () => {
    const at = identity.current,
      run = ++generation.current,
      acct = getAccount();
    setBundle(null);
    prepared.current = null;
    setError(null);
    setStep("building");
    const current = () =>
      generation.current === run &&
      identity.current === at &&
      getAccount() === acct;
    try {
      if (!acct || !accountUnlocked)
        throw new Error("Unlock your account to prepare a receipt.");
      if (leafIndex === null)
        throw new Error("Choose a payment for the receipt.");
      const ring = getPrivacyKeyring();
      const scan = ring
        ? await scanKeyringNotes(ring, pool, {
            refresh: true,
            includeRequestRecovery: true,
            includeTransferRecovery: true,
          })
        : await scanMyNotes(acct, {
            pool,
            refresh: true,
            includeRequestRecovery: true,
            includeTransferRecovery: true,
          });
      if (!current()) return;
      const note = scan.notes.find((n) => n.leafIndex === leafIndex);
      if (!note) throw new Error("That payment is no longer available.");
      const disclosure = await prepareReceipt({
        acct,
        scan,
        note,
        username,
        load: loadReceiptSnapshot,
        isCurrent: current,
      });
      if (!current()) return;
      setBundle(disclosure);
      prepared.current = { account: acct, session: at, generation: run };
      setStep("ready");
    } catch (e) {
      if (!current()) return;
      setError(
        e instanceof Error ? e.message : "Receipt could not be prepared.",
      );
      setStep("error");
    }
  }, [leafIndex, username, pool, accountUnlocked]);
  useEffect(() => {
    if (identity.current !== session) return;
    if (open) void build();
    else setBundle(null);
    return () => {
      generation.current++;
    };
  }, [open, build, session]);
  async function download(kind: "pdf" | "json") {
    const accepted = prepared.current;
    if (!bundle || !accepted) return;
    const current = () =>
      identity.current === accepted.session &&
      generation.current === accepted.generation &&
      getAccount() === accepted.account &&
      prepared.current === accepted;
    if (!current()) {
      setBundle(null);
      setError("Your account or selection changed. Prepare the receipt again.");
      setStep("error");
      return;
    }
    try {
      if (kind === "json") await downloadReceiptJson(bundle, current);
      else
        await downloadDisclosurePdf(bundle, {
          verifyUrl: new URL("/verify", window.location.origin).href,
          verifiedAtExport: true,
          isCurrent: current,
        });
    } catch {
      if (current()) setError("Receipt could not be downloaded. Try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent appearance="linen" size="md">
        <DialogHeader>
          <DialogTitle>Create payment receipt</DialogTitle>
          <DialogDescription>
            Build a verifiable receipt for this private payment.
          </DialogDescription>
        </DialogHeader>

        {step === "building" && (
          <div className="flex items-center justify-center gap-2 py-8 text-center">
            <Loader
              className="size-4 text-foreground/70 motion-safe:animate-spin"
              aria-hidden="true"
            />
            <div className="text-sm font-medium text-foreground">
              Preparing your receipt…
            </div>
          </div>
        )}

        {step === "error" && (
          <div className="grid gap-4">
            <ToastFeedback
              message={error}
              variant="error"
              toastId="disclosure-error"
              action={{ label: "Try again", onClick: () => void build() }}
            />
            <Button variant="default" className="min-h-11" onClick={build}>
              Try again
            </Button>
          </div>
        )}

        {step === "ready" && bundle && (
          <div className="grid gap-4">
            <div className={cn(linenInsetClass, "rounded-(--dash-radius) p-4")}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-foreground/65">
                  Payment received
                </span>
                <span className="font-heading text-2xl font-semibold text-foreground">
                  {formatAssetUnits(
                    BigInt(bundle.amount),
                    bundle.tokenDecimals ?? 6,
                  )}{" "}
                  {assetLabelFor(bundle.asset ?? "USDC")}
                </span>
              </div>
              <dl className="mt-3 grid gap-1.5 border-t border-foreground/15 pt-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-foreground/65">Recipient</dt>
                  <dd className="font-medium text-foreground">
                    {bundle.username ? `@${bundle.username}` : "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-foreground/65">Payment reference</dt>
                  <dd className="font-mono text-foreground">
                    #{bundle.leafIndex}
                  </dd>
                </div>
              </dl>
            </div>

            <p className="text-xs text-foreground/65">
              Sharing the proof reveals this note’s amount and recipient public
              key. The username is provided by the receipt issuer.
            </p>
            <Button
              onClick={() => void download("json")}
              className="min-h-11"
              variant="outline"
            >
              Download proof (JSON)
            </Button>
            <Button
              variant="default"
              className="min-h-11 mt-4"
              size="lg"
              onClick={() => void download("pdf")}
            >
              <Download className="size-4" aria-hidden="true" />
              Download receipt (PDF)
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
