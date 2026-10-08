"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toHex } from "viem";
import { useWallet } from "../../components/WalletProvider";
import { nullifier, toBE32 } from "../../lib/crypto";
import { getAccount, type MyNote } from "../../lib/notes";
import { activePool, listPools, resolvePool } from "../../lib/pools";
import { api } from "../../trpc/client";
import { accountForNote } from "../privacyKeys/keyRing";
import { getPrivacyKeyring } from "../privacyKeys/session";
import { openTransfer } from "../transfers/transferCrypto";
import type { TransferPayload, TransferRecord } from "../transfers/types";
import { buildActivityRows } from "./activityRows";
import type { PaymentActivityEvidence } from "./activityTypes";

export function usePaymentActivity(notes: readonly MyNote[]) {
  const wallet = useWallet(),
    pool = activePool(),
    identity = `${wallet.address.toLowerCase()}:${wallet.accountUnlocked}`;
  const records = useQuery({
    queryKey: ["activity-transfer-records", wallet.address.toLowerCase()],
    enabled: Boolean(wallet.address),
    refetchInterval: 15_000,
    queryFn: async () => {
      const rows: TransferRecord[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 120; page++) {
        const result = await api.transfers.list.query({
          direction: "all",
          cursor,
        });
        rows.push(...result.items);
        if (!result.nextCursor) return rows;
        cursor = result.nextCursor;
      }
      throw new Error("Transfer history is still loading.");
    },
  });
  const evidence = useQuery({
    queryKey: ["pool-activity-evidence", pool.scope],
    enabled: Boolean(wallet.address) && wallet.accountUnlocked,
    refetchInterval: 30_000,
    queryFn: async () => {
      const rows: PaymentActivityEvidence[] = [];
      let unavailable = false;
      for (const selected of listPools()) {
        let cursor: string | undefined;
        for (let page = 0; page < 120; page++) {
          const result = await api.deposits.activity.query({
            pool: selected.scope,
            cursor,
          });
          rows.push(...result.items);
          unavailable ||= result.unavailable;
          if (result.unavailable || !result.nextCursor) break;
          cursor = result.nextCursor;
          if (page === 119) unavailable = true;
        }
      }
      return { rows, unavailable };
    },
  });
  const [decrypted, setDecrypted] = useState<{
    identity: string;
    payloads: Map<string, TransferPayload>;
    notes: readonly MyNote[];
  }>({ identity: "", payloads: new Map(), notes: [] });
  useEffect(() => {
    let cancelled = false;
    const account = getAccount();
    const ring = getPrivacyKeyring();
    if (!wallet.accountUnlocked || !account) {
      setDecrypted({ identity: "", payloads: new Map(), notes: [] });
      return;
    }
    void (async () => {
      const payloads = new Map<string, TransferPayload>();
      for (const r of records.data ?? [])
        try {
          payloads.set(
            r.id,
            await openTransfer(r, account, resolvePool(r.pool)),
          );
        } catch {
          /* Locked or historical unavailable keys do not fabricate a zero amount. */
        }
      const owned = await Promise.all(
        notes.map(async (n) => ({
          ...n,
          nullifierHex:
            n.nullifierHex ??
            toHex(
              toBE32(
                await nullifier(
                  (ring ? accountForNote(ring, n) : account).ownerSecret,
                  n.leafIndex,
                ),
              ),
            ),
        })),
      );
      if (!cancelled && getAccount() === account)
        setDecrypted({ identity, payloads, notes: owned });
    })();
    return () => {
      cancelled = true;
    };
  }, [identity, records.data, notes, wallet.accountUnlocked]);
  const rows = useMemo(
    () =>
      wallet.accountUnlocked && decrypted.identity === identity
        ? buildActivityRows({
            notes: decrypted.notes,
            transfers: records.data ?? [],
            payloads: decrypted.payloads,
            evidence: evidence.data?.rows ?? [],
            viewer: wallet.address as `0x${string}`,
          })
        : [],
    [
      wallet.accountUnlocked,
      wallet.address,
      decrypted,
      identity,
      records.data,
      evidence.data,
    ],
  );
  const refetch = records.refetch,
    evidenceRefetch = evidence.refetch;
  useEffect(() => {
    const refresh = () => {
      void refetch();
      void evidenceRefetch();
    };
    window.addEventListener("mawee:balance-changed", refresh);
    window.addEventListener("mawee:transfers-changed", refresh);
    return () => {
      window.removeEventListener("mawee:balance-changed", refresh);
      window.removeEventListener("mawee:transfers-changed", refresh);
    };
  }, [refetch, evidenceRefetch]);
  return {
    rows,
    loading: records.isLoading || evidence.isLoading,
    incomplete: Boolean(
      evidence.data?.unavailable || rows.some((r) => r.kind === "unclassified"),
    ),
    error: records.error ?? evidence.error,
    records: records.data ?? [],
  };
}
