"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "../../../components/WalletProvider";
import { getAccount } from "../../../lib/notes";
import { findPool, listPools } from "../../../lib/pools";
import { api } from "../../../trpc/client";
import { watchPaymentStatus } from "../paymentStatusMonitor";
import { openRequest } from "../requestCrypto";
import type { PaymentRequest, RequestPage } from "../types";

const EMPTY: PaymentRequest[] = [];
export type RequestRow = {
  record: PaymentRequest;
  amount: bigint | null;
  note: string | null;
  unreadable: boolean;
};
export function useRequests(direction: "received" | "sent") {
  const { address, accountUnlocked, promptUnlock } = useWallet();
  const scope = listPools()
    .map((p) => p.scope)
    .join(",");
  const [cursor, setCursor] = useState<string | undefined>(undefined),
    [previous, setPrevious] = useState<string[]>([]),
    [rows, setRows] = useState<RequestRow[]>([]),
    [owner, setOwner] = useState("");
  const input = cursor ? { cursor } : {};
  const currentOwner = `${address.toLowerCase()}|${scope}`;
  const query = useQuery({
    queryKey: ["payment-requests", currentOwner, direction, cursor ?? "first"],
    enabled: Boolean(address),
    refetchInterval: 30_000,
    queryFn: async () =>
      (await (direction === "received"
        ? api.requests.listReceived.query(input)
        : api.requests.listSent.query(input))) as unknown as RequestPage,
  });
  const count = useQuery<number>({
    queryKey: ["payment-request-count", currentOwner],
    enabled: Boolean(address),
    refetchInterval: 30_000,
    queryFn: () => api.requests.pendingCount.query(),
  });
  const data = query.data;
  const records = data?.items ?? EMPTY;
  const seen = useRef("");
  const pendingKey = records
    .filter((r) => r.status === "pending" && r.operationId)
    .map((r) => r.id)
    .sort()
    .join(",");
  const refetchList = query.refetch,
    refetchCount = count.refetch;
  useEffect(() => {
    if (!address || !pendingKey) return;
    const completed = new Set<string>();
    const stops = pendingKey.split(",").map((id) =>
      watchPaymentStatus(address, id, (update) => {
        const phase = update.operation?.phase;
        if (
          (phase === "confirmed" || phase === "failed") &&
          !completed.has(id)
        ) {
          completed.add(id);
          window.dispatchEvent(new Event("mawee:balance-changed"));
          void refetchList();
          void refetchCount();
        }
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [address, pendingKey, refetchList, refetchCount]);
  useEffect(() => {
    if (!address) {
      setRows([]);
      setOwner("");
      return;
    }
    // Hide old-account plaintext synchronously by tagging every decrypted page with its wallet.
    if (!accountUnlocked) {
      setRows([]);
      setOwner(currentOwner);
      return;
    }
    const account = getAccount();
    if (!account) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setRows([]);
    seen.current = "";
    void Promise.all(
      records.map(async (record): Promise<RequestRow> => {
        try {
          const pool = findPool(record.pool);
          if (!pool) throw new Error("Unsupported pool.");
          const payload = await openRequest(
            {
              version: record.version,
              id: record.id,
              pool: record.pool,
              requester: record.requester,
              addressee: record.addressee,
              createdAt: record.createdAt,
              recipientCommitment: record.recipientCommitment,
              requesterEnvelope: record.requesterEnvelope,
              addresseeEnvelope: record.addresseeEnvelope,
              signature: record.signature,
            },
            account,
            pool,
          );
          return {
            record,
            amount: BigInt(payload.amount),
            note: payload.note,
            unreadable: false,
          };
        } catch {
          return { record, amount: null, note: null, unreadable: true };
        }
      }),
    ).then((next) => {
      if (!cancelled) {
        setRows(next);
        setOwner(currentOwner);
        seen.current = `${currentOwner}:${direction}:${records.map((x) => `${x.id}:${x.revision}`).join(",")}`;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [address, accountUnlocked, currentOwner, direction, records]);
  const visible = owner === currentOwner && accountUnlocked ? rows : [];
  return {
    rows: visible,
    count: count.data ?? 0,
    isLoading:
      query.isLoading ||
      Boolean(
        address &&
          accountUnlocked &&
          records.length &&
          seen.current !==
            `${currentOwner}:${direction}:${records.map((x) => `${x.id}:${x.revision}`).join(",")}`,
      ),
    error: query.error,
    hasNext: Boolean(data?.nextCursor),
    loadMore: () => {
      if (data?.nextCursor) {
        setPrevious((v) => [...v, cursor ?? ""]);
        setCursor(data.nextCursor);
      }
    },
    hasPrevious: previous.length > 0,
    previousPage: () => {
      const p = [...previous],
        last = p.pop();
      setPrevious(p);
      setCursor(last || undefined);
    },
    refresh: () => {
      void query.refetch();
      void count.refetch();
    },
    promptUnlock,
  };
}
