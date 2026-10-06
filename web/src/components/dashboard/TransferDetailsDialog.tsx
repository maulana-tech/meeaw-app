"use client";
import { useEffect, useState } from "react";
import { openTransfer } from "../../features/transfers/transferCrypto";
import type {
  TransferPayload,
  TransferRecord,
} from "../../features/transfers/types";
import { fromBaseUnits } from "../../lib/crypto";
import { getAccount } from "../../lib/notes";
import { resolvePool } from "../../lib/pools";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useWallet } from "../WalletProvider";
export function TransferDetailsDialog({
  record,
  open,
  onOpenChange,
}: {
  record: TransferRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wallet = useWallet(),
    owner = `${wallet.address}:${wallet.accountUnlocked}:${open}`,
    [data, setData] = useState<{
      owner: string;
      payload: TransferPayload;
    } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    const account = getAccount();
    if (open && wallet.accountUnlocked && account)
      void openTransfer(record, account, resolvePool(record.pool))
        .then((payload) => {
          if (!cancelled && getAccount() === account)
            setData({ owner, payload });
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, record, open, wallet.accountUnlocked]);
  const payload = data?.owner === owner ? data.payload : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent appearance="linen" size="sm">
        <DialogHeader>
          <DialogTitle>Private transfer</DialogTitle>
          <DialogDescription>
            {record.status === "confirmed"
              ? "Confirmed on-chain"
              : record.status === "failed"
                ? "This attempt did not complete"
                : "Payment is in progress"}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          @{record.sender.username} to @{record.recipient.username}
        </p>
        {payload ? (
          <>
            <p className="text-2xl tabular-nums">
              {fromBaseUnits(BigInt(payload.amount))} USDC
            </p>
            {payload.note && (
              <p className="break-words whitespace-pre-wrap text-sm">
                {payload.note}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {wallet.accountUnlocked
              ? "This transfer cannot be read with your current keys."
              : "Unlock to read the amount and note."}
          </p>
        )}
        {!wallet.accountUnlocked && (
          <Button onClick={wallet.promptUnlock}>Unlock Mawee</Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
