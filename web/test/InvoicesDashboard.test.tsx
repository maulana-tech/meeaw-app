// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceView } from "../src/features/invoices/types";

const downloadInvoicePdfMock = vi.fn();
vi.mock("../src/lib/invoicePdf", () => ({
  downloadInvoicePdf: (...args: unknown[]) => downloadInvoicePdfMock(...args),
}));

const state = vi.hoisted(() => ({
  list: vi.fn(),
  void: vi.fn(),
  address: "0x1111111111111111111111111111111111111111",
  username: "alice",
}));

vi.mock("../src/trpc/client", () => ({
  api: {
    invoices: {
      list: { query: (...args: unknown[]) => state.list(...args) },
      void: { mutate: (...args: unknown[]) => state.void(...args) },
    },
  },
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    username: state.username,
    address: state.address,
    sessionReady: true,
  }),
}));

import {
  InvoiceRow,
  InvoicesDashboard,
} from "../src/components/invoices/InvoicesDashboard";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderWithClient(ui: ReactNode) {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const mockInvoice: InvoiceView = {
  id: "inv-1",
  token: "tok-1",
  username: "alice",
  number: "INV-001",
  clientName: "Acme Corp",
  asset: "USDC",
  tokenDecimals: 6,
  amount: "10000000",
  items: [
    {
      id: "item-1",
      description: "Consulting",
      quantity: 1,
      unitPrice: "10000000",
    },
  ],
  notes: "Net 30",
  dueDate: "2026-11-01",
  status: "pending",
  createdAt: "2026-10-10T00:00:00Z",
  paidAt: null,
  paidTx: null,
  voidedAt: null,
  checkout: null,
};

describe("InvoicesDashboard & InvoiceRow PDF download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    downloadInvoicePdfMock.mockResolvedValue(undefined);
    state.list.mockResolvedValue({
      items: [mockInvoice],
      nextCursor: null,
    });
  });

  it("renders Download PDF button for invoices on the dashboard", async () => {
    renderWithClient(<InvoicesDashboard />);

    const downloadBtn = await screen.findByRole("button", {
      name: /Download PDF/i,
    });
    expect(downloadBtn).toBeInTheDocument();
    expect(downloadBtn).not.toBeDisabled();
  });

  it("triggers downloadInvoicePdf with invoice and origin when clicked", async () => {
    renderWithClient(<InvoicesDashboard />);

    const downloadBtn = await screen.findByRole("button", {
      name: /Download PDF/i,
    });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(downloadInvoicePdfMock).toHaveBeenCalledTimes(1);
    });
    expect(downloadInvoicePdfMock).toHaveBeenCalledWith(
      mockInvoice,
      expect.objectContaining({ origin: expect.any(String) }),
    );
  });

  it("shows Downloading… state and disables button during download", async () => {
    let resolveDownload!: () => void;
    downloadInvoicePdfMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveDownload = resolve;
      }),
    );

    render(
      <InvoiceRow
        invoice={mockInvoice}
        origin="https://meeaw.app"
        onChanged={vi.fn()}
      />,
    );

    const downloadBtn = screen.getByRole("button", {
      name: /Download PDF/i,
    });
    fireEvent.click(downloadBtn);

    expect(
      screen.getByRole("button", { name: /Downloading…/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Downloading…/i }),
    ).toBeDisabled();

    resolveDownload();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Download PDF/i }),
      ).not.toBeDisabled();
    });
  });

  it("displays error message if download fails", async () => {
    downloadInvoicePdfMock.mockRejectedValue(
      new Error("Failed to render PDF export"),
    );

    render(
      <InvoiceRow
        invoice={mockInvoice}
        origin="https://meeaw.app"
        onChanged={vi.fn()}
      />,
    );

    const downloadBtn = screen.getByRole("button", {
      name: /Download PDF/i,
    });
    fireEvent.click(downloadBtn);

    expect(
      await screen.findByText("Failed to render PDF export"),
    ).toBeInTheDocument();
  });

  it("renders Download PDF action for paid and void invoices", () => {
    const paidInvoice = { ...mockInvoice, status: "paid" as const };
    const { rerender } = render(
      <InvoiceRow
        invoice={paidInvoice}
        origin="https://meeaw.app"
        onChanged={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Download PDF/i }),
    ).toBeInTheDocument();

    const voidInvoice = { ...mockInvoice, status: "void" as const };
    rerender(
      <InvoiceRow
        invoice={voidInvoice}
        origin="https://meeaw.app"
        onChanged={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Download PDF/i }),
    ).toBeInTheDocument();
  });
});
