"use client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useWallet } from "../../../components/WalletProvider";
import { api } from "../../../trpc/client";
export function useTransfers(direction: "sent" | "received" | "all" = "all") {
  const { address } = useWallet(),
    owner = `${address.toLowerCase()}:${direction}`;
  const [page, setPage] = useState<{
    owner: string;
    cursor: string | undefined;
  }>({ owner: "", cursor: undefined });
  const cursor = page.owner === owner ? page.cursor : undefined;
  const query = useQuery({
    queryKey: [
      "direct-transfers",
      address.toLowerCase(),
      direction,
      cursor ?? "first",
    ],
    enabled: Boolean(address),
    queryFn: () => api.transfers.list.query({ direction, cursor }),
    refetchInterval: 15_000,
  });
  const pending = useQuery({
    queryKey: ["pending-direct-transfer", address.toLowerCase()],
    enabled: Boolean(address),
    queryFn: () => api.transfers.pending.query(),
    refetchInterval: 5000,
  });
  const refetch = query.refetch,
    pendingRefetch = pending.refetch;
  useEffect(() => {
    const update = () => {
      void refetch();
      void pendingRefetch();
    };
    window.addEventListener("mawee:transfers-changed", update);
    return () => window.removeEventListener("mawee:transfers-changed", update);
  }, [refetch, pendingRefetch]);
  return {
    records: query.data?.items ?? [],
    pending: pending.data ?? null,
    loading: query.isLoading,
    error: query.error,
    nextCursor: query.data?.nextCursor ?? null,
    nextPage: () =>
      setPage({ owner, cursor: query.data?.nextCursor ?? undefined }),
    firstPage: () => setPage({ owner, cursor: undefined }),
    hasPrevious: Boolean(cursor),
    refetch,
  };
}
