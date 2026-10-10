import "server-only";
import type { Hex } from "viem";
import type {
  InvoiceLine,
  InvoiceState,
  InvoiceView,
} from "../../../features/invoices/types";
import type { PoolDescriptor } from "../../../lib/pools";
import { getDb } from "../../db/mongo";

export type InvoiceDoc = {
  _id: string;
  token: string;
  ownerPrivyUserId: string;
  ownerWallet: Hex;
  username: string;
  number: string;
  clientName: string;
  asset: "USDC" | "AUSD";
  amount: string;
  items: InvoiceLine[];
  notes: string;
  dueDate: string;
  pool: PoolDescriptor;
  salt: string;
  commitment: Hex;
  ephemeralPk: Hex;
  ciphertext: Hex;
  notePubkey: Hex;
  viewPubkey: Hex;
  createdBlock: number;
  status: InvoiceState;
  createdAt: Date;
  updatedAt: Date;
  checkedAt: Date | null;
  paidAt: Date | null;
  paidTx: Hex | null;
  paidBlock: number | null;
  leafIndex: number | null;
  voidedAt: Date | null;
};
export async function invoiceCollection() {
  return (await getDb()).collection<InvoiceDoc>("invoices");
}
export async function ensureInvoiceIndexes() {
  const invoices = await invoiceCollection();
  await invoices.createIndexes([
    {
      key: { ownerWallet: 1, number: 1 },
      name: "invoice_owner_number",
      unique: true,
    },
    { key: { token: 1 }, name: "invoice_token", unique: true },
    { key: { commitment: 1 }, name: "invoice_commitment", unique: true },
    {
      key: { ownerPrivyUserId: 1, createdAt: -1, _id: -1 },
      name: "invoice_owner_created",
    },
    {
      key: { status: 1, checkedAt: 1, _id: 1 },
      name: "invoice_reconciliation",
    },
  ]);
  return invoices;
}
export function invoiceView(doc: InvoiceDoc): InvoiceView {
  return {
    id: doc._id,
    token: doc.token,
    username: doc.username,
    number: doc.number,
    clientName: doc.clientName,
    asset: doc.asset,
    tokenDecimals: doc.pool.tokenDecimals,
    amount: doc.amount,
    items: doc.items.map((item, position) => ({
      id: item.id ?? `${doc._id}:line-${position}`,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    notes: doc.notes,
    dueDate: doc.dueDate,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    paidAt: doc.paidAt?.toISOString() ?? null,
    paidTx: doc.paidTx,
    voidedAt: doc.voidedAt?.toISOString() ?? null,
    checkout:
      doc.status === "pending"
        ? {
            poolScope: doc.pool.scope,
            salt: doc.salt,
            ephemeralPk: doc.ephemeralPk,
            ciphertext: doc.ciphertext,
            recipientWallet: doc.ownerWallet,
            notePubkey: doc.notePubkey,
            viewPubkey: doc.viewPubkey,
          }
        : null,
  };
}
