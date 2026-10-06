"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useCallback, useState } from "react";
import { getAddress } from "viem";
import type { Signer } from "../../../lib/chain";
import { findEmbeddedWallet, privySigner } from "../../../lib/privy-wallet";
import { connectPayerWallet, payerSigner } from "../injected";

export type PayerSource = "privy" | "browser";

/**
 * The wallet a payer pays from: their own browser wallet, or the Privy
 * embedded wallet created when they continue with email. The Privy wallet
 * means a client with no crypto wallet can still pay a link.
 */
export function usePayerWallet() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const embedded = authenticated ? findEmbeddedWallet(wallets) : null;
  const [browserAddress, setBrowserAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      setBrowserAddress(await connectPayerWallet());
    } catch (e) {
      // EIP-1193 code 4001 = the user rejected the request; stay quiet.
      if ((e as { code?: number })?.code === 4001) return;
      const msg =
        e instanceof Error ? e.message : (e as { message?: string })?.message;
      if (msg) setError(msg);
    } finally {
      setConnecting(false);
    }
  }, []);

  const signInWithEmail = useCallback(() => {
    setError(null);
    login();
  }, [login]);

  const source: PayerSource | null = browserAddress
    ? "browser"
    : embedded
      ? "privy"
      : null;
  const address =
    browserAddress ?? (embedded ? getAddress(embedded.address) : null);

  const getSigner = useCallback(async (): Promise<Signer> => {
    if (browserAddress) return payerSigner(browserAddress);
    if (embedded) return privySigner(embedded);
    throw new Error("Choose how to pay first.");
  }, [browserAddress, embedded]);

  const disconnect = useCallback(() => {
    setBrowserAddress(null);
  }, []);

  return {
    address,
    source,
    connecting,
    // Signed in with Privy while the embedded wallet is still being created.
    preparing: authenticated && !embedded && !browserAddress,
    privyReady: ready,
    error,
    connect,
    signInWithEmail,
    getSigner,
    disconnect,
  };
}
