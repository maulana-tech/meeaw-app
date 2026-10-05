// Pool scoping and per-transaction classification shared by the handlers.
//
// Several pools (the active pool and legacy pools) can be indexed together, so
// every entity id carries its pool scope. Leaf 0 of one pool must never be
// confused with leaf 0 of another, and one owner's nullifier for the same
// leaf index is identical across pools.

export type PoolTransactionKind =
  | "deposit"
  | "withdraw"
  | "transfer"
  | "merge"
  | "incomplete";

/** `${chainId}:${lowercase pool address}`, matching the web app's PoolScope. */
export function poolScope(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

export const hexId = (value: string) => value.toLowerCase().replace(/^0x/, "");

export const scopedId = (scope: string, key: string | number) =>
  `${scope}:${key}`;

/**
 * Event shapes emitted by one MaweePool call (see MaweePool.sol):
 *   deposit  → Deposit
 *   withdraw → Withdrawal, Spend
 *   transfer → Deposit, Deposit, Spend
 *   merge    → Deposit, Spend, Spend
 * Anything else (including a group still being read) is incomplete and must
 * not publish an aggregate yet.
 */
export function classifyPoolTransaction(
  deposits: number,
  spends: number,
  withdrawals: number,
): PoolTransactionKind {
  if (withdrawals === 1 && spends === 1 && deposits === 0) return "withdraw";
  if (withdrawals === 0 && spends === 1 && deposits === 2) return "transfer";
  if (withdrawals === 0 && spends === 2 && deposits === 1) return "merge";
  if (withdrawals === 0 && spends === 0 && deposits === 1) return "deposit";
  return "incomplete";
}

/** Change in the transfer/merge counters when a transaction's kind changes. */
export function kindDelta(
  before: PoolTransactionKind,
  after: PoolTransactionKind,
): { shieldedTransfers: number; merges: number } {
  const count = (kind: PoolTransactionKind, target: PoolTransactionKind) =>
    kind === target ? 1 : 0;
  return {
    shieldedTransfers: count(after, "transfer") - count(before, "transfer"),
    merges: count(after, "merge") - count(before, "merge"),
  };
}
