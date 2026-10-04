"use client";

import { Check, Copy, ExternalLink, Loader } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  type AccountStatus,
  accountStatus,
  gasFaucetUrl,
  mintTestUsdc,
  usdcMintable,
} from "../../lib/chain";
import { fromBaseUnits, toBaseUnits, USDC_DECIMALS } from "../../lib/crypto";
import { payIntoNote } from "../../lib/deposit";
import { accountPubkeys, getAccount } from "../../lib/notes";
import { useGasless } from "../../lib/useGasless";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { linenInsetClass } from "../ui/glass";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useWallet } from "../WalletProvider";

const TEST_MINT_UNITS = 100n * 10n ** BigInt(USDC_DECIMALS);

/**
 * Funds arrive in the user's Mawee wallet (a Privy embedded wallet on Monad)
 * and are then shielded into a private note. On testnet the dialog can also
 * mint MockUSDC and points at the MON gas faucet.
 */
export function AddFundsDialog({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void | Promise<void>;
}) {
  const { address, getSigner } = useWallet();
  const gasless = useGasless();
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<"mint" | "shield" | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    if (address) setStatus(await accountStatus(address).catch(() => null));
  }, [address]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const copy = () => {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const mint = async () => {
    setBusy("mint");
    try {
      await mintTestUsdc(await getSigner(), TEST_MINT_UNITS);
      toast.success(`Minted ${fromBaseUnits(TEST_MINT_UNITS)} test USDC`);
      await refresh();
    } catch (error) {
      toast.error("Could not mint test USDC", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const shield = async (event: React.FormEvent) => {
    event.preventDefault();
    const acct = getAccount();
    if (!acct) {
      toast.error("Unlock your account with your PIN first.");
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(amount) || toBaseUnits(amount) <= 0n) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setBusy("shield");
    try {
      const units = toBaseUnits(amount);
      await payIntoNote(await getSigner(), await accountPubkeys(acct), units);
      toast.success(`Added ${amount} USDC to your private balance`);
      setAmount("");
      await refresh();
      await onComplete?.();
    } catch (error) {
      toast.error("Deposit failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent appearance="linen" size="md">
        <DialogHeader>
          <DialogTitle>Add funds</DialogTitle>
          <DialogDescription>
            Send USDC on Monad to your Mawee wallet, then move it into your
            private balance.
          </DialogDescription>
        </DialogHeader>

        <div className={`${linenInsetClass} grid gap-3 p-4`}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-foreground/60">
              Your Mawee wallet
            </span>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1.5 font-mono text-sm text-foreground hover:text-foreground/80"
              title="Copy address"
            >
              {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—"}
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-foreground/12 pt-3 text-sm">
            <div>
              <span className="block text-foreground/60">USDC</span>
              <span className="font-mono text-lg text-foreground tabular-nums">
                {status ? status.usdc : "…"}
              </span>
            </div>
            {gasless === false ? (
              <div>
                <span className="block text-foreground/60">MON for gas</span>
                <span className="font-mono text-lg text-foreground tabular-nums">
                  {status ? status.gas : "…"}
                </span>
              </div>
            ) : (
              <div>
                <span className="block text-foreground/60">Network fees</span>
                <span className="text-sm text-foreground">
                  Covered by Mawee
                </span>
              </div>
            )}
          </div>
          {usdcMintable || (gasFaucetUrl && gasless === false) ? (
            <div className="flex flex-wrap gap-2 border-t border-foreground/12 pt-3">
              {usdcMintable ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={mint}
                  disabled={busy !== null}
                >
                  {busy === "mint" && (
                    <Loader
                      className="size-4 motion-safe:animate-spin"
                      aria-hidden="true"
                    />
                  )}
                  Get {fromBaseUnits(TEST_MINT_UNITS)} test USDC
                </Button>
              ) : null}
              {gasFaucetUrl && gasless === false ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={
                    <a
                      href={gasFaucetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                >
                  MON faucet
                  <ExternalLink className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        <form className="grid gap-2" onSubmit={shield}>
          <Label className="text-foreground" htmlFor="add-funds-amount">
            Move to private balance
          </Label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              appearance="linen"
              id="add-funds-amount"
              className="min-h-11 flex-1"
              inputMode="decimal"
              placeholder="25.00"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
            <Button type="submit" className="min-h-11" disabled={busy !== null}>
              {busy === "shield" && (
                <Loader
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              )}
              {busy === "shield" ? "Proving…" : "Add"}
            </Button>
          </div>
          <p className="text-xs text-foreground/60">
            A zero-knowledge proof is generated in your browser, then the USDC
            becomes a private note only you can spend.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
