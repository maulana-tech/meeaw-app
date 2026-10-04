// @vitest-environment happy-dom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const DEST = "0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c";

const mocks = vi.hoisted(() => ({
  scanMyNotes: vi.fn(),
  withdrawNote: vi.fn(),
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: "0x00000000000000000000000000000000000000E1",
    accountUnlocked: true,
    promptUnlock: vi.fn(),
    getSigner: vi.fn(async () => ({})),
  }),
}));

vi.mock("../src/components/dashboard/useMyNotes", () => ({
  useMyNotes: () => ({
    notes: [
      { leafIndex: 3, amount: 500_000n, salt: 1n, spent: false },
      { leafIndex: 7, amount: 800_000n, salt: 2n, spent: false },
    ],
    claimable: 1_300_000n,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("../src/lib/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/notes")>();
  return {
    ...actual,
    getAccount: () => ({}),
    scanMyNotes: mocks.scanMyNotes,
  };
});

vi.mock("../src/lib/withdraw", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/withdraw")>();
  return {
    ...actual,
    withdrawNote: mocks.withdrawNote,
  };
});

import { WithdrawDashboard } from "../src/components/dashboard/WithdrawDashboard";

it("opens straight to the Monad destination form for one or all payments", () => {
  render(<WithdrawDashboard />);

  fireEvent.click(
    screen.getByRole("button", {
      name: "Withdraw private payment 1, 0.8 USDC",
    }),
  );
  const singleDialog = screen.getByRole("dialog");
  expect(within(singleDialog).getByText("$0.8")).toBeInTheDocument();
  expect(
    within(singleDialog).getByText("from one private payment"),
  ).toBeInTheDocument();
  expect(
    within(singleDialog).getByLabelText("Destination wallet"),
  ).toHaveAttribute("placeholder", "0x…");
  expect(screen.queryByText(/MoneyGram/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Stellar/i)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(
    screen.getByRole("button", {
      name: "Withdraw all 2 payments, 1.3 USDC total",
    }),
  );
  const bulkDialog = screen.getByRole("dialog");
  expect(within(bulkDialog).getByText("$1.3")).toBeInTheDocument();
  expect(
    within(bulkDialog).getByText("across 2 private payments"),
  ).toBeInTheDocument();
});

it("rejects a non-Monad destination", async () => {
  render(<WithdrawDashboard />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Withdraw private payment 1, 0.8 USDC",
    }),
  );
  fireEvent.change(screen.getByLabelText("Destination wallet"), {
    target: {
      value: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  // The validation message is surfaced as a toast; the form stays in place.
  expect(
    await screen.findByRole("button", { name: "Review withdrawal" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Destination wallet")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(
    screen.queryByRole("button", { name: "Confirm & cash out" }),
  ).not.toBeInTheDocument();
});

it("allows the proof-generation dialog to be closed", async () => {
  mocks.scanMyNotes.mockResolvedValue({
    notes: [{ leafIndex: 7, amount: 800_000n, salt: 2n, spent: false }],
  });
  mocks.withdrawNote.mockReturnValue(new Promise(() => {}));

  render(<WithdrawDashboard />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Withdraw private payment 1, 0.8 USDC",
    }),
  );
  fireEvent.change(screen.getByLabelText("Destination wallet"), {
    target: { value: DEST },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review withdrawal" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Confirm & cash out" }),
  );

  expect(
    await screen.findByText(/zero-knowledge proof is built in your browser/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(
    screen.queryByText(/zero-knowledge proof is built in your browser/),
  ).not.toBeInTheDocument();
});
