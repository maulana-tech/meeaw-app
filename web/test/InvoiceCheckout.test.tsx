// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceCheckout } from "../src/components/invoices/InvoiceCheckout";
import type { InvoiceView } from "../src/features/invoices/types";
import { assetPool } from "./helpers/multiAssetFixtures";

const state = vi.hoisted(() => ({
  get: vi.fn(),
  confirm: vi.fn(),
  pay: vi.fn(),
  check: vi.fn(),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    invoices: {
      publicGet: { query: state.get },
      confirmPayment: { mutate: state.confirm },
      checkPayment: { mutate: state.check },
    },
  },
}));
vi.mock("../src/components/dashboard/DashboardBackground", () => ({
  DashboardBackground: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("../src/lib/chain", () => ({
  chain: { testnet: true, name: "Monad Testnet" },
  explorerTxUrl: (hash: string) => `https://example.com/tx/${hash}`,
}));
vi.mock("../src/app/pay/[username]/PayForm", () => ({
  PayForm: ({ onPaid }: { onPaid: (hash: string) => Promise<void> }) => (
    <button
      type="button"
      onClick={() => {
        state.pay();
        void onPaid(`0x${"a".repeat(64)}`);
      }}
    >
      Pay invoice
    </button>
  ),
}));
const token = "a".repeat(32);
const invoice: InvoiceView = {
  id: "00000000-0000-4000-8000-000000000001",
  token,
  username: "alice",
  number: "INV-001",
  clientName: "Client",
  asset: "AUSD",
  tokenDecimals: 6,
  amount: "2500000",
  items: [
    { id: "line-1", description: "Design", quantity: 2, unitPrice: "1250000" },
  ],
  notes: "",
  dueDate: "2026-10-12",
  status: "pending",
  createdAt: "2026-10-10T00:00:00Z",
  paidAt: null,
  paidTx: null,
  voidedAt: null,
  checkout: {
    poolScope: assetPool("AUSD").scope,
    salt: "7",
    ephemeralPk: `0x${"1".repeat(64)}`,
    ciphertext: `0x${"2".repeat(176)}`,
    recipientWallet: `0x${"1".repeat(40)}`,
    notePubkey: `0x${"3".repeat(64)}`,
    viewPubkey: `0x${"4".repeat(64)}`,
  },
};
beforeEach(() => {
  sessionStorage.clear();
  state.get.mockReset().mockResolvedValue(invoice);
  state.confirm.mockReset();
  state.pay.mockReset();
  state.check.mockReset().mockResolvedValue(invoice);
});
function view() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InvoiceCheckout token={token} />
    </QueryClientProvider>,
  );
}
describe("public invoice checkout", () => {
  it("ignores a late confirmation after opening another invoice", async () => {
    let finish: (value: InvoiceView) => void = () => {};
    state.confirm.mockImplementation(
      () =>
        new Promise<InvoiceView>((resolve) => {
          finish = resolve;
        }),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const content = (value: string) => (
      <QueryClientProvider client={client}>
        <InvoiceCheckout token={value} />
      </QueryClientProvider>
    );
    const page = render(content(token));
    fireEvent.click(await screen.findByRole("button", { name: "Pay invoice" }));
    await waitFor(() => expect(state.confirm).toHaveBeenCalledOnce());
    const nextToken = "b".repeat(32);
    state.get.mockResolvedValue({
      ...invoice,
      token: nextToken,
      number: "INV-002",
    });
    page.rerender(content(nextToken));
    await screen.findByText("INV-002");
    await act(async () =>
      finish({ ...invoice, status: "paid", checkout: null }),
    );
    expect(screen.queryByText("Invoice paid")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay invoice" })).toBeEnabled();
    expect(
      sessionStorage.getItem(`meaw:invoice-receipt:${nextToken}`),
    ).toBeNull();
  });
  it("keeps an uncertain attempt closed on reload even without a hash", async () => {
    sessionStorage.setItem(`meaw:invoice-attempt:${token}`, "1");
    view();
    const button = await screen.findByRole("button", {
      name: "Check payment status",
    });
    expect(
      screen.queryByRole("button", { name: "Pay invoice" }),
    ).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(state.check).toHaveBeenCalledWith({ token }));
    expect(state.pay).not.toHaveBeenCalled();
  });
  it("renders exact line totals and a pending checkout", async () => {
    view();
    expect(await screen.findByText("INV-001")).toBeVisible();
    expect(screen.getByText("Design")).toBeVisible();
    expect(screen.getByRole("button", { name: "Pay invoice" })).toBeEnabled();
  });
  it.each([
    "paid",
    "void",
  ] as const)("does not offer checkout for %s invoices", async (status) => {
    state.get.mockResolvedValue({ ...invoice, status, checkout: null });
    view();
    await screen.findByText("INV-001");
    expect(
      screen.queryByRole("button", { name: "Pay invoice" }),
    ).not.toBeInTheDocument();
  });
  it("retries server confirmation without offering another payment", async () => {
    state.confirm
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ...invoice, status: "paid", checkout: null });
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Pay invoice" }));
    expect(
      await screen.findByRole("button", { name: "Check payment status" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Pay invoice" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Check payment status" }),
    );
    await waitFor(() => expect(state.check).toHaveBeenCalledOnce());
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.pay).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(`meaw:invoice-receipt:${token}`)).toMatch(
      /^0xa/,
    );
  });
  it("restores a receipt hint on reload and keeps checkout closed", async () => {
    sessionStorage.setItem(
      `meaw:invoice-receipt:${token}`,
      `0x${"a".repeat(64)}`,
    );
    view();
    expect(
      await screen.findByRole("button", { name: "Check payment status" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Pay invoice" }),
    ).not.toBeInTheDocument();
  });
  it("reopens checkout after a matching restored receipt is proven reverted", async () => {
    const hash = `0x${"a".repeat(64)}`;
    sessionStorage.setItem(`meaw:invoice-receipt:${token}`, hash);
    sessionStorage.setItem(`meaw:invoice-attempt:${token}`, "1");
    state.check.mockResolvedValue({
      ...invoice,
      paymentOutcome: "reverted",
      verifiedRevertHash: hash,
    });
    view();
    fireEvent.click(
      await screen.findByRole("button", { name: "Check payment status" }),
    );
    expect(
      await screen.findByRole("button", { name: "Pay invoice" }),
    ).toBeEnabled();
    expect(sessionStorage.getItem(`meaw:invoice-attempt:${token}`)).toBeNull();
    expect(state.pay).not.toHaveBeenCalled();
  });
});
