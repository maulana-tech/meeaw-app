import type { MyNote } from "../../lib/notes";
import type {
  Hex,
  PoolScope,
  TransferPayload,
  TransferRecord,
} from "../transfers/types";
export type ActivityRow = {
  id: string;
  scope: PoolScope;
  kind: "received" | "sent" | "cashedOut" | "attempt" | "unclassified";
  status: "pending" | "confirmed" | "failed";
  amount: bigint | null;
  note: string | null;
  counterparty: string | null;
  at: string;
  txHash: Hex | null;
  leafIndex: number | null;
  locked: boolean;
  transferId: string | null;
};
export type PaymentActivityEvidence = {
  scope: PoolScope;
  txHash: Hex;
  block: number;
  at: string;
  kind: "deposit" | "merge" | "split" | "transfer" | "withdraw";
  inputs: readonly Hex[];
  outputs: readonly { commitment: Hex; leafIndex: number }[];
  withdrawAmount: string | null;
};
export type ActivityInput = {
  notes: readonly MyNote[];
  transfers: readonly TransferRecord[];
  payloads: ReadonlyMap<string, TransferPayload>;
  evidence: readonly PaymentActivityEvidence[];
  viewer: Hex;
};
