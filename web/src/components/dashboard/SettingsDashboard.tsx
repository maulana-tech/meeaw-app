"use client";

import { Loader, LockKeyhole, LogOut } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useChangeRecoveryPin } from "../../features/recovery/hooks/useChangeRecoveryPin";
import { trpc } from "../../trpc/react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useWallet } from "../WalletProvider";
import { ChangeRecoveryPinDialog } from "./ChangeRecoveryPinDialog";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { dashButtonPrimary, dashCell, dashLedger } from "./styles";

export function SettingsDashboard() {
  const { username, disconnect, recoveryMethod, openUsernameModal } =
    useWallet();
  const [changePinOpen, setChangePinOpen] = useState(false);
  const { changeRecoveryPin, validateCurrentPin, isChanging } =
    useChangeRecoveryPin();
  const escrowQuery = trpc.wallets.getEscrow.useQuery();
  const passkeyQuery = trpc.wallets.getPasskey.useQuery();
  const passkeyProtected =
    recoveryMethod === "passkey" || Boolean(passkeyQuery.data);

  return (
    <>
      <DashboardPageHeader
        title="Settings"
        description="The essentials for your Mawee account, explained without the crypto jargon."
      />

      <div className={`${dashLedger} max-w-3xl`}>
        <IdentityTile username={username} onClaim={openUsernameModal} />
        <RecoveryTile
          method={passkeyProtected ? "passkey" : "pin"}
          protectedRecovery={passkeyProtected || Boolean(escrowQuery.data)}
          loading={escrowQuery.isLoading || passkeyQuery.isLoading}
          onChangePin={() => setChangePinOpen(true)}
        />
        <SessionTile onSignOut={disconnect} />
      </div>

      <ChangeRecoveryPinDialog
        open={changePinOpen}
        onOpenChange={setChangePinOpen}
        onSubmit={changeRecoveryPin}
        onValidateCurrentPin={validateCurrentPin}
        isChanging={isChanging}
        onSuccess={() => {
          void escrowQuery.refetch();
          toast.success("Recovery PIN changed");
        }}
      />
    </>
  );
}

function SettingsRow({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className={`${dashCell} p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="dashboard-tile-title">{title}</h2>
        {aside}
      </div>
      <div className="mt-3 max-w-xl text-sm leading-6 text-(--dash-ash)">
        {description}
      </div>
      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

function IdentityTile({
  username,
  onClaim,
}: {
  username: string | null;
  onClaim: () => void;
}) {
  return (
    <SettingsRow
      title="Account handle"
      description="The public name people use to pay you. It does not reveal your balance or payment history."
    >
      {username ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-(--dash-radius-sm) border border-(--dash-line) px-3 py-1.5 font-mono text-sm">
            @{username}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-brand-linen/50">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            Permanent, cannot be renamed
          </span>
        </div>
      ) : (
        <button type="button" className={dashButtonPrimary} onClick={onClaim}>
          Claim username
        </button>
      )}
    </SettingsRow>
  );
}

function RecoveryTile({
  method,
  protectedRecovery,
  loading,
  onChangePin,
}: {
  method: "passkey" | "pin";
  protectedRecovery: boolean;
  loading: boolean;
  onChangePin: () => void;
}) {
  return (
    <SettingsRow
      title={method === "passkey" ? "Recovery passkey" : "Recovery PIN"}
      aside={
        loading ? (
          <Badge appearance="glass" className="gap-1.5">
            <Loader className="size-3 animate-spin" aria-hidden="true" />
            Checking
          </Badge>
        ) : protectedRecovery ? (
          <Badge className="gap-1.5 border border-(--dash-line) bg-transparent text-(--dash-fg)">
            <span
              className="size-1.5 rounded-full bg-(--dash-accent)"
              aria-hidden="true"
            />
            Ready
          </Badge>
        ) : (
          <Badge variant="destructive" className="bg-red-300/15 text-red-100">
            Needs attention
          </Badge>
        )
      }
      description={
        <>
          <p className="font-medium text-(--dash-fg)">
            {loading
              ? "Checking your recovery setup…"
              : method === "passkey"
                ? "Protected by your passkey"
                : protectedRecovery
                  ? "Protected by your recovery PIN"
                  : "Set up your recovery PIN"}
          </p>
          <p>
            {method === "passkey"
              ? "Your private keys are derived from your passkey on each device. Use the same synced passkey anywhere — Mawee stores nothing secret."
              : protectedRecovery
                ? "Your PIN lets you restore access on another device. Mawee never sees or stores the PIN itself."
                : "Without a recovery PIN, moving to a new device could leave you unable to access your funds."}
          </p>
        </>
      }
    >
      {method === "pin" && protectedRecovery && !loading ? (
        <Button variant="glass" onClick={onChangePin}>
          Change PIN
        </Button>
      ) : null}
    </SettingsRow>
  );
}

function SessionTile({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function confirmSignOut() {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
      setSignOutOpen(false);
    }
  }

  return (
    <>
      <SettingsRow
        title="Your session"
        description="Signing out removes access from this device. It does not delete your account, payment history, or funds."
      >
        <Button variant="glass" onClick={() => setSignOutOpen(true)}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out on this device
        </Button>
      </SettingsRow>

      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent appearance="linen" size="sm">
          <DialogHeader>
            <DialogTitle>Sign out of Mawee?</DialogTitle>
            <DialogDescription>
              This removes access from this device. Your account and funds stay
              safe, and you can return with your passkey or recovery PIN.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" disabled={signingOut} />}
            >
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              onClick={confirmSignOut}
              disabled={signingOut}
              aria-busy={signingOut}
            >
              {signingOut ? (
                <Loader className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <LogOut className="size-4" aria-hidden="true" />
              )}
              {signingOut ? "Signing out…" : "Sign out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
