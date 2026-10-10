"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TransferRecord } from "../../features/transfers/types";
import { activePoolFor, type PoolDescriptor } from "../../lib/pools";
import { api } from "../../trpc/client";
import { useWallet } from "../WalletProvider";
import { dashButtonSecondary } from "./styles";

export function SendAusdAction({
  onReady,
}: {
  onReady: (pool: PoolDescriptor, pending: TransferRecord | null) => void;
}) {
  const wallet = useWallet();
  const pool = activePoolFor("AUSD");
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<{
    identity: string;
    message: string;
  } | null>(null);
  const identity = `${wallet.address}:${wallet.username}:${wallet.accountUnlocked}:${pool?.scope}`;
  const session = useRef(identity);
  const mounted = useRef(true);
  const busy = useRef(false);
  session.current = identity;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (
    !pool ||
    !wallet.username ||
    !(pool.transferCapable ?? pool.requestCapable)
  )
    return null;
  async function begin() {
    if (busy.current || !pool) return;
    if (!wallet.accountUnlocked) {
      wallet.promptUnlock();
      return;
    }
    busy.current = true;
    setWorking(true);
    setFailure(null);
    const at = session.current;
    try {
      const pending = await api.transfers.pending.query({ pool: pool.scope });
      if (mounted.current && session.current === at) onReady(pool, pending);
    } catch {
      if (mounted.current && session.current === at)
        setFailure({
          identity: at,
          message:
            "Pending payments could not be checked. Reconnect and try again.",
        });
    } finally {
      busy.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  return (
    <div className="max-w-sm">
      <button
        type="button"
        className={`${dashButtonSecondary} min-h-11`}
        disabled={working}
        onClick={() => void begin()}
      >
        <Send aria-hidden="true" />
        {working ? "Checking payments…" : "Send AUSD"}
      </button>
      {failure?.identity === identity && (
        <p role="alert" className="mt-2 text-sm leading-5 text-(--dash-ash)">
          {failure.message}
        </p>
      )}
    </div>
  );
}
