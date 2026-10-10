import type { Hex } from "viem";
import type { PoolScope } from "../../lib/pools";

export type InvoiceState = "pending" | "paid" | "void";
export type InvoicePaymentLifecycle = {
  onSubmitting: () => void;
  onSubmitted: (hash: string) => void;
  onUncertain: () => void;
  onReleased: () => void;
};
export type InvoicePaymentIntent = {
  poolScope: PoolScope;
  salt: string;
  ephemeralPk: Hex;
  ciphertext: Hex;
};
export type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
};
export type InvoiceView = {
  id: string;
  token: string;
  username: string;
  number: string;
  clientName: string;
  asset: "USDC" | "AUSD";
  tokenDecimals: number;
  amount: string;
  items: InvoiceLine[];
  notes: string;
  dueDate: string;
  status: InvoiceState;
  createdAt: string;
  paidAt: string | null;
  paidTx: Hex | null;
  voidedAt: string | null;
  checkout:
    | (InvoicePaymentIntent & {
        recipientWallet: Hex;
        notePubkey: Hex;
        viewPubkey: Hex;
      })
    | null;
};
