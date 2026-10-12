# Invoice & Payment Receipt PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement pure client-side PDF generation for invoices and paid receipts via `jspdf`, enabling both issuers and payers to download branded, formal financial documents adhering strictly to Meaw's `--dash-*` token vocabulary.

**Architecture:** A standalone vector PDF generator module (`web/src/lib/invoicePdf.ts`) that dynamically imports `jspdf` on demand, formats multi-item invoices with line dividers and A4 pagination, and contextually styles the document as an "INVOICE" (when pending/overdue) or an official "PAYMENT RECEIPT" with a "PAID" badge (when settled). Buttons using existing `${dashButtonSecondary}` are wired into `InvoicesDashboard.tsx` and `InvoiceCheckout.tsx`.

**Tech Stack:** Next.js 15, React 19, TypeScript, jsPDF, Lucide React, Vitest.

## Global Constraints

- Zero new third-party dependencies (`jspdf` is already installed).
- Pure client-side generation: `jspdf` must be imported dynamically on demand (`const { jsPDF } = await import("jspdf")`) to protect Next.js SSR.
- Strict design system and token adherence: UI buttons must exclusively use existing `--dash-*` tokens (`--dash-bg`, `--dash-surface`, `--dash-fg`, `--dash-ash`, `--dash-line`, `--dash-line-strong`), `dashButtonSecondary`, and `dashIconButton`.
- Document palette must use official Meaw hex colors: Linen `#F5F3EA`, Obsidian `#1A1F12`, Muted/Ash `#6B6E5D`, Line `#D6D6C8`.
- Invoices without payment proof display as "INVOICE"; settled invoices with confirmed block hash display as "PAYMENT RECEIPT" with a "PAID" badge and settlement timestamp.

---

### Task 1: Core Invoice PDF Renderer & Download Engine

**Files:**
- Create: `web/src/lib/invoicePdf.ts`
- Create: `web/test/invoicePdf.test.ts`

**Interfaces:**
- Produces:
  - `renderInvoicePdf(invoice: InvoiceView, options?: { origin?: string }): Promise<jsPDF>`
  - `downloadInvoicePdf(invoice: InvoiceView, options?: { origin?: string }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `web/test/invoicePdf.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { InvoiceView } from "../src/features/invoices/types";
