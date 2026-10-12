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
  const properties = {
    title: isPaid
      ? `Meaw Payment Receipt ${invoice.number}`
      : `Meaw Invoice ${invoice.number}`,
    subject: isPaid
      ? `Payment receipt for ${invoice.number}`
      : `Invoice ${invoice.number} for ${invoice.clientName}`,
    author: "Meaw",
    creator: "Meaw",
    keywords: `Meaw, Invoice, ${invoice.asset}, ${invoice.number}`,
  };
  doc.setProperties(properties);
  (
    doc as unknown as { getDocumentProperties: () => typeof properties }
  ).getDocumentProperties = () => properties;

  // Fill page with linen background
  doc.setFillColor(INVOICE_PDF_PALETTE.linen);
  doc.rect(0, 0, pageWidth, pageHeight, "F");

  // Top header bar (subtle 8pt top stripe in obsidian)
  doc.setFillColor(INVOICE_PDF_PALETTE.obsidian);
  doc.rect(0, 0, pageWidth, 8, "F");

  // Wordmark "meaw"
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
    doc.text(badgeText, badgeX + badgeWidth / 2, badgeY + 13.5, {
      align: "center",
    });
  } else {
    doc.setDrawColor(INVOICE_PDF_PALETTE.line);
    doc.setFillColor(INVOICE_PDF_PALETTE.tint);
    doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 3, 3, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
    doc.text(badgeText, badgeX + badgeWidth / 2, badgeY + 13.5, {
      align: "center",
    });
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
  doc.text(
    `Issued: ${formatDisplayDate(invoice.createdAt)}`,
    col2X,
    currentY + 32,
  );
  doc.text(
    `Due: ${formatDisplayDate(invoice.dueDate)} (UTC)`,
    col2X,
    currentY + 45,
  );

  if (isPaid && invoice.paidAt) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
    doc.text(
      `Settled: ${formatDisplayDate(invoice.paidAt)} (UTC)`,
      col2X,
      currentY + 58,
    );
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
    const descLines = doc.splitTextToSize(
      item.description,
      contentWidth * 0.5,
    ) as string[];
    const rowHeight = Math.max(30, descLines.length * 14 + 16);

    doc.setTextColor(INVOICE_PDF_PALETTE.obsidian);
    doc.text(descLines, colDescX, currentY + 18);
    doc.text(String(item.quantity), colQtyX, currentY + 18, {
      align: "center",
    });
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
    const noteLines = doc.splitTextToSize(
      invoice.notes,
      contentWidth * 0.5,
    ) as string[];
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
  doc.text(totalFormatted, totalBoxX + 200 - 16, currentY + 32, {
    align: "right",
  });

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
  doc.text("Meaw • Private Payments", pageWidth - MARGIN, footerY + 18, {
    align: "right",
  });

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
