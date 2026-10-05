"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useOptionalWallet } from "../../../components/WalletProvider";
import { api } from "../../../trpc/client";

export function usePendingRequestsCount() {
  const wallet = useOptionalWallet();
  const address = wallet?.address;
  const query = useQuery<number>({
    queryKey: ["payment-request-count", address?.toLowerCase() ?? ""],
    enabled: Boolean(address),
    refetchInterval: 30_000,
    queryFn: () => api.requests.pendingCount.query(),
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleUpdate = () => {
      void query.refetch();
    };
    window.addEventListener("mawee:balance-changed", handleUpdate);
    window.addEventListener("mawee:request-changed", handleUpdate);
    return () => {
      window.removeEventListener("mawee:balance-changed", handleUpdate);
      window.removeEventListener("mawee:request-changed", handleUpdate);
    };
  }, [query.refetch]);

  const count = typeof query.data === "number" ? query.data : 0;

  return {
    count,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
