// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  invalidate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: "0xalice",
    accountUnlocked: true,
    getSigner: vi.fn(),
  }),
}));
vi.mock("../src/trpc/client", () => ({
  api: { requests: { paymentStatus: { query: mocks.status } } },
}));
const utils = {
  requests: {
    get: { invalidate: mocks.invalidate },
    pendingCount: { invalidate: mocks.invalidate },
    listReceived: { invalidate: mocks.invalidate },
    listSent: { invalidate: mocks.invalidate },
  },
};
vi.mock("../src/trpc/react", () => ({ trpc: { useUtils: () => utils } }));
const queryClient = { invalidateQueries: mocks.invalidate };
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => queryClient }));
vi.mock("../src/lib/notes", () => ({
  getAccount: vi.fn(),
  scanMyNotes: vi.fn(),
}));
vi.mock("../src/features/requests/requestProofs", () => ({
  buildPaymentSubmission: vi.fn(),
  buildMergeSubmission: vi.fn(),
  buildSplitSubmission: vi.fn(),
}));
vi.mock("../src/lib/pools", () => ({ activePool: vi.fn() }));

import { useRequestPayment } from "../src/features/requests/hooks/useRequestPayment";

const request = { id: "r", status: "pending", operationId: "op" } as never;
const operation = (phase: string, requestId = "r") => ({
  id: "op",
  requestId,
  phase,
  nextStep: 0,
  completedMerges: 0,
  txHash: "0xhash",
  updatedAt: new Date().toISOString(),
});
beforeEach(() => {
  vi.useFakeTimers();
  mocks.status.mockReset();
  mocks.invalidate.mockClear();
});
afterEach(() => vi.useRealTimers());
describe("payment status polling", () => {
  it("restores an existing payment, polls to confirmation, and stops", async () => {
    mocks.status
      .mockResolvedValueOnce(operation("submitted"))
      .mockResolvedValueOnce(operation("needsReconciliation"))
      .mockResolvedValueOnce(operation("confirmed"));
    const { result, unmount } = renderHook(() => useRequestPayment(request));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.operation?.phase).toBe("submitted");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(result.current.operation?.phase).toBe("confirmed");
    expect(mocks.invalidate).toHaveBeenCalled();
    const calls = mocks.status.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(mocks.status).toHaveBeenCalledTimes(calls);
    unmount();
  });
  it("keeps checking after a temporary status error", async () => {
    mocks.status
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(operation("confirmed"));
    const { result, unmount } = renderHook(() => useRequestPayment(request));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(result.current.operation?.phase).toBe("confirmed");
    unmount();
  });
  it("does not apply an old request result after selection changes", async () => {
    let finish!: (value: unknown) => void;
    mocks.status
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(null);
    const { result, rerender, unmount } = renderHook(
      ({ selected }) => useRequestPayment(selected),
      { initialProps: { selected: request } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    rerender({
      selected: { id: "other", status: "pending", operationId: null } as never,
    });
    await act(async () => {
      finish(operation("confirmed"));
    });
    expect(result.current.operation).toBeNull();
    unmount();
  });
});
