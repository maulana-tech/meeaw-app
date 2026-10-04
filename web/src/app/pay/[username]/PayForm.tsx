"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { ToastFeedback } from "../../../components/ui/toast-feedback";
import { usePayerWallet } from "../../../features/payerWallet/hooks/usePayerWallet";
import { payerSigner } from "../../../features/payerWallet/injected";
import type { PaymentLink } from "../../../features/paymentLinks/types";
import {
  chain,
  explorerTxUrl,
  type MaweeAccount,
  usdcBalance,
} from "../../../lib/chain";
import { fromBaseUnits, toBaseUnits } from "../../../lib/crypto";
import { payIntoNote } from "../../../lib/deposit";

const payInput = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Enter a valid amount")
    .refine((v) => toBaseUnits(v) > 0n, "Enter an amount greater than zero."),
});
type PayInput = z.infer<typeof payInput>;

export function PayForm({
  account,
  username,
  link,
}: {
  account: MaweeAccount;
  username: string;
  link?: PaymentLink | null;
}) {
  const { address, connecting, error: walletError, connect } = usePayerWallet();
  const [status, setStatus] = useState<{
    kind: "ok" | "err";
    msg: string;
    url?: string;
  } | null>(null);

  const lockedAmount =
    link && link.owner === username && link.amount
      ? fromBaseUnits(BigInt(link.amount))
      : null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PayInput>({
    resolver: zodResolver(payInput),
    defaultValues: { amount: lockedAmount ?? "" },
  });

  useEffect(() => {
    reset({ amount: lockedAmount ?? "" });
  }, [lockedAmount, reset]);

  const onSubmit = handleSubmit(async ({ amount }) => {
    setStatus(null);
    if (!address) {
      setStatus({ kind: "err", msg: "Connect your wallet to pay." });
      return;
    }
    try {
      const units = toBaseUnits(amount);
      const signer = await payerSigner(address);
      if ((await usdcBalance(signer.address)) < units) {
        setStatus({
          kind: "err",
          msg: `Not enough USDC on ${chain.name} in this wallet.`,
        });
        return;
      }

      const { txHash } = await payIntoNote(
        signer,
        { notePubkey: account.note_pubkey, viewPubkey: account.view_pubkey },
        units,
      );
      setStatus({
        kind: "ok",
        msg: `Sent ${amount} USDC to @${username}. See the proof here.`,
        url: explorerTxUrl(txHash),
      });
      reset({ amount: lockedAmount ?? "" });
    } catch (e) {
      setStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Payment failed.",
      });
    }
  });

  return (
    <Card appearance="glass" density="spacious" className="gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="type-product-panel-title text-brand-linen">
          {lockedAmount ? "Requested amount" : "Amount"}
        </h2>
        {link?.label ? (
          <span className="truncate text-sm text-brand-linen/60">
            {link.label}
          </span>
        ) : null}
      </div>

      <form className="grid gap-2" onSubmit={onSubmit}>
        <label
          className="text-sm font-semibold text-brand-linen"
          htmlFor="amount"
        >
          USDC
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            appearance="glass"
            id="amount"
            className="min-h-11 flex-1"
            inputMode="decimal"
            placeholder="5.00"
            readOnly={Boolean(lockedAmount)}
            aria-readonly={Boolean(lockedAmount)}
            {...register("amount")}
          />
          {address ? (
            <Button
              // variant="glass"
              className="min-h-11"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting && (
                <Loader
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              )}
              {isSubmitting ? "Paying…" : "Pay"}
            </Button>
          ) : (
            <Button
              className="min-h-11"
              type="button"
              onClick={connect}
              disabled={connecting}
            >
              {connecting && (
                <Loader
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              )}
              {connecting ? "Connecting…" : "Connect wallet"}
            </Button>
          )}
        </div>
        <span className="text-xs text-brand-linen/55">
          {address
            ? `Paying from ${address.slice(0, 6)}…${address.slice(-4)} on ${chain.name}. You need USDC plus a little MON for gas.`
            : `Pay with any EVM wallet (MetaMask, Rabby…) on ${chain.name}.`}
        </span>
        <ToastFeedback
          message={walletError}
          variant="error"
          toastId="payer-wallet-error"
        />
        <ToastFeedback
          message={errors.amount?.message}
          variant="error"
          toastId="payment-amount-error"
        />
        <ToastFeedback
          message={status?.msg}
          content={
            status?.kind === "ok" && status.url
              ? (() => {
                  const [before, after] = status.msg.split("here");
                  return (
                    <span>
                      {before}
                      <a
                        href={status.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View transaction in the Monad explorer"
                        className="underline underline-offset-2"
                      >
                        here
                      </a>
                      {after}
                    </span>
                  );
                })()
              : undefined
          }
          variant={status?.kind === "ok" ? "success" : "error"}
          toastId="payment-status"
        />
      </form>
    </Card>
  );
}
