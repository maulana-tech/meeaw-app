import { describe, expect, it } from "vitest";
import {
  invoiceInput,
  invoiceStatus,
  invoiceTotal,
} from "../src/features/invoices/input";

const base = {
  username: "alice",
  number: "inv-001",
  clientName: "Client",
  asset: "AUSD",
  dueDate: "2026-10-12",
  notes: "",
  items: [{ description: "Design", quantity: 2, unitPrice: "1.25" }],
};
describe("invoice input", () => {
  it("normalizes the number and calculates an exact base-unit total", () => {
    const input = invoiceInput.parse(base);
    expect(input.number).toBe("INV-001");
    expect(invoiceTotal(input.items)).toBe(2_500_000n);
  });
  it("does not use floating-point money arithmetic", () => {
    expect(
      invoiceTotal([
        { description: "Work", quantity: 3, unitPrice: "0.1" },
        { description: "More", quantity: 1, unitPrice: "0.2" },
      ]),
    ).toBe(500_000n);
  });
  it.each([
    { asset: "USDT0" },
    { dueDate: "2026-02-30" },
    { items: [] },
    { items: [{ description: "Work", quantity: 1.5, unitPrice: "1" }] },
    { items: [{ description: "Work", quantity: 1, unitPrice: "0.0000001" }] },
    { items: [{ description: "Work", quantity: 1, unitPrice: "-1" }] },
    { items: [{ description: "Work", quantity: 1, unitPrice: "0" }] },
    {
      items: [
        { description: "Work", quantity: 10000, unitPrice: "999999999999" },
      ],
    },
  ])("rejects unsupported or unpayable invoices: %j", (patch) => {
    expect(invoiceInput.safeParse({ ...base, ...patch }).success).toBe(false);
  });
  it("derives overdue only for pending invoices after the due date in UTC", () => {
    expect(
      invoiceStatus("pending", "2026-10-12", new Date("2026-10-12T23:59:59Z")),
    ).toBe("pending");
    expect(
      invoiceStatus("pending", "2026-10-12", new Date("2026-10-13T00:00:00Z")),
    ).toBe("overdue");
    expect(
      invoiceStatus("paid", "2026-10-12", new Date("2026-10-13T00:00:00Z")),
    ).toBe("paid");
  });
});
