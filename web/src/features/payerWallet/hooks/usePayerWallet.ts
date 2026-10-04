"use client";

import { useCallback, useState } from "react";
import { connectPayerWallet } from "../injected";

export function usePayerWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    try {
      setAddress(await connectPayerWallet());
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

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  return { address, connecting, error, connect, disconnect };
}
