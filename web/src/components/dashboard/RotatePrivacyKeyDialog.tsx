"use client";
import { useEffect, useId, useState } from "react";
import type { RotationReview } from "../../features/privacyKeys/rotationController";
import { usePrivacyKeyRotation } from "../../features/privacyKeys/usePrivacyKeyRotation";
import { SponsorshipNotice } from "../../features/sponsorship/SponsorshipNotice";
import { useSponsorship } from "../../features/sponsorship/useSponsorship";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { useWallet } from "../WalletProvider";
import { dashButtonPrimary } from "./styles";

export function RotatePrivacyKeyDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const wallet = useWallet(),
    rotation = usePrivacyKeyRotation();
  return (
    <RotatePrivacyKeyDialogView
      open={open}
      onOpenChange={onOpenChange}
      wallet={wallet}
      rotation={rotation}
    />
  );
}
export function RotatePrivacyKeyDialogView({
  open,
  onOpenChange,
  wallet,
  rotation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wallet: Pick<
    ReturnType<typeof useWallet>,
    "recoveryMethod" | "username" | "accountUnlocked"
  >;
  rotation: ReturnType<typeof usePrivacyKeyRotation>;
}) {
  const pinId = useId();
  const sponsorship = useSponsorship({ enabled: open });
  const [pin, setPin] = useState(""),
    [review, setReview] = useState<RotationReview | null>(null);
  useEffect(() => {
    if (!open) {
      setPin("");
      setReview(null);
    }
  }, [open]);
  const operation = rotation.operation ?? rotation.state?.pending;
  const pending = Boolean(
    operation &&
      operation.phase !== "confirmed" &&
      operation.phase !== "failed",
  );
  const close = async () => {
    try {
      await rotation.clear();
    } catch {
      /* Accepted work remains available when the dialog reopens. */
    }
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) void close();
        else onOpenChange(true);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rotate privacy key</DialogTitle>
          <DialogDescription>
            New incoming payments will use a new key. Your existing payments
            stay accessible with the same recovery.
          </DialogDescription>
        </DialogHeader>
        <SponsorshipNotice
          status={sponsorship.status}
          loading={sponsorship.loading}
          pause={operation?.sponsorshipPause}
          captured={Boolean(operation?.sponsorshipAction)}
          onRefresh={() => {
            void sponsorship.refresh();
          }}
        />
        <div className="space-y-4 text-sm leading-6">
          <p>No private funds are moved during rotation.</p>
          <p className="text-(--dash-ash)">
            This is routine rotation. It does not revoke old keys or replace
            your recovery.
          </p>
          {!review &&
            (!operation || rotation.needsUnlock) &&
            wallet.recoveryMethod === "pin" && (
              <div className="space-y-2">
                <label htmlFor={pinId}>Current recovery PIN</label>
                <Input
                  id={pinId}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={6}
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  disabled={rotation.isWorking}
                />
              </div>
            )}
          {review && (
            <div className="space-y-2">
              <p>
                Key version {review.from + 1} becomes version {review.to + 1}.
              </p>
              <p>
                New key fingerprint:{" "}
                <span className="font-medium">
                  {review.newKeys.notePubkey.slice(2, 10)} ·{" "}
                  {review.newKeys.viewPubkey.slice(2, 10)}
                </span>
              </p>
              <p className="text-(--dash-ash)">
                Your wallet will request two signatures. If gas is not
                sponsored, it will also ask you to approve a transaction.
              </p>
            </div>
          )}
          {operation && (
            <p role="status">
              {operation.phase === "confirmed"
                ? "Privacy key rotated. New incoming payments use the new key."
                : operation.phase === "failed"
                  ? "Rotation was not completed. Check your existing key before retrying."
                  : operation.phase === "confirming"
                    ? "The new key is confirmed. Account details are still synchronizing."
                    : "Your rotation is pending. Check its status before starting another."}
            </p>
          )}
          {rotation.error && (
            <p role="alert" className="text-red-400">
              {rotation.error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => void close()}>
            Close
          </Button>
          {rotation.needsUnlock ? (
            <Button
              disabled={
                rotation.isWorking ||
                (wallet.recoveryMethod === "pin" && pin.length !== 6)
              }
              onClick={() =>
                void rotation
                  .unlockUpdatedKeys(pin || undefined)
                  .then(() => setPin(""))
                  .catch(() => {})
              }
            >
              Unlock updated keys
            </Button>
          ) : pending ? (
            <Button
              disabled={rotation.isWorking}
              onClick={() => void rotation.check().catch(() => {})}
            >
              Check status
            </Button>
          ) : review && !operation ? (
            <Button
              className={dashButtonPrimary}
              disabled={rotation.isWorking}
              onClick={() => void rotation.confirm().catch(() => {})}
            >
              {rotation.isWorking
                ? "Updating privacy key…"
                : "Confirm rotation"}
            </Button>
          ) : !operation ? (
            <Button
              className={dashButtonPrimary}
              disabled={
                rotation.isWorking ||
                !wallet.accountUnlocked ||
                !wallet.username ||
                (wallet.recoveryMethod === "pin" && pin.length !== 6)
              }
              onClick={() =>
                void rotation
                  .prepare(pin || undefined)
                  .then((data) => {
                    setReview(data);
                    setPin("");
                  })
                  .catch(() => {})
              }
            >
              {rotation.isWorking ? "Checking recovery…" : "Review rotation"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
