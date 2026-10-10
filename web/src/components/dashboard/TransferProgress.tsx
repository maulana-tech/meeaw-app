"use client";
import { useEffect, useRef, useState } from "react";
import { SponsorshipNotice } from "../../features/sponsorship/SponsorshipNotice";
import { useSponsorship } from "../../features/sponsorship/useSponsorship";
import { useDirectTransfer } from "../../features/transfers/hooks/useDirectTransfer";
import { openTransfer } from "../../features/transfers/transferCrypto";
import type {
  TransferPayload,
  TransferRecord,
} from "../../features/transfers/types";
import { chain } from "../../lib/chain";
import { getAccount } from "../../lib/notes";
import { formatPaymentAmount } from "../../lib/paymentAsset";
import { resolvePool } from "../../lib/pools";
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

const phaseLabels = {
  preparing: "Preparing payment",
  submitting: "Sending payment",
  submitted: "Confirming payment",
  needsReconciliation: "Checking payment status",
  confirmed: "Payment confirmed",
  failed: "Payment failed",
};
export function TransferProgress({
  record,
  open,
  onClose,
  autoStart = false,
}: {
  record: TransferRecord;
  open: boolean;
  onClose: () => void;
  autoStart?: boolean;
}) {
  const wallet = useWallet(),
    transfer = useDirectTransfer(record),
    started = useRef(""),
    [details, setDetails] = useState<{
      owner: string;
      payload: TransferPayload;
    } | null>(null);
  const sponsorship = useSponsorship({ enabled: open });
  useEffect(() => {
    if (autoStart && started.current !== record.id && wallet.accountUnlocked) {
      started.current = record.id;
      void transfer.continueSend().catch(() => {});
    }
  }, [autoStart, record.id, wallet.accountUnlocked, transfer.continueSend]);
  const owner = `${wallet.address}:${wallet.accountUnlocked}`;
  useEffect(() => {
    let cancelled = false;
    const account = getAccount();
    setDetails(null);
    if (wallet.accountUnlocked && account)
      void openTransfer(record, account, resolvePool(record.pool))
        .then((payload) => {
          if (!cancelled && getAccount() === account)
            setDetails({ owner, payload });
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [record, owner, wallet.accountUnlocked]);
  const phase = transfer.operation?.phase,
    title = transfer.operation?.sponsorshipPause
      ? "Gasless transfer paused"
      : phase
        ? phaseLabels[phase]
        : "Checking transfer",
    payload = details?.owner === owner ? details.payload : null;
  const explorer = chain.blockExplorers?.default.url,
    hash = transfer.operation?.txHash;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent appearance="linen" size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Your transfer stays available in History when you close this window.
          </DialogDescription>
        </DialogHeader>
        {phase === "confirmed" && (
          <div className="flex items-center gap-3" role="status">
            <MeawMascot mood="success" size={48} tone="ink" />
            <p className="text-sm">
              Your payment is confirmed. You can find it in History.
            </p>
          </div>
        )}
        {(phase === "preparing" || transfer.operation?.sponsorshipPause) && (
          <SponsorshipNotice
            status={sponsorship.status}
            loading={sponsorship.loading}
            pause={transfer.operation?.sponsorshipPause}
            captured={Boolean(transfer.operation?.sponsorshipAction)}
            onRefresh={() => {
              void sponsorship.refresh();
            }}
          />
        )}
        {payload ? (
          <div className="grid gap-2">
            <p className="text-2xl tabular-nums">
              {formatPaymentAmount(BigInt(payload.amount), record.pool)}
            </p>
            <p className="text-sm text-muted-foreground">
              To @{record.recipient.username}
            </p>
            {payload.note && (
              <p className="break-words whitespace-pre-wrap text-sm">
                {payload.note}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm">
            Unlock Meaw to read the transfer amount and note.
          </p>
        )}
        {transfer.error && (
          <p role="alert" className="text-sm text-destructive">
            {transfer.error}
          </p>
        )}
        {phase === "needsReconciliation" && (
          <p role="status" className="text-sm text-muted-foreground">
            Your payment is being checked. Keep this transfer; starting another
            could pay twice.
          </p>
        )}
        {hash && explorer && (
          <a
            className="text-sm underline underline-offset-4"
            href={`${explorer}/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
          </a>
        )}
        {!wallet.accountUnlocked ? (
          <Button onClick={wallet.promptUnlock}>Unlock Meaw</Button>
        ) : phase === "preparing" || transfer.operation?.sponsorshipPause ? (
          <Button
            disabled={transfer.working}
            onClick={() => void transfer.continueSend().catch(() => {})}
          >
            {transfer.working
              ? "Preparing payment…"
              : transfer.operation?.sponsorshipPause
                ? "Resume transfer"
                : "Continue transfer"}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogContent>
    </Dialog>
  );
}
