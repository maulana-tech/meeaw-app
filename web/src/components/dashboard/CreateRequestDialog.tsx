"use client";
import { Loader } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useCreateRequest } from "../../features/requests/hooks/useCreateRequest";
import {
  parseRequestAmount,
  validateRequestNote,
} from "../../features/requests/validation";
import { ASSETS } from "../../lib/assets";
import { REQUESTS_PATH } from "../../lib/auth-routes";
import type { PoolDescriptor } from "../../lib/pools";
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
import { PaymentAssetSelect } from "./PaymentAssetSelect";
import { useSelectedPool } from "./useSelectedPool";

export function CreateRequestDialog({
  open,
  onOpenChange,
  pool: providedPool,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pool?: PoolDescriptor;
}) {
  const [username, setUsername] = useState(""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [localError, setLocalError] = useState<string | null>(null);
  const { create, isCreating, error, clearError } = useCreateRequest(),
    router = useRouter(),
    wallet = useWallet();
  const selected = useSelectedPool(),
    [choice, setChoice] = useState<PoolDescriptor | null>(null),
    pool = providedPool ?? choice ?? selected;
  const asset = ASSETS[pool.asset ?? "USDC"].label,
    session = `${wallet.address}:${open}:${pool.scope}`,
    live = useRef(session);
  live.current = session;
  useEffect(() => {
    if (!open) {
      setChoice(null);
      setAmount("");
      setNote("");
      setUsername("");
    }
  }, [open]);
  const poolEnabled = pool.role === "active" && pool.requestCapable;
  function reset() {
    setUsername("");
    setAmount("");
    setNote("");
    setLocalError(null);
    clearError();
  }
  function close() {
    if (isCreating) return;
    reset();
    onOpenChange(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    clearError();
    try {
      validateRequestNote(note);
      if (!amount.trim()) throw new Error("Enter an amount greater than zero.");
      if (!poolEnabled)
        throw new Error(
          "Private requests are not available for this asset yet.",
        );
      parseRequestAmount(amount, pool.tokenDecimals);
      const at = live.current;
      await create({
        username,
        amount,
        note,
        pool,
        isCurrent: () => live.current === at,
      });
      if (live.current !== at) return;
      reset();
      onOpenChange(false);
      router?.push(REQUESTS_PATH);
    } catch (e) {
      setLocalError(
        e instanceof Error
          ? e.message
          : "Your request could not be created. Try again.",
      );
    }
  }
  const message = localError ?? (error instanceof Error ? error.message : null);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent appearance="linen" size="sm" showCloseButton={!isCreating}>
        <DialogHeader>
          <DialogTitle>Request a payment</DialogTitle>
          <DialogDescription>
            Ask another Meaw user to pay you privately.
          </DialogDescription>
        </DialogHeader>
        {!providedPool && (
          <PaymentAssetSelect
            value={pool.scope}
            onChange={setChoice}
            kind="request"
            disabled={isCreating}
          />
        )}
        {!poolEnabled ? (
          <p className="text-sm text-muted-foreground">
            Private requests are not enabled for this pool yet.
          </p>
        ) : !wallet.accountUnlocked ? (
          <div className="grid gap-4">
            <p>Unlock your account to create a private request.</p>
            <Button onClick={wallet.promptUnlock}>Unlock Meaw</Button>
          </div>
        ) : (
          <form className="grid gap-3" onSubmit={submit}>
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="request-username"
            >
              Request from
              <Input
                appearance="linen"
                id="request-username"
                name="username"
                placeholder="@username"
                autoComplete="off"
                autoCapitalize="none"
                required
                maxLength={33}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="request-amount"
            >
              Amount · {asset}
              <Input
                appearance="linen"
                id="request-amount"
                name="amount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                autoComplete="off"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label
              className="grid gap-2 text-sm font-medium"
              htmlFor="request-note"
            >
              Note{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
              <textarea
                id="request-note"
                name="note"
                maxLength={400}
                rows={3}
                placeholder="What is this payment for?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="min-h-20 w-full resize-y rounded-lg border border-input bg-card/70 px-3 py-2 text-base text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/45"
              />
              <span className="text-xs text-muted-foreground">
                {Array.from(note).length}/200 characters
              </span>
            </label>
            {message && (
              <p
                role="alert"
                className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                aria-live="polite"
              >
                {message}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Your amount and note are encrypted for you and the person you
              request from.
            </p>
            <Button
              type="submit"
              variant="default"
              className="mt-2 min-h-11"
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <Loader className="size-4 animate-spin" aria-hidden="true" />
                  Creating request…
                </>
              ) : (
                "Send request"
              )}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
