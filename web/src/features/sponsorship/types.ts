import type { Hex } from "viem";
export type ActionKind =
  | "register"
  | "rotation"
  | "deposit"
  | "withdraw"
  | "withdraw-batch"
  | "legacy-transfer"
  | "send"
  | "request-pay"
  | "faucet";
export type Principal = {
  kind: "user" | "guest-wallet" | "anonymous";
  key: string;
};
export type SponsorPolicy = {
  revision: string;
  userLimit: number;
  guestWalletLimit: number;
  anonymousLimit: number;
  globalWei: bigint;
  anonymousWei: bigint;
  actionWei: bigint;
  balanceFloorWei: bigint;
  feeCeilingWei: bigint;
  maxChildren: number;
};
export type PolicyState =
  | { ready: true; policy: SponsorPolicy }
  | { ready: false; reason: "configuration" };
export type ActionIntent = {
  chainId: number;
  actionId: string;
  kind: ActionKind;
  principal: Principal;
  businessDigest: Hex;
  maximumChildren: number;
};
export type ActionTicket = { chainId: number; actionId: string; fence: number };
export type ChildTicket = ActionTicket & {
  childId: string;
  childFence: number;
};
export type SponsorBinding = { action: ActionTicket; childId: string };
export type UnavailableReason =
  | "configuration"
  | "initializing"
  | "quota"
  | "budget"
  | "anonymous-budget"
  | "balance"
  | "cost"
  | "capacity"
  | "rpc";
export type QuotaStatus = {
  configured: boolean;
  available: boolean;
  reason: UnavailableReason | null;
  limit: number | null;
  used: number | null;
  reserved: number | null;
  remaining: number | null;
  resetAt: string;
};
export type FrozenTx = {
  chainId: number;
  from: Hex;
  to: Hex;
  data: Hex;
  nonce: number;
  gas: bigint;
  value: 0n;
  fee:
    | { type: 0; gasPrice: bigint }
    | { type: 2; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
};
export type FeeEvidence = {
  hash: Hex;
  block: bigint;
  blockHash: Hex;
  blockTime: Date;
  outcome: "confirmed" | "reverted";
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  transaction: FrozenTx;
};
