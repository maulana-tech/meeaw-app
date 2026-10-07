"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isProtectedRoute } from "../lib/auth-routes";
import { chain } from "../lib/chain";
import { DashboardBackground } from "./dashboard/DashboardBackground";
import { DashboardShell } from "./dashboard/DashboardShell";
import { PinDialog } from "./PinDialog";
import { RecoveryDialog } from "./RecoveryDialog";
import { UsernameModal } from "./UsernameModal";
import { StickyBanner } from "./ui/sticky-banner";
import { useWallet } from "./WalletProvider";

export function AppShell({ children }: { children: ReactNode }) {
  const {
    usernameModalOpen,
    closeUsernameModal,
    pinModalOpen,
    pinMode,
    pinSubmitting,
    pinError,
    submitPin,
    closePinModal,
    recoveryModal,
    recoveryBusy,
    recoveryError,
    passkeySupported,
    chooseRecovery,
    unlockWithPasskey,
    closeRecoveryModal,
  } = useWallet();
  const pathname = usePathname();
  const isPay = pathname.startsWith("/pay");
  const protectedRoute = isProtectedRoute(pathname);

  const networkBanner =
    protectedRoute && chain.testnet ? (
      <StickyBanner
        className="z-[80] min-h-10 border-b border-brand-linen/30 bg-brand-obsidian-secondary px-12 py-2 text-center text-sm font-medium text-brand-linen"
        hideOnScroll={false}
      >
        <p role="status" aria-label="Network status">
          Mawee is running on {chain.name}. Balances are test funds with no real
          value.
        </p>
      </StickyBanner>
    ) : null;

  const usernameModal = (
    <UsernameModal open={usernameModalOpen} onClose={closeUsernameModal} />
  );
  const pinModal = (
    <PinDialog
      open={pinModalOpen}
      mode={pinMode}
      submitting={pinSubmitting}
      error={pinError}
      onSubmit={submitPin}
      onClose={closePinModal}
    />
  );
  const recoveryDialog = (
    <RecoveryDialog
      modal={recoveryModal}
      busy={recoveryBusy}
      error={recoveryError}
      passkeySupported={passkeySupported}
      onChoose={(method) => void chooseRecovery(method)}
      onUnlock={() => void unlockWithPasskey()}
      onClose={closeRecoveryModal}
    />
  );

  if (pathname === "/" || protectedRoute) {
    if (pathname !== "/") {
      return (
        <div className="theme-product contents" data-product-theme="">
          {networkBanner}
          <div className="block w-full m-0 p-0">{children}</div>
          {usernameModal}
          {pinModal}
          {recoveryDialog}
        </div>
      );
    }

    return (
      <>
        {networkBanner}
        <div className="block w-full m-0 p-0">{children}</div>
        {usernameModal}
        {pinModal}
        {recoveryDialog}
      </>
    );
  }

  if (pathname === "/verify") {
    return (
      <div
        className="theme-product min-h-svh bg-(--dash-bg) text-(--dash-fg)"
        data-product-theme=""
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
          <header className="mb-6">
            <Link
              href="/"
              aria-label="Mawee home"
              className="font-heading text-3xl font-bold tracking-tight"
            >
              mawee
            </Link>
          </header>
          {children}
        </div>
      </div>
    );
  }
  if (isPay) {
    return (
      <div className="theme-product contents" data-product-theme="">
        <DashboardBackground>
          <DashboardShell contentClassName="flex min-h-svh max-w-3xl flex-col">
            <header className="mb-0 flex min-w-0 items-center justify-center">
              <Link href="/" aria-label="Mawee home">
                <Image
                  src="/assets/mawee-white.svg"
                  alt="Mawee"
                  width={40}
                  height={40}
                  className="size-16"
                />
              </Link>
            </header>
            <div className="grid flex-1 content-center gap-5 py-8">
              {children}
            </div>
          </DashboardShell>
        </DashboardBackground>
      </div>
    );
  }

  return (
    <div className="theme-product contents" data-product-theme="">
      {children}
    </div>
  );
}
