import { indexer } from "envio";
import type { DailyStats, PoolStats } from "envio";
import {
  classifyPoolTransaction,
  hexId,
  kindDelta,
  type PoolTransactionKind,
  poolScope,
  scopedId,
} from "./poolScope";

// Pool event order matters (see MaweePool.sol):
//   withdraw → Withdrawal(nullifier) then Spend(nullifier)
//   transfer → Deposit, Deposit, then Spend(nullifier)
//   merge    → Deposit, then Spend(nullifierA), Spend(nullifierB)
// Per-event counts (notes, spent, anonymity set) are exact as each event
// arrives. Transfers and merges are counted once per transaction, when its
// event group becomes complete (see PoolTransaction).

const DAY = 86_400;

function emptyStats(id: string, timestamp: number): PoolStats {
  return {
    id,
    notes: 0,
    spent: 0,
    anonymitySet: 0,
    withdrawals: 0,
    shieldedTransfers: 0,
    merges: 0,
    totalWithdrawn: 0n,
    paused: false,
    updatedAt: timestamp,
  };
}

export function dayStart(timestamp: number): number {
  return timestamp - (timestamp % DAY);
}

export function dayKey(timestamp: number): string {
  return new Date(dayStart(timestamp) * 1000).toISOString().slice(0, 10);
}

function emptyDay(pool: string, timestamp: number): DailyStats {
  return {
    id: scopedId(pool, dayKey(timestamp)),
    pool,
    dayStart: dayStart(timestamp),
    notes: 0,
    spent: 0,
    withdrawals: 0,
    withdrawnVolume: 0n,
  };
}

type PoolEvent = {
  chainId: number;
  srcAddress: string;
  block: { number: number; timestamp: number };
  transaction: { hash: string };
};

const scopeOf = (event: PoolEvent) => poolScope(event.chainId, event.srcAddress);

/**
 * Add one event to its transaction group and return how the group's kind
 * changed. Re-running the same group never double counts, because the delta is
 * computed from the stored kind.
 */
async function trackTransaction(
  // biome-ignore lint/suspicious/noExplicitAny: Envio handler context type
  context: any,
  event: PoolEvent,
  kind: "deposits" | "spends" | "withdrawals",
): Promise<{ before: PoolTransactionKind; after: PoolTransactionKind }> {
  const pool = scopeOf(event);
  const id = scopedId(pool, event.transaction.hash.toLowerCase());
  const tx = (await context.PoolTransaction.get(id)) ?? {
    id,
    pool,
    deposits: 0,
    spends: 0,
    withdrawals: 0,
    kind: "incomplete",
    blockNumber: event.block.number,
    timestamp: event.block.timestamp,
  };
  const next = { ...tx, [kind]: tx[kind] + 1 };
  next.kind = classifyPoolTransaction(next.deposits, next.spends, next.withdrawals);
  context.PoolTransaction.set(next);
  return { before: tx.kind as PoolTransactionKind, after: next.kind };
}

indexer.onEvent(
  { contract: "Pool", event: "Deposit" },
  async ({ event, context }) => {
    const pool = scopeOf(event);
    const timestamp = event.block.timestamp;
    const leafIndex = Number(event.params.leafIndex);
    context.Note.set({
      id: scopedId(pool, leafIndex),
      pool,
      leafIndex,
      commitment: event.params.commitment,
      ephemeralPk: event.params.ephemeralPk,
      ciphertext: event.params.ciphertext,
      blockNumber: event.block.number,
      timestamp,
      txHash: event.transaction.hash,
    });

    const { before, after } = await trackTransaction(context, event, "deposits");
    const change = kindDelta(before, after);
    const stats = (await context.PoolStats.get(pool)) ?? emptyStats(pool, timestamp);
    context.PoolStats.set({
      ...stats,
      notes: stats.notes + 1,
      anonymitySet: stats.anonymitySet + 1,
      shieldedTransfers: stats.shieldedTransfers + change.shieldedTransfers,
      merges: stats.merges + change.merges,
      updatedAt: timestamp,
    });
    const day = emptyDay(pool, timestamp);
    const today = (await context.DailyStats.get(day.id)) ?? day;
    context.DailyStats.set({ ...today, notes: today.notes + 1 });
  },
);

indexer.onEvent(
  { contract: "Pool", event: "Withdrawal" },
  async ({ event, context }) => {
    const pool = scopeOf(event);
    const timestamp = event.block.timestamp;
    const amount = event.params.amount;
    context.Withdrawal.set({
      id: scopedId(pool, hexId(event.params.nullifier)),
      pool,
      recipient: event.params.recipient.toLowerCase(),
      amount,
      blockNumber: event.block.number,
      timestamp,
      txHash: event.transaction.hash,
    });

    const { before, after } = await trackTransaction(context, event, "withdrawals");
    const change = kindDelta(before, after);
    const stats = (await context.PoolStats.get(pool)) ?? emptyStats(pool, timestamp);
    context.PoolStats.set({
      ...stats,
      withdrawals: stats.withdrawals + 1,
      totalWithdrawn: stats.totalWithdrawn + amount,
      shieldedTransfers: stats.shieldedTransfers + change.shieldedTransfers,
      merges: stats.merges + change.merges,
      updatedAt: timestamp,
    });
    const day = emptyDay(pool, timestamp);
    const today = (await context.DailyStats.get(day.id)) ?? day;
    context.DailyStats.set({
      ...today,
      withdrawals: today.withdrawals + 1,
      withdrawnVolume: today.withdrawnVolume + amount,
    });
  },
);

indexer.onEvent(
  { contract: "Pool", event: "Spend" },
  async ({ event, context }) => {
    const pool = scopeOf(event);
    const timestamp = event.block.timestamp;
    const nullifier = hexId(event.params.nullifier);
    const id = scopedId(pool, nullifier);
    const withdrawal = await context.Withdrawal.get(id);
    context.Nullifier.set({
      id,
      pool,
      nullifier,
      blockNumber: event.block.number,
      timestamp,
      txHash: event.transaction.hash,
      withdrawal_id: withdrawal?.id,
    });

    const { before, after } = await trackTransaction(context, event, "spends");
    const change = kindDelta(before, after);
    const stats = (await context.PoolStats.get(pool)) ?? emptyStats(pool, timestamp);
    context.PoolStats.set({
      ...stats,
      spent: stats.spent + 1,
      anonymitySet: stats.anonymitySet - 1,
      shieldedTransfers: stats.shieldedTransfers + change.shieldedTransfers,
      merges: stats.merges + change.merges,
      updatedAt: timestamp,
    });
    const day = emptyDay(pool, timestamp);
    const today = (await context.DailyStats.get(day.id)) ?? day;
    context.DailyStats.set({ ...today, spent: today.spent + 1 });
  },
);

indexer.onEvent(
  { contract: "Pool", event: "PausedSet" },
  async ({ event, context }) => {
    const pool = scopeOf(event);
    const timestamp = event.block.timestamp;
    const stats = (await context.PoolStats.get(pool)) ?? emptyStats(pool, timestamp);
    context.PoolStats.set({
      ...stats,
      paused: event.params.paused,
      updatedAt: timestamp,
    });
  },
);
