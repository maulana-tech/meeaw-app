"use client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  SponsorshipNotice,
  sponsorshipMessage,
} from "../../features/sponsorship/SponsorshipNotice";
import { useSponsorship } from "../../features/sponsorship/useSponsorship";
import { createSignedTransfer } from "../../features/transfers/transferCrypto";
import type {
  TransferParticipant,
  TransferRecord,
} from "../../features/transfers/types";
import {
  parseTransferAmount,
  validateTransferNote,
} from "../../features/transfers/validation";
import { ASSETS } from "../../lib/assets";
import { getAccount, scanMyNotes } from "../../lib/notes";
import { formatAssetUnits } from "../../lib/paymentAsset";
import { type PoolDescriptor, requestPool } from "../../lib/pools";
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

type Review = {
  sender: TransferParticipant;
  recipient: TransferParticipant;
  amount: bigint;
  note: string;
  identity: string;
};
async function resolve(username: string): Promise<TransferParticipant> {
  const r = await api.usernames.resolve.query({ username });
  if (!r) throw new Error("This username is not registered.");
  const hex = (v: string) =>
    `0x${v.replace(/^0x/, "").toLowerCase()}` as `0x${string}`;
  return {
    username,
    wallet: r.owner.toLowerCase() as `0x${string}`,
    notePubkey: hex(r.notePubkeyHex),
    viewPubkey: hex(r.viewPubkeyHex),
  };
}
export function SendTransferDialog({
  open,
  onOpenChange,
  onCreated,
  pool: providedPool,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (record: TransferRecord) => void;
  pool?: PoolDescriptor;
}) {
  const wallet = useWallet(),
    [username, setUsername] = useState(""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [error, setError] = useState<string | null>(null),
    [working, setWorking] = useState(false);
  const sponsorship = useSponsorship({ enabled: open });
  const chosenPool = providedPool ?? requestPool(),
    asset = chosenPool ? ASSETS[chosenPool.asset ?? "USDC"].label : "USDC";
  const busy = useRef(false),
    identity = `${wallet.address.toLowerCase()}:${wallet.accountUnlocked}:${open}:${chosenPool?.scope ?? ""}`,
    session = useRef(identity);
  session.current = identity;
  useEffect(() => {
    session.current = identity;
    setReview(null);
    setError(null);
    setUsername("");
    setAmount("");
    setNote("");
  }, [identity]);
  async function inspect(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    const at = session.current;
    try {
      const handle = username.trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9_]{3,32}$/.test(handle))
        throw new Error("Enter a registered @username.");
      const pool = chosenPool,
        account = getAccount();
      if (!pool || !account || !wallet.username)
        throw new Error("Unlock your registered Meaw account before sending.");
      if (
        pool.role !== "active" ||
        !(pool.transferCapable ?? pool.requestCapable)
      )
        throw new Error(
          `${asset} private sending is not enabled for this pool.`,
        );
      const units = parseTransferAmount(amount, pool.tokenDecimals),
        memo = validateTransferNote(note);
      const [sender, recipient, status, scan] = await Promise.all([
        resolve(wallet.username),
        resolve(handle),
        api.relay.status.query(),
        scanMyNotes(account, {
          pool,
          includeRequestRecovery: true,
          includeTransferRecovery: true,
        }),
      ]);
      if (session.current !== at || getAccount() !== account) return;
      if (sender.wallet.toLowerCase() !== wallet.address.toLowerCase())
        throw new Error("This username belongs to another account.");
      if (
        recipient.wallet === sender.wallet ||
        recipient.username === sender.username
      )
        throw new Error("You cannot send to yourself.");
      if (!status.enabled)
        throw new Error("Private sending is temporarily unavailable.");
      if (scan.health !== "healthy")
        throw new Error("Refresh your balance before sending.");
      if (scan.claimable < units)
        throw new Error(
          `Your active private ${asset} balance is too low. Legacy balances must be cashed out separately.`,
        );
      setReview({ sender, recipient, amount: units, note: memo, identity: at });
    } catch (e) {
      if (session.current === at)
        setError(
          e instanceof Error
            ? e.message
            : "The recipient could not be checked.",
        );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  async function confirm() {
    if (!review || busy.current) return;
    busy.current = true;
    setWorking(true);
    setError(null);
    const at = session.current;
    try {
      const account = getAccount(),
        pool = chosenPool;
      if (!account || !pool || at !== review.identity)
        throw new Error("Unlock this account and review the transfer again.");
      const allowance = await sponsorship.refresh();
      if (session.current !== at) return;
      if (!allowance?.available)
        throw new Error(
          sponsorshipMessage(allowance?.reason ?? "rpc", allowance?.resetAt),
        );
      const currentRecipient = await resolve(review.recipient.username);
      if (session.current !== at) return;
      if (
        JSON.stringify(currentRecipient) !== JSON.stringify(review.recipient)
      ) {
        setReview(null);
        throw new Error("Review the recipient again: their keys changed.");
      }
      const signer = await wallet.getSigner();
      if (session.current !== at || getAccount() !== account) return;
      const record = await createSignedTransfer({
        id: crypto.randomUUID(),
        pool,
        sender: review.sender,
        recipient: review.recipient,
        account,
        signer,
        amount: review.amount,
        note: review.note,
        createdAt: new Date().toISOString(),
      });
      if (session.current !== at || getAccount() !== account) return;
      const created = await api.transfers.create.mutate({ record });
      if (session.current !== at) return;
      onCreated(created);
      onOpenChange(false);
      window.dispatchEvent(new Event("mawee:transfers-changed"));
    } catch (e) {
      if (session.current === at)
        setError(
          e instanceof Error ? e.message : "The transfer could not be created.",
        );
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy.current) onOpenChange(next);
      }}
    >
      <DialogContent appearance="linen" size="sm" showCloseButton={!working}>
        <DialogHeader>
          <DialogTitle>
            {review ? "Review transfer" : "Send privately"}
          </DialogTitle>
          <DialogDescription>
            Send {asset} from your private balance to another Meaw user.
          </DialogDescription>
        </DialogHeader>
        {wallet.accountUnlocked && (
          <SponsorshipNotice
            status={sponsorship.status}
            loading={sponsorship.loading}
            onRefresh={() => {
              void sponsorship.refresh();
            }}
          />
        )}
        {!wallet.accountUnlocked ? (
          <div className="grid gap-4">
            <p>Unlock Meaw to send a private payment.</p>
            <Button onClick={wallet.promptUnlock}>Unlock Meaw</Button>
          </div>
        ) : review ? (
          <div className="grid gap-5">
            <dl className="grid gap-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt>Send to</dt>
                <dd className="font-semibold">@{review.recipient.username}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>Amount</dt>
                <dd className="font-semibold tabular-nums">
                  {formatAssetUnits(
                    review.amount,
                    chosenPool?.tokenDecimals ?? 6,
                  )}{" "}
                  {asset}
                </dd>
              </div>
              {review.note && (
                <div>
                  <dt className="text-muted-foreground">Private note</dt>
                  <dd className="mt-1 break-words whitespace-pre-wrap">
                    {review.note}
                  </dd>
                </div>
              )}
            </dl>
            <p className="text-xs leading-5 text-muted-foreground">
              Your amount and note are encrypted for both of you. Once
              submitted, this payment cannot be cancelled.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={working}
                onClick={() => setReview(null)}
              >
                Back
              </Button>
              <Button
                className="min-h-11 flex-1"
                disabled={
                  working ||
                  sponsorship.loading ||
                  !sponsorship.status?.available
                }
                onClick={() => void confirm()}
              >
                {working ? "Preparing transfer…" : "Confirm send"}
              </Button>
            </div>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={inspect}>
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="send-username"
            >
              Send to
              <Input
                appearance="linen"
                id="send-username"
                placeholder="@username"
                autoComplete="off"
                autoCapitalize="none"
                maxLength={33}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="send-amount"
            >
              Amount · {asset}
              <Input
                appearance="linen"
                id="send-amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="send-note"
            >
              Note (optional)
              <textarea
                id="send-note"
                rows={3}
                maxLength={400}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-20 resize-y rounded-lg border border-input bg-card/70 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
              />
              <span className="text-xs font-normal text-muted-foreground">
                {[...note].length}/200 characters
              </span>
            </label>
            <Button type="submit" className="min-h-11" disabled={working}>
              {working ? "Checking recipient…" : "Review transfer"}
            </Button>
          </form>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
