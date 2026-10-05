"use client";

import { useEffect } from "react";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { useWallet } from "@/components/WalletProvider";
import { SIGN_IN_PATH } from "@/lib/auth-routes";

export default function DashboardPage() {
  const { address, sessionReady } = useWallet();

  useEffect(() => {
    if (!sessionReady || address) return;
    window.location.replace(SIGN_IN_PATH);
  }, [address, sessionReady]);

  if (!sessionReady || !address) {
    return <DashboardLoadingState />;
  }

  return <Dashboard />;
}

function DashboardLoadingState() {
  return (
    <div
      className="motion-safe:animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Loading your private dashboard"
    >
      <div className="mb-8 space-y-3">
        <div className="h-9 w-56 max-w-full rounded-lg bg-brand-linen/8" />
        <div className="h-4 w-80 max-w-full rounded-full bg-brand-linen/6" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="h-72 rounded-(--dash-radius) bg-(--dash-surface) ring-1 ring-(--dash-line) lg:col-span-2" />
        <div className="h-72 rounded-(--dash-radius) bg-(--dash-surface) ring-1 ring-(--dash-line)" />
        <div className="h-80 rounded-(--dash-radius) bg-(--dash-surface) ring-1 ring-(--dash-line) lg:col-span-2" />
        <div className="h-80 rounded-(--dash-radius) bg-(--dash-surface) ring-1 ring-(--dash-line)" />
      </div>

      <p className="sr-only">
        Preparing your private balance and payment history.
      </p>
    </div>
  );
}
