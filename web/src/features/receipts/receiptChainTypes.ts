import type { PoolScope } from "../../lib/pools";
export type ReceiptChainInput = {
  pool: PoolScope;
  blockNumber: number;
  blockHash?: `0x${string}`;
};
export type ReceiptChainSnapshot = {
  pool: PoolScope;
  chainId: number;
  blockNumber: number;
  blockHash: `0x${string}`;
  root: `0x${string}`;
  leafCount: number;
  token: `0x${string}`;
  tokenDecimals: number;
  headBlock: number;
  confirmed: boolean;
};
export type ReceiptChainOutcome =
  | { status: "available"; snapshot: ReceiptChainSnapshot }
  | { status: "unavailable"; reason: string }
  | { status: "mismatch"; reason: string };
export type LoadReceiptSnapshot = (
  input: ReceiptChainInput,
) => Promise<ReceiptChainOutcome>;
