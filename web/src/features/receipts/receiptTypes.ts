import type { AssetSymbol } from "../../lib/assets";
import type { PoolDescriptor } from "../../lib/pools";
export type ReceiptV1 = {
  version: 1;
  pool: string;
  network: string;
  leafIndex: number;
  commitmentHex: string;
  commitment: string;
  rootHex: string;
  root: string;
  amount: string;
  amountLabel: string;
  ownerPk: string;
  salt: string;
  pathElements: string[];
  pathIndices: number[];
  username: string | null;
  disclosedAt: string;
  asset?: AssetSymbol;
  tokenDecimals?: number;
};
export type ReceiptAnchor = {
  blockNumber: number;
  blockHash: `0x${string}`;
  leafCount: number;
};
export type ReceiptV2 = Omit<
  ReceiptV1,
  "version" | "asset" | "tokenDecimals"
> & {
  version: 2;
  asset: AssetSymbol;
  tokenDecimals: number;
  anchor: ReceiptAnchor;
};
export type ReceiptBundle = ReceiptV1 | ReceiptV2;
export type ReceiptIdentity = { reference: string; fingerprint: string };
export type ReceiptParseResult =
  | { status: "parsed"; bundle: ReceiptBundle; pool: PoolDescriptor }
  | { status: "invalid" | "unsupported"; reason: string };
export type ReceiptVerificationResult =
  | {
      status: "verified";
      local: "passed";
      chain: "passed";
      identity: ReceiptIdentity;
    }
  | {
      status: "invalid";
      local: "passed" | "failed";
      chain: "failed" | "not-run";
      reason: string;
    }
  | {
      status: "unavailable";
      local: "passed" | "not-run";
      chain: "unavailable";
      reason: string;
      identity?: ReceiptIdentity;
    };
