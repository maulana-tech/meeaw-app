// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  address: "0x1234567890123456789012345678901234567890",
  pendingCountQuery: vi.fn(),
}));

vi.mock("../src/components/WalletProvider", () => ({
  useOptionalWallet:()=>({address:mocks.address}),
  useWallet: () => ({
    address: mocks.address,
  }),
}));

vi.mock("../src/trpc/client", () => ({
  api: {
    requests: {
      pendingCount: {
        query: mocks.pendingCountQuery,
      },
    },
  },
}));

import { usePendingRequestsCount } from "../src/features/requests/hooks/usePendingRequestsCount";

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("usePendingRequestsCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.address = "0x1234567890123456789012345678901234567890";
    mocks.pendingCountQuery.mockResolvedValue(4);
  });

  it("fetches the pending requests count when an address is connected", async () => {
    const { result } = renderHook(() => usePendingRequestsCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.count).toBe(4));
    expect(mocks.pendingCountQuery).toHaveBeenCalled();
  });

  it("returns 0 if user has no address connected", async () => {
    mocks.address = "";
    const { result } = renderHook(() => usePendingRequestsCount(), {
      wrapper: createWrapper(),
    });

    expect(result.current.count).toBe(0);
    expect(mocks.pendingCountQuery).not.toHaveBeenCalled();
  });

  it("refetches when mawee:request-changed or mawee:balance-changed is dispatched", async () => {
    const { result } = renderHook(() => usePendingRequestsCount(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.count).toBe(4));
    expect(mocks.pendingCountQuery).toHaveBeenCalledTimes(1);

    mocks.pendingCountQuery.mockResolvedValue(2);
    act(() => {
      window.dispatchEvent(new Event("mawee:request-changed"));
    });

    await waitFor(() => expect(result.current.count).toBe(2));
    expect(mocks.pendingCountQuery).toHaveBeenCalledTimes(2);
  });
});
