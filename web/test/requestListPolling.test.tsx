// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  status: vi.fn(),
  count: vi.fn().mockResolvedValue(1),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    requests: {
      listReceived: { query: mocks.list },
      pendingCount: { query: mocks.count },
      paymentStatus: { query: mocks.status },
    },
  },
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: "0xalice",
    accountUnlocked: true,
    promptUnlock: vi.fn(),
  }),
}));
vi.mock("../src/lib/pools", () => ({
  listPools: () => [{ scope: "pool" }],
  findPool: () => ({ scope: "pool" }),
}));
vi.mock("../src/lib/notes", () => ({ getAccount: () => ({}) }));
vi.mock("../src/features/requests/requestCrypto", () => ({
  openRequest: async () => ({ amount: "2000000", note: "Test" }),
}));

import { useRequests } from "../src/features/requests/hooks/useRequests";

afterEach(() => vi.useRealTimers());
it("reconciles the list without an open payment modal and displays confirmation", async () => {
  vi.useFakeTimers();
  let paid = false;
  mocks.list.mockImplementation(async () => ({
    items: [
      {
        id: "r",
        pool: "pool",
        status: paid ? "paid" : "pending",
        operationId: "op",
        revision: paid ? 1 : 0,
      },
    ],
    nextCursor: null,
  }));
  mocks.status.mockImplementation(async () => {
    paid = true;
    return { requestId: "r", phase: "confirmed" };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, unmount } = renderHook(() => useRequests("received"), {
    wrapper,
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(mocks.status).toHaveBeenCalledWith({ id: "r" });
  expect(result.current.rows[0]?.record.status).toBe("paid");
  const calls = mocks.status.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6_000);
  });
  expect(mocks.status).toHaveBeenCalledTimes(calls);
  unmount();
  client.clear();
});
