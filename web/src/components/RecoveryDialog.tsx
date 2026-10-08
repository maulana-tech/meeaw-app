"use client";

import { Fingerprint, KeyRound, Loader } from "lucide-react";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { linenInsetClass } from "./ui/glass";
import { ToastFeedback } from "./ui/toast-feedback";
import type { RecoveryMethod, RecoveryModal } from "./WalletProvider";

/**
 * Protects the privacy keys of a new account (passkey or PIN) and re-derives
 * them from the passkey on a new device.
 */
export function RecoveryDialog({
  modal,
  busy,
  error,
  passkeySupported,
  onChoose,
  onUnlock,
  onClose,
}: {
  modal: RecoveryModal | null;
  busy: boolean;
  error: string;
  passkeySupported: boolean;
  onChoose: (method: RecoveryMethod) => void;
  onUnlock: () => void;
  onClose: () => void;
}) {
  const choosing = modal === "choose";
  return (
    <Dialog
      open={Boolean(modal)}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent appearance="linen" size="sm" showCloseButton={!choosing}>
        <DialogHeader className="px-6 text-center">
          <DialogTitle>
            {choosing
              ? "Protect your private balance"
              : "Unlock with your passkey"}
          </DialogTitle>
          <DialogDescription className="mx-auto">
            {choosing
              ? "Your payments are encrypted to keys only you hold. Choose how to restore them on another device."
              : "Use the passkey you created for Meaw. Your keys are re-derived on this device — nothing is downloaded."}
          </DialogDescription>
        </DialogHeader>

        {choosing ? (
          <div className="grid gap-3">
            <button
              type="button"
              disabled={busy || !passkeySupported}
              onClick={() => onChoose("passkey")}
              className={`${linenInsetClass} flex min-h-20 items-center gap-4 border border-foreground/18 p-4 text-left transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-foreground/70 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-(--dash-radius-sm) bg-foreground/10 ring-1 ring-foreground/15">
                {busy ? (
                  <Loader
                    className="size-5 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Fingerprint className="size-5" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">
                  Passkey{" "}
                  <span className="text-xs font-medium text-foreground/60">
                    · recommended
                  </span>
                </span>
                <span className="mt-1 block text-xs leading-5 text-foreground/60">
                  Face ID, Touch ID or your device PIN. Your keys come from the
                  passkey itself — Meaw stores nothing secret.
                </span>
              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose("pin")}
              className={`${linenInsetClass} flex min-h-20 items-center gap-4 border border-foreground/18 p-4 text-left transition-colors hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-foreground/70 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-(--dash-radius-sm) bg-foreground/10 ring-1 ring-foreground/15">
                <KeyRound className="size-5" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-foreground">
                  6-digit PIN
                </span>
                <span className="mt-1 block text-xs leading-5 text-foreground/60">
                  Your key is encrypted with a PIN you choose and backed up.
                  Works in any browser.
                </span>
              </span>
            </button>
          </div>
        ) : (
          <Button
            className="min-h-11 w-full"
            onClick={onUnlock}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Fingerprint className="size-4" aria-hidden="true" />
            )}
            {busy ? "Waiting for passkey…" : "Unlock with passkey"}
          </Button>
        )}

        <ToastFeedback
          message={error}
          variant="error"
          toastId="recovery-error"
        />
      </DialogContent>
    </Dialog>
  );
}
