// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pay: vi.fn(), operation: null as null }));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ accountUnlocked: true, promptUnlock: vi.fn() }),
}));
vi.mock("../src/features/requests/hooks/useRequestPayment", () => ({
  useRequestPayment: () => ({
    operation: state.operation,
    working: false,
    error: null,
    pay: state.pay,
    refresh: vi.fn(),
  }),
}));
vi.mock("../src/lib/pools", () => ({
  requestPool: () => ({
    scope: "31337:0x1111111111111111111111111111111111111111",
    requestCapable: true,
    role: "active",
  }),
  findPool: () => ({
    scope: "31337:0x1111111111111111111111111111111111111111",
    role: "active",
    requestCapable: true,
    chainId: 31337,
    address: "0x1111111111111111111111111111111111111111",
    deployBlock: 0,
    token: "0x5555555555555555555555555555555555555555",
    tokenDecimals: 6,
    depth: 20,
    confirmations: 1,
  }),
}));
vi.mock("../src/components/dashboard/useMyNotes", () => ({
  useMyNotes: () => ({
    claimable: 25_000_000n,
    loading: false,
    refreshing: false,
    stale: false,
    error: null,
    indexedAt: "2026-10-05T00:00:00.000Z",
    notes: [],
    refresh: vi.fn(),
  }),
}));

import { PayRequestDialog } from "../src/components/dashboard/PayRequestDialog";

describe("fixed private balance payment dialog", () => {
  it("offers a status check after 30 seconds without offering another payment", async () => {
    vi.useFakeTimers();
    const onCheck = vi.fn().mockResolvedValue(null),
      onOpenChange = vi.fn();
    const row = {
      record: {
        id: "slow",
        pool: "pool",
        requester: { username: "client" },
        status: "pending",
        operationId: "op",
      },
      amount: 20_000_000n,
      note: "Design",
      unreadable: false,
    };
    try {
      const view = render(
        <PayRequestDialog
          request={row as never}
          open
          onOpenChange={onOpenChange}
          operation={
            {
              id: "op",
              phase: "needsReconciliation",
              txHash: "0xhash",
              completedMerges: 0,
            } as never
          }
          working={false}
          error={null}
          onPay={state.pay}
          onCheck={onCheck}
        />,
      );
      expect(screen.getByText(/Payment sent/)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Check status" }),
      ).not.toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      fireEvent.click(screen.getByRole("button", { name: "Check status" }));
      expect(onCheck).toHaveBeenCalledOnce();
      expect(
        screen.queryByRole("button", { name: /Pay 20/ }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
  it("blocks a second send while a stored operation is being reconciled", async () => {
    const record = {
      record: {
        id: "r",
        pool: "31337:0x1111111111111111111111111111111111111111",
        requester: { username: "client" },
        addressee: { username: "alice" },
        status: "pending",
        operationId: "op",
        revision: 0,
      },
      amount: 20_000_000n,
      note: "Design work",
      unreadable: false,
    };
    render(
      <PayRequestDialog
        request={record as never}
        open
        onOpenChange={vi.fn()}
        operation={state.operation as never}
        working={false}
        error={null}
        onPay={state.pay}
      />,
    );
    expect(screen.getByText("Private Meaw balance")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(
      /Checking the existing private payment/,
    );
    expect(
      screen.queryByRole("button", { name: /Pay 20 USDC/ }),
    ).not.toBeInTheDocument();
  });
});
