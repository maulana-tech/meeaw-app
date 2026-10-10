import { z } from "zod";
import type { InvoiceState } from "./types";

const unitPrice = z
  .string()
  .trim()
  .regex(
    /^\d{1,14}(\.\d{1,6})?$/,
    "Use a nonnegative price with up to 6 decimal places.",
  );
const line = z
  .object({
    description: z.string().trim().min(1).max(200),
    quantity: z.number().int().min(1).max(10000),
    unitPrice,
  })
  .strict();
export function invoicePriceUnits(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}
export function invoiceTotal(
  items: { quantity: number; unitPrice: string }[],
): bigint {
  return items.reduce(
    (total, item) =>
      total + BigInt(item.quantity) * invoicePriceUnits(item.unitPrice),
    0n,
  );
}
export const invoiceInput = z
  .object({
    username: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_]{3,32}$/),
    number: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9._/-]{0,39}$/, "Enter an invoice number."),
    clientName: z.string().trim().min(1).max(120),
    asset: z.enum(["USDC", "AUSD"]),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const date = new Date(`${v}T00:00:00Z`);
        return (
          Number.isFinite(date.getTime()) &&
          date.toISOString().slice(0, 10) === v
        );
      }, "Choose a valid due date."),
    notes: z.string().trim().max(1000).default(""),
    items: z.array(line).min(1).max(25),
  })
  .strict()
  .refine((v) => {
    try {
      const total = invoiceTotal(v.items);
      return total > 0n && total <= (1n << 64n) - 1n;
    } catch {
      return false;
    }
  }, "Invoice total must be positive and within the supported range.");
export type InvoiceInput = z.infer<typeof invoiceInput>;
export function invoiceStatus(
  status: InvoiceState,
  dueDate: string,
  now = new Date(),
) {
  return status === "pending" && now.toISOString().slice(0, 10) > dueDate
    ? "overdue"
    : status;
}
export const invoiceToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
export const invoiceId = z.string().uuid();
export const invoiceHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
