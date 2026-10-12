# Invoice & Payment Receipt PDF Export Design Specification

**Date:** 2026-10-13  
**Status:** Approved  
**Topic:** Client-Side PDF Generation for Invoices and Paid Receipts via jsPDF  

---

## 1. Context & Purpose

Meaw allows freelancers and businesses to issue numbered USDC and AUSD invoices with line items, due dates, and client names. While invoice links can be shared for on-chain checkout, real-world commerce and accounting require downloadable, formal documents.

This specification introduces **Invoice & Payment Receipt PDF Export**, providing:
1. **Official Invoice Documents:** A formal bill detailing line items, quantities, unit prices, issuer handle (`@username`), client name, and payment link/QR context.
2. **Official Payment Receipts:** Once settled, the document automatically adapts into a "PAYMENT RECEIPT" branded with a prominent "PAID" badge and the settlement timestamp.
3. **Pure Client-Side Generation:** Vector PDF rendering using `jspdf` (already a project dependency), ensuring zero server overhead, offline PWA compatibility, and instant downloads.
4. **Strict Token & Style Adherence:** Visual styling is locked to Meaw's official design system palette (`#F5F3EA` linen, `#1A1F12` obsidian, `#A8A092` ash, `#D6D6C8` line). UI buttons strictly use existing `--dash-*` tokens and `dashButtonSecondary`.

---

## 2. Document Layout & Specifications

### 2.1 Color Palette & Geometry
- **Format:** A4 portrait (`format: "a4"`, units: `pt`, 595.28 x 841.89 pt).
- **Margins:** 56 pt on all sides.
- **Palette:**
  - Page Background: `#F5F3EA` (Linen)
  - Primary Text & Wordmark: `#1A1F12` (Obsidian)
  - Secondary / Muted Text: `#6B6E5D` (Muted Olive / Ash)
  - Borders & Hairlines: `#D6D6C8` (Line)
  - Paid Badge Accent: `#1A1F12` background with `#F5F3EA` text

### 2.2 Sections

#### Header
- **Top Left:** "Meaw" wordmark drawn in vector text (`helvetica, bold, 22pt`).
- **Top Right:**
  - Document Title: `"INVOICE"` (if status is `pending`, `overdue`, or `void`) or `"PAYMENT RECEIPT"` (if status is `paid`).
  - Document Number: `${invoice.number}` in monospaced or bold font.
  - Status Badge:
    - Paid: Box with `"PAID"` and settlement timestamp (`"Settled: <date> UTC"`).
    - Pending: `"PENDING"` and `"Due: <dueDate> UTC"`.
    - Overdue: `"OVERDUE"`.
    - Void: `"VOID"`.

#### Parties & Metadata
- Two-column metadata block:
  - **Left column (From / Issuer):**
    - `"Issued by:"` `@${invoice.username}`
    - `"Platform:"` `"Meaw Private Payments (Monad testnet)"`
  - **Right column (Billed to):**
    - `"Billed to:"` `${invoice.clientName}`
    - `"Issue Date:"` `${invoice.createdAt.slice(0, 10)}`
    - `"Due Date:"` `${invoice.dueDate}`

#### Line Items Table
- Hairline-bordered table spanning the content width:
  - Columns:
    - `Description` (left-aligned, 50% width)
    - `Qty` (center-aligned, 15% width)
    - `Unit Price` (right-aligned, 17.5% width)
    - `Total` (right-aligned, 17.5% width)
  - Subtle divider line beneath headers and each item row.
  - Format currency amounts clearly with asset symbol (e.g., `100.00 USDC` or `50.00 AUSD`).

#### Financial Summary
- Right-aligned summary box:
  - `Subtotal`: Sum of all line items.
  - `Total Due` (or `Total Paid` if settled): Emphasized in bold 16pt font with exact token asset.
- Left-aligned notes block:
  - If `invoice.notes` is present, rendered cleanly with word wrapping under a `"Notes"` label.

#### Footer
- Divider hairline at bottom.
- Verification & Checkout Link: `${origin}/i/${invoice.token}`.
- Privacy & Settlement Notice: `"Invoice issued via Meaw. Balances and spending history remain private."`
- Pagination: `"Page 1 of 1"`.

---

## 3. Architecture & Code Organization

### 3.1 PDF Generator Module (`web/src/lib/invoicePdf.ts`)
- Lazy dynamic import of `jspdf` (`const { jsPDF } = await import("jspdf")`) to protect Next.js SSR.
- Exports:
  1. `renderInvoicePdf(invoice: InvoiceView, options?: { origin?: string }): Promise<jsPDF>`
     - Pure function creating and styling the jsPDF instance.
     - Can be unit-tested in Node/Vitest without DOM dependencies.
  2. `downloadInvoicePdf(invoice: InvoiceView, options?: { origin?: string }): Promise<void>`
     - Calls `renderInvoicePdf`.
     - Invokes browser download: `doc.save("${invoice.number}.pdf")`.
     - Handles errors with user-facing toast notifications via `sonner`.

### 3.2 UI Integration

#### 1. Issuer Dashboard (`web/src/components/invoices/InvoicesDashboard.tsx`)
- In `InvoiceRow` action buttons:
  ```tsx
  <button
    type="button"
    className={`${dashButtonSecondary} min-h-11`}
    disabled={downloading}
    onClick={() => void handleDownloadPdf()}
  >
    <Download className="size-4" aria-hidden="true" />
    {downloading ? "Downloading…" : "Download PDF"}
  </button>
  ```
- Positioned alongside `Copy link`, `QR`, and `Void invoice`.

#### 2. Public Client Checkout (`web/src/components/invoices/InvoiceCheckout.tsx`)
- Inside the main invoice card article:
  ```tsx
  <button
    type="button"
    className={`${dashButtonSecondary} min-h-11`}
    disabled={downloading}
    onClick={() => void handleDownloadPdf()}
  >
    <Download className="size-4" aria-hidden="true" />
    {downloading
      ? "Downloading…"
      : invoice.status === "paid"
        ? "Download receipt (PDF)"
        : "Download invoice (PDF)"}
  </button>
  ```
- In the paid status aside card:
  - Prominent download button allowing clients to save their receipt immediately upon successful payment verification.

---

## 4. Testing & Verification Plan

1. **Unit Tests (`web/test/invoicePdf.test.ts`):**
   - Verify `renderInvoicePdf` executes without error for pending and paid invoices.
   - Verify output metadata (title, author, keywords).
   - Verify line items, client name, issuer username, and totals are rendered.
   - Verify "INVOICE" header for pending vs "PAYMENT RECEIPT" header and "PAID" badge for paid status.
2. **Component Integration Tests (`web/test/InvoicesDashboard.test.tsx` & `web/test/InvoiceCheckout.test.tsx`):**
   - Verify "Download PDF" button renders in invoice row.
   - Verify click triggers `downloadInvoicePdf`.
   - Verify button renders on public checkout page and handles download.
3. **Build & Linter:**
   - Verify `tsc --noEmit` and `pnpm --filter web build:local`.
   - Biome check clean.