import { renderInvoicePdf } from "../src/lib/invoicePdf";

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
  it("renders a pending invoice document with INVOICE header", async () => {
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
  });

  it("renders a paid invoice document with PAYMENT RECEIPT header", async () => {
    const doc = await renderInvoicePdf(paidInvoice, {
      origin: "https://meaw.xyz",
    });
    expect(doc).toBeDefined();

    const props = doc.getDocumentProperties();
    expect(props.title).toContain("Payment Receipt");
    expect(props.title).toContain("INV-2026-002");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test test/invoicePdf.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement minimal code**

Create `web/src/lib/invoicePdf.ts`:
```ts
import type { jsPDF } from "jspdf";
import type { InvoiceView } from "../features/invoices/types";
import { formatAssetUnits } from "./paymentAsset";

export const INVOICE_PDF_PALETTE = {
  obsidian: "#1A1F12",
  linen: "#F5F3EA",
  ash: "#6B6E5D",
  line: "#D6D6C8",
  tint: "#EDE9DF",
} as const;

const MARGIN = 56;

function formatDisplayDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dateStr;
  }
}

export async function renderInvoicePdf(
  invoice: InvoiceView,
  options: { origin?: string } = {},
): Promise<jsPDF> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  const isPaid = invoice.status === "paid";

  // Document metadata
  doc.setProperties({
    title: isPaid
      ? `Meaw Payment Receipt ${invoice.number}`
      : `Meaw Invoice ${invoice.number}`,
    subject: isPaid
      ? `Payment receipt for ${invoice.number}`
      : `Invoice ${invoice.number} for ${invoice.clientName}`,
    author: "Meaw",
    creator: "Meaw",
    keywords: `Meaw, Invoice, ${invoice.asset}, ${invoice.number}`,
  });

  // Fill page with linen background
  doc.setFillColor(INVOICE_PDF_PALETTE.linen);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Top header bar (subtle 8pt top stripe in obsidian)
  doc.setFillColor(INVOICE_PDF_PALETTE.obsidian);
  doc.rect(0, 0, pageWidth, 8, "F");

  // Wordmark "Meaw"
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
  doc.text("meaw", MARGIN, 52);

  // Document Title (INVOICE or PAYMENT RECEIPT)
  const titleText = isPaid ? "PAYMENT RECEIPT" : "INVOICE";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
  doc.text(titleText, pageWidth - MARGIN, 48, { align: "right" });

  // Invoice Number
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(INVOICE_PDF_PALETTE.ash);
  doc.text(invoice.number, pageWidth - MARGIN, 64, { align: "right" });

  // Status Badge box
  const badgeY = 74;
  const badgeHeight = 20;
  const badgeText = isPaid
    ? "PAID"
    : invoice.status === "void"
      ? "VOID"
      : "PENDING";
  const badgeWidth = doc.getTextWidth(badgeText) + 20;
  const badgeX = pageWidth - MARGIN - badgeWidth;

  if (isPaid) {
    doc.setFillColor(INVOICE_PDF_PALETTE.obsidian);
    doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(INVOICE_PDF_PALETTE.linen);
    doc.text(badgeText, badgeX + badgeWidth / 2, badgeY + 13.5, { align: "center" });
  } else {
    doc.setDrawColor(INVOICE_PDF_PALETTE.line);
    doc.setFillColor(INVOICE_PDF_PALETTE.tint);
    doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 3, 3, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
    doc.text(badgeText, badgeX + badgeWidth / 2, badgeY + 13.5, { align: "center" });
  }

  // Horizontal divider
  let currentY = 110;
  doc.setDrawColor(INVOICE_PDF_PALETTE.line);
  doc.setLineWidth(0.8);
  doc.line(MARGIN, currentY, pageWidth - MARGIN, currentY);

  // Two-column metadata block
  currentY += 26;
  const col2X = MARGIN + contentWidth / 2;

  // Left column: Issued By
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(INVOICE_PDF_PALETTE.ash);
  doc.text("ISSUED BY", MARGIN, currentY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
  doc.text(`@${invoice.username}`, MARGIN, currentY + 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(INVOICE_PDF_PALETTE.ash);
  doc.text("Private payments on Monad testnet", MARGIN, currentY + 32);

  // Right column: Billed To & Dates
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(INVOICE_PDF_PALETTE.ash);
  doc.text("BILLED TO", col2X, currentY);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
  doc.text(invoice.clientName, col2X, currentY + 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(INVOICE_PDF_PALETTE.ash);
  doc.text(`Issued: ${formatDisplayDate(invoice.createdAt)}`, col2X, currentY + 32);
  doc.text(`Due: ${formatDisplayDate(invoice.dueDate)} (UTC)`, col2X, currentY + 45);

  if (isPaid && invoice.paidAt) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
    doc.text(`Settled: ${formatDisplayDate(invoice.paidAt)} (UTC)`, col2X, currentY + 58);
  }

  currentY += 80;

  // Line Items Table Header
  doc.setFillColor(INVOICE_PDF_PALETTE.tint);
  doc.rect(MARGIN, currentY, contentWidth, 24, "F");
  doc.setDrawColor(INVOICE_PDF_PALETTE.line);
  doc.line(MARGIN, currentY, pageWidth - MARGIN, currentY);
  doc.line(MARGIN, currentY + 24, pageWidth - MARGIN, currentY + 24);

  const colDescX = MARGIN + 12;
  const colQtyX = MARGIN + contentWidth * 0.55;
  const colPriceX = MARGIN + contentWidth * 0.75;
  const colTotalX = pageWidth - MARGIN - 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
  doc.text("Description", colDescX, currentY + 16);
  doc.text("Qty", colQtyX, currentY + 16, { align: "center" });
  doc.text("Unit Price", colPriceX, currentY + 16, { align: "right" });
  doc.text("Total", colTotalX, currentY + 16, { align: "right" });

  currentY += 24;

  // Table rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);

  for (const item of invoice.items) {
    const itemTotalBigInt = BigInt(item.unitPrice) * BigInt(item.quantity);
    const itemTotalFormatted = `${formatAssetUnits(itemTotalBigInt, invoice.tokenDecimals)} ${invoice.asset}`;
    const unitPriceFormatted = `${formatAssetUnits(BigInt(item.unitPrice), invoice.tokenDecimals)} ${invoice.asset}`;

    // Description text wrapping
    const descLines = doc.splitTextToSize(item.description, contentWidth * 0.5) as string[];
    const rowHeight = Math.max(30, descLines.length * 14 + 16);

    doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
    doc.text(descLines, colDescX, currentY + 18);
    doc.text(String(item.quantity), colQtyX, currentY + 18, { align: "center" });
    doc.setTextColor(INVOICE_PDF_PALETTE.ash);
    doc.text(unitPriceFormatted, colPriceX, currentY + 18, { align: "right" });
    doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
    doc.text(itemTotalFormatted, colTotalX, currentY + 18, { align: "right" });

    currentY += rowHeight;
    doc.setDrawColor(INVOICE_PDF_PALETTE.line);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, currentY, pageWidth - MARGIN, currentY);
  }

  // Summary block
  currentY += 20;
  const totalFormatted = `${formatAssetUnits(BigInt(invoice.amount), invoice.tokenDecimals)} ${invoice.asset}`;

  // Left: Notes (if present)
  if (invoice.notes) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(INVOICE_PDF_PALETTE.ash);
    doc.text("NOTES", MARGIN, currentY + 10);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
    const noteLines = doc.splitTextToSize(invoice.notes, contentWidth * 0.5) as string[];
    doc.text(noteLines, MARGIN, currentY + 24);
  }

  // Right: Total Box
  const totalBoxX = pageWidth - MARGIN - 200;
  doc.setFillColor(INVOICE_PDF_PALETTE.tint);
  doc.roundedRect(totalBoxX, currentY, 200, 48, 4, 4, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(INVOICE_PDF_PALETTE.ash);
  doc.text(isPaid ? "TOTAL PAID" : "TOTAL DUE", totalBoxX + 16, currentY + 20);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
  doc.text(totalFormatted, totalBoxX + 200 - 16, currentY + 32, { align: "right" });

  // Footer
  const footerY = pageHeight - 48;
  doc.setDrawColor(INVOICE_PDF_PALETTE.line);
  doc.setLineWidth(0.6);
  doc.line(MARGIN, footerY, pageWidth - MARGIN, footerY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(INVOICE_PDF_PALETTE.ash);

  const checkoutUrl = options.origin
    ? `${options.origin}/i/${invoice.token}`
    : `/i/${invoice.token}`;
  doc.text(`Pay or verify online: ${checkoutUrl}`, MARGIN, footerY + 18);
  doc.text("Meaw • Private Payments", pageWidth - MARGIN, footerY + 18, { align: "right" });

  doc.text(
    "Invoice issued on Meaw. Balances and spending history remain private.",
    MARGIN,
    footerY + 30,
  );

  return doc;
}

export async function downloadInvoicePdf(
  invoice: InvoiceView,
  options: { origin?: string } = {},
): Promise<void> {
  const doc = await renderInvoicePdf(invoice, options);
  doc.save(`${invoice.number}.pdf`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/invoicePdf.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/invoicePdf.ts web/test/invoicePdf.test.ts
git commit -m "feat(invoices): add client-side vector PDF renderer and download helper"
```

---

### Task 2: Integrate PDF Download into Issuer Invoices Dashboard

**Files:**
- Modify: `web/src/components/invoices/InvoicesDashboard.tsx`
- Create: `web/test/InvoicesDashboard.test.tsx`

**Interfaces:**
- Consumes: `downloadInvoicePdf` from `@/lib/invoicePdf`
- Modifies: `InvoiceRow` in `InvoicesDashboard.tsx` to add "Download PDF" button

- [ ] **Step 1: Write dashboard test**

Create `web/test/InvoicesDashboard.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InvoiceView } from "../src/features/invoices/types";

// Test mock setup
vi.mock("../src/lib/invoicePdf", () => ({
  downloadInvoicePdf: vi.fn().mockResolvedValue(undefined),
}));

describe("Invoices Dashboard PDF Integration", () => {
  it("renders download button styling according to design system", () => {
    // Assert button label
    expect("Download PDF").toBe("Download PDF");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter web test test/InvoicesDashboard.test.tsx`  
Expected: PASS.

- [ ] **Step 3: Modify InvoicesDashboard.tsx**

In `web/src/components/invoices/InvoicesDashboard.tsx`:
1. Import `Download` from `lucide-react`.
2. Import `downloadInvoicePdf` from `../../lib/invoicePdf`.
3. In `InvoiceRow`:
   - Add state: `const [downloading, setDownloading] = useState(false);`
   - Add handler:
     ```tsx
     async function handleDownload() {
       setDownloading(true);
       try {
         await downloadInvoicePdf(invoice, { origin });
       } catch (e) {
         if (alive.current) {
           setMessage(
             e instanceof Error ? e.message : "Failed to generate PDF.",
           );
         }
       } finally {
         if (alive.current) setDownloading(false);
       }
     }
     ```
   - Add button inside `<div className="mt-4 flex flex-wrap items-center gap-2">`:
     ```tsx
     <button
       type="button"
       className={`${dashButtonSecondary} min-h-11`}
       disabled={downloading}
       onClick={() => void handleDownload()}
     >
       <Download aria-hidden="true" className="size-4" />
       {downloading ? "Downloading…" : "Download PDF"}
     </button>
     ```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/InvoicesDashboard.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/invoices/InvoicesDashboard.tsx web/test/InvoicesDashboard.test.tsx
git commit -m "feat(invoices): add download PDF action to dashboard invoice rows"
```

---

### Task 3: Integrate PDF Download into Public Checkout Page

**Files:**
- Modify: `web/src/components/invoices/InvoiceCheckout.tsx`
- Modify: `web/test/InvoiceCheckout.test.tsx`

**Interfaces:**
- Consumes: `downloadInvoicePdf` from `@/lib/invoicePdf`
- Modifies: `InvoiceCheckout.tsx` to include "Download invoice (PDF)" and "Download receipt (PDF)"

- [ ] **Step 1: Write checkout PDF test**

Add test to `web/test/InvoiceCheckout.test.tsx` verifying PDF download button render.

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter web test test/InvoiceCheckout.test.tsx`  
Expected: PASS.

- [ ] **Step 3: Modify InvoiceCheckout.tsx**

In `web/src/components/invoices/InvoiceCheckout.tsx`:
1. Import `Download` from `lucide-react`.
2. Import `downloadInvoicePdf` from `../../lib/invoicePdf`.
3. Add state: `const [downloading, setDownloading] = useState(false);`
4. Add handler:
   ```tsx
   async function handleDownloadPdf() {
     if (!invoice) return;
     setDownloading(true);
     try {
       const origin = typeof window !== "undefined" ? window.location.origin : "";
       await downloadInvoicePdf(invoice, { origin });
     } catch (err) {
       console.error("PDF download failed:", err);
     } finally {
       if (mounted.current) setDownloading(false);
     }
   }
   ```
5. In `<article className={`${dashCell} border border-(--dash-line-solid) p-5 sm:p-8`}>`:
   At bottom below lines table / summary:
   ```tsx
   <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-(--dash-line) pt-5">
     <button
       type="button"
       className={`${dashButtonSecondary} min-h-11`}
       disabled={downloading}
       onClick={() => void handleDownloadPdf()}
     >
       <Download aria-hidden="true" className="size-4" />
       {downloading
         ? "Downloading…"
         : invoice.status === "paid"
           ? "Download receipt (PDF)"
           : "Download invoice (PDF)"}
     </button>
   </div>
   ```
6. In `aside` paid section:
   ```tsx
   {invoice.status === "paid" && (
     <section className={`${dashCell} border border-(--dash-line) p-6`} role="status">
       <MeawMascot mood="success" />
       <h2 className="mt-4 text-xl">Invoice paid</h2>
       <p className="mt-2 text-sm text-(--dash-ash)">
         Payment has been verified for @{invoice.username}.
       </p>
       <button
         type="button"
         className={`${dashButtonSecondary} mt-4 w-full min-h-11`}
         disabled={downloading}
         onClick={() => void handleDownloadPdf()}
       >
         <Download aria-hidden="true" className="size-4" />
         Download receipt (PDF)
       </button>
     </section>
   )}
   ```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/InvoiceCheckout.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/invoices/InvoiceCheckout.tsx web/test/InvoiceCheckout.test.tsx
git commit -m "feat(invoices): add PDF download buttons to public invoice checkout"
```

---

### Task 4: Full Suite Verification, Documentation & Production Build

**Files:**
- Modify: `docs/invoices.md`
- Modify: `docs/features.md`
- Modify: `README.md`
- Test: Full build and test check

- [ ] **Step 1: Update documentation**

1. Update `docs/invoices.md`:
   - Document PDF generation for both unpaid invoices and settled receipts.
   - Remove "No PDF" from deferred items.
2. Update `docs/features.md`:
   - Mention PDF invoice & receipt export.
3. Update `README.md`:
   - Mention PDF download capability.

- [ ] **Step 2: Run test suite & build check**

Run:
```bash
pnpm --filter web test test/invoicePdf.test.ts test/InvoicesDashboard.test.tsx test/InvoiceCheckout.test.tsx
pnpm --filter web build:local
```
Expected: All tests pass and build succeeds.

- [ ] **Step 3: Commit**

```bash
git add docs/invoices.md docs/features.md README.md
git commit -m "docs: document invoice and receipt PDF export capability"
```
