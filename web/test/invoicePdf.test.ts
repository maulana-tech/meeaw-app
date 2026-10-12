import { describe, expect, it, vi } from "vitest";
import type { InvoiceView } from "../src/features/invoices/types";
import { downloadInvoicePdf, renderInvoicePdf } from "../src/lib/invoicePdf";

const pendingInvoice: InvoiceView = {
  id: "inv_1",
  token: "tok_1234567890abcdef",
  username: "alice",
  number: "INV-2026-001",
  clientName: "Acme Corp",
  asset: "USDC",
  tokenDecimals: 6,
  amount: "250000000", // 250 USDC
  items: [
    {
      id: "item_1",
      description: "Frontend Development",
      quantity: 2,
      unitPrice: "100000000", // 100 USDC
    },
    {
      id: "item_2",
      description: "UI Review & Consultation",
      quantity: 1,
      unitPrice: "50000000", // 50 USDC
    },
  ],
  notes: "Payment due within 14 days.",
  dueDate: "2026-10-25",
  status: "pending",
  createdAt: "2026-10-11T12:00:00Z",
  paidAt: null,
  paidTx: null,
  voidedAt: null,
  checkout: null,
};

const paidInvoice: InvoiceView = {
  ...pendingInvoice,
  id: "inv_2",
  number: "INV-2026-002",
  status: "paid",
  paidAt: "2026-10-12T15:30:00Z",
  paidTx: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
};

describe("Invoice PDF Generation", () => {
  it("renders a pending invoice document with INVOICE header, line items, and client name", async () => {
    const doc = await renderInvoicePdf(pendingInvoice, {
      origin: "https://meaw.xyz",
    });
    expect(doc).toBeDefined();

    // Verify document properties
    const props = doc.getDocumentProperties();
    expect(props.title).toContain("INV-2026-001");
    expect(props.author).toBe("Meaw");

    // Output can be serialized without errors
    const arrayBuffer = doc.output("arraybuffer");
    expect(arrayBuffer.byteLength).toBeGreaterThan(1000);

    const raw = doc.output();
    expect(raw).toContain("INVOICE");
    expect(raw).toContain("INV-2026-001");
    expect(raw).toContain("PENDING");
    expect(raw).toContain("Acme Corp");
    expect(raw).toContain("Frontend Development");
    expect(raw).toContain("UI Review & Consultation");
    expect(raw).toContain("250 USDC");
    expect(raw).toContain("Payment due within 14 days.");
    expect(raw).toContain("@alice");
    expect(raw).toContain("https://meaw.xyz/i/tok_1234567890abcdef");
  });

  it("renders a paid invoice document with PAYMENT RECEIPT header, PAID badge, and settlement date", async () => {
    const doc = await renderInvoicePdf(paidInvoice, {
      origin: "https://meaw.xyz",
    });
    expect(doc).toBeDefined();

    const props = doc.getDocumentProperties();
    expect(props.title).toContain("Payment Receipt");
    expect(props.title).toContain("INV-2026-002");

    const raw = doc.output();
    expect(raw).toContain("PAYMENT RECEIPT");
    expect(raw).toContain("PAID");
    expect(raw).toContain("Settled:");
    expect(raw).toContain("TOTAL PAID");
    expect(raw).toContain("INV-2026-002");
  });

  it("downloads an invoice PDF with doc.save using the invoice number as filename", async () => {
    const fs = await import("node:fs");
    const writeSpy = vi
      .spyOn(fs.default ?? fs, "writeFileSync")
      .mockImplementation(() => {});

    await downloadInvoicePdf(pendingInvoice, { origin: "https://meaw.xyz" });
    expect(writeSpy).toHaveBeenCalledWith(
      "INV-2026-001.pdf",
      expect.any(Buffer),
    );

    await downloadInvoicePdf(paidInvoice);
    expect(writeSpy).toHaveBeenCalledWith(
      "INV-2026-002.pdf",
      expect.any(Buffer),
    );

    writeSpy.mockRestore();
  });

  it("renders a void invoice without notes and defaults to relative checkout url when origin is omitted", async () => {
    const voidInvoice: InvoiceView = {
      ...pendingInvoice,
      id: "inv_3",
      number: "INV-2026-003",
      status: "void",
      notes: "",
      voidedAt: "2026-10-12T10:00:00Z",
    };

    const doc = await renderInvoicePdf(voidInvoice);
    expect(doc).toBeDefined();

    const raw = doc.output();
    expect(raw).toContain("VOID");
    expect(raw).toContain("INV-2026-003");
    expect(raw).toContain("Pay or verify online: /i/tok_1234567890abcdef");
    expect(raw).not.toContain("NOTES");
  });
});
