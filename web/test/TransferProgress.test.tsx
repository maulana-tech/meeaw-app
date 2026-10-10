// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TransferProgress } from "../src/components/dashboard/TransferProgress";
import type { TransferRecord } from "../src/features/transfers/types";
import { sponsorshipUiFixture } from "./helpers/sponsorshipUiFixture";

const state = vi.hoisted(() => ({
  phase: "submitted",
  hash: "0x123",
  continueSend: vi.fn(),
}));
vi.mock("../src/features/sponsorship/useSponsorship", () => ({
  useSponsorship: () => sponsorshipUiFixture(),
}));
vi.mock("../src/features/transfers/hooks/useDirectTransfer", () => ({
  useDirectTransfer: () => ({
    operation: { phase: state.phase, txHash: state.hash },
    continueSend: state.continueSend,
    working: false,
    error: null,
  }),
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ address: "alice", accountUnlocked: false }),
}));
vi.mock("../src/lib/notes", () => ({ getAccount: () => null }));
const record = {
  id: "existing-payment",
  pool: "10143:pool",
  recipient: { username: "bob" },
} as TransferRecord;
beforeEach(() => {
  state.phase = "submitted";
  state.continueSend.mockReset();
});

describe("transfer confirmation", () => {
  it("shows success only after confirmed chain status", () => {
    state.phase = "confirmed";
    render(<TransferProgress record={record} open onClose={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /payment is confirmed/,
    );
    expect(screen.getByRole("img", { name: /tucking a coin/ })).toBeVisible();
  });
  it("does not label a submitted transfer as successful", () => {
    render(<TransferProgress record={record} open onClose={() => {}} />);
    expect(
      screen.queryByRole("img", { name: /tucking a coin/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Confirming payment" }),
    ).toBeVisible();
  });
  it("reopens a pending transfer without automatically sending again", () => {
    state.phase = "needsReconciliation";
    render(<TransferProgress record={record} open onClose={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /starting another could pay twice/,
    );
    expect(state.continueSend).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "View transaction" }),
    ).toHaveAttribute("href", expect.stringContaining("/tx/0x123"));
  });
});
