import { indexer } from "envio";
import type { DailyStats, PoolStats } from "envio";

// Pool event order matters for classification (see MaweePool.sol):
//   withdraw → Withdrawal(nullifier) then Spend(nullifier)
//   transfer → Deposit, Deposit, then Spend(nullifier) with no Withdrawal
// so when Spend is processed, a Withdrawal with the same id already exists
// for withdrawals and is absent for shielded transfers.

const GLOBAL = "global";
const DAY = 86_400;

const hexId = (value: string) => value.toLowerCase().replace(/^0x/, "");

function emptyStats(timestamp: number): PoolStats {
  return {
    id: GLOBAL,
    notes: 0,
    spent: 0,
    anonymitySet: 0,
    withdrawals: 0,
    shieldedTransfers: 0,
    totalWithdrawn: 0n,
    accounts: 0,
    paused: false,
    updatedAt: timestamp,
  };
}

export function emptyDay(timestamp: number): DailyStats {
  const dayStart = timestamp - (timestamp % DAY);
  return {
    id: new Date(dayStart * 1000).toISOString().slice(0, 10),
    dayStart,
    notes: 0,
    spent: 0,
    withdrawals: 0,
    withdrawnVolume: 0n,
    newAccounts: 0,
  };
}

indexer.onEvent(
  { contract: "Pool", event: "Deposit" },
  async ({ event, context }) => {
    const timestamp = event.block.timestamp;
    const leafIndex = Number(event.params.leafIndex);
    context.Note.set({
      id: leafIndex.toString(),
      leafIndex,
      commitment: event.params.commitment,
      ephemeralPk: event.params.ephemeralPk,
      ciphertext: event.params.ciphertext,
      blockNumber: event.block.number,
      timestamp,
      txHash: event.transaction.hash,
    });

    const stats = (await context.PoolStats.get(GLOBAL)) ?? emptyStats(timestamp);
    context.PoolStats.set({
      ...stats,
      notes: stats.notes + 1,
      anonymitySet: stats.anonymitySet + 1,
      updatedAt: timestamp,
    });
    const day = emptyDay(timestamp);
    const today = (await context.DailyStats.get(day.id)) ?? day;
    context.DailyStats.set({ ...today, notes: today.notes + 1 });
  },
);

indexer.onEvent(
  { contract: "Pool", event: "Withdrawal" },
  async ({ event, context }) => {
    const timestamp = event.block.timestamp;
    const amount = event.params.amount;
    context.Withdrawal.set({
      id: hexId(event.params.nullifier),
      recipient: event.params.recipient.toLowerCase(),
      amount,
      blockNumber: event.block.number,
      timestamp,
      txHash: event.transaction.hash,
    });

    const stats = (await context.PoolStats.get(GLOBAL)) ?? emptyStats(timestamp);
    context.PoolStats.set({
      ...stats,
      withdrawals: stats.withdrawals + 1,
      totalWithdrawn: stats.totalWithdrawn + amount,
      updatedAt: timestamp,
    });
    const day = emptyDay(timestamp);
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
    const timestamp = event.block.timestamp;
    const id = hexId(event.params.nullifier);
    const withdrawal = await context.Withdrawal.get(id);
    context.Nullifier.set({
      id,
      blockNumber: event.block.number,
      timestamp,
      txHash: event.transaction.hash,
      withdrawal_id: withdrawal?.id,
    });

    const stats = (await context.PoolStats.get(GLOBAL)) ?? emptyStats(timestamp);
    context.PoolStats.set({
      ...stats,
      spent: stats.spent + 1,
      anonymitySet: stats.anonymitySet - 1,
      shieldedTransfers: stats.shieldedTransfers + (withdrawal ? 0 : 1),
      updatedAt: timestamp,
    });
    const day = emptyDay(timestamp);
    const today = (await context.DailyStats.get(day.id)) ?? day;
    context.DailyStats.set({ ...today, spent: today.spent + 1 });
  },
);

indexer.onEvent(
  { contract: "Pool", event: "PausedSet" },
  async ({ event, context }) => {
    const timestamp = event.block.timestamp;
    const stats = (await context.PoolStats.get(GLOBAL)) ?? emptyStats(timestamp);
    context.PoolStats.set({
      ...stats,
      paused: event.params.paused,
      updatedAt: timestamp,
    });
  },
);

export { emptyStats };
