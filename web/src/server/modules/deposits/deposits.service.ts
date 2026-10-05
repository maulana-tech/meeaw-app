// Mongo-backed, asynchronous mirror of public pool events. Dashboard reads are
// bounded by the last published watermark and never wait for the Monad RPC.

import "server-only";
import { randomUUID } from "node:crypto";
import { Binary, MongoServerError } from "mongodb";
import { getServerEnv } from "../../../env.server";
import { maweePoolAbi } from "../../../lib/abi";
import {
  chain,
  fetchPoolLogs,
  network,
  poolAddress,
  poolDeployBlock,
  publicClient,
} from "../../../lib/chain";
import { bytesToHex } from "../../../lib/crypto";
import {
  type DepositDoc,
  getDeposits,
  getIndexerState,
  getSpentNullifiers,
} from "../../db/mongo";
import {
  envioConfigured,
  envioMeta,
  envioNotesAfter,
  envioNullifiersBetween,
  envioPoolStats,
} from "../../lib/envio";
import { DepositIndexGapError } from "./deposits.errors";
import type {
  DepositOutput,
  PoolSnapshotOutput,
  PoolStatsOutput,
} from "./deposits.schema";

const LEASE_MS = 50_000;
const STALE_AFTER_MS = 120_000;
// Bounds one cron run (each chunk is one eth_getLogs call).
const MAX_CHUNKS_PER_RUN = 400;

const scope = () => `${network}:${poolAddress.toLowerCase()}`;
const poolConfigured = () => BigInt(poolAddress) !== 0n;
const startBlock = () =>
  Number(poolDeployBlock > 0n ? poolDeployBlock - 1n : 0n);

export type PoolSyncResult = {
  status: "synced" | "skipped" | "degraded";
  fromBlock: number;
  toBlock: number;
  latestBlock: number;
  depositsUpserted: number;
  nullifiersUpserted: number;
  durationMs: number;
  error?: string;
};

async function acquireLease(owner: string): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const states = await getIndexerState();
  try {
    const state = await states.findOneAndUpdate(
      {
        _id: "pool",
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: now } },
          { leaseOwner: owner },
        ],
      },
      {
        $set: { leaseOwner: owner, leaseUntil },
        $setOnInsert: { updatedAt: now },
      },
      { upsert: true, returnDocument: "after" },
    );
    return state?.leaseOwner === owner;
  } catch (error) {
    // An existing, leased singleton makes the upsert collide on `_id`.
    if (error instanceof MongoServerError && error.code === 11000) return false;
    throw error;
  }
}

async function releaseLease(owner: string): Promise<void> {
  const states = await getIndexerState();
  await states.updateOne(
    { _id: "pool", leaseOwner: owner },
    { $unset: { leaseOwner: "", leaseUntil: "" } },
  );
}

/** A new chain or pool address invalidates every mirrored row. */
async function resetForConfiguredPool(owner: string): Promise<void> {
  const [deposits, nullifiers, states] = await Promise.all([
    getDeposits(),
    getSpentNullifiers(),
    getIndexerState(),
  ]);
  await Promise.all([deposits.deleteMany({}), nullifiers.deleteMany({})]);
  await states.updateOne(
    { _id: "pool", leaseOwner: owner },
    {
      $set: {
        scope: scope(),
        publishedBlock: startBlock(),
        publishedLeafIndex: -1,
        updatedAt: new Date(),
        health: "degraded",
        lastError: "Pool mirror is awaiting its initial synchronization",
      },
      $unset: { indexedAt: "" },
    },
  );
}

async function blockTimestamps(blocks: bigint[]): Promise<Map<bigint, Date>> {
  const unique = [...new Set(blocks)];
  const out = new Map<bigint, Date>();
  await Promise.all(
    unique.map(async (blockNumber) => {
      const block = await publicClient.getBlock({ blockNumber });
      out.set(blockNumber, new Date(Number(block.timestamp) * 1000));
    }),
  );
  return out;
}

export async function syncPoolIndex(): Promise<PoolSyncResult> {
  const startedAt = Date.now();
  const owner = randomUUID();
  // With Envio HyperIndex configured, Envio is the mirror; nothing to poll.
  // Without a deployed pool there is nothing to index either, and scanning
  // eth_getLogs from block 0 would tie up the request for minutes.
  if (envioConfigured() || !poolConfigured() || !(await acquireLease(owner))) {
    return {
      status: "skipped",
      fromBlock: 0,
      toBlock: 0,
      latestBlock: 0,
      depositsUpserted: 0,
      nullifiersUpserted: 0,
      durationMs: Date.now() - startedAt,
    };
  }

  const states = await getIndexerState();
  let fromBlock = startBlock();
  try {
    let state = await states.findOne({ _id: "pool" });
    if (state?.scope !== scope()) {
      await resetForConfiguredPool(owner);
      state = await states.findOne({ _id: "pool" });
    }
    fromBlock = state?.publishedBlock ?? startBlock();

    const { logs, scannedTo, latestBlock } = await fetchPoolLogs({
      afterBlock: BigInt(fromBlock),
      blockRange: getServerEnv().MONAD_LOGS_BLOCK_RANGE,
      maxChunks: MAX_CHUNKS_PER_RUN,
    });
    const timestamps = await blockTimestamps(logs.map((l) => l.blockNumber));

    const depositOps = [];
    const nullifierOps = [];
    for (const log of logs) {
      const ts = timestamps.get(log.blockNumber) ?? new Date();
      if (log.deposit) {
        depositOps.push({
          updateOne: {
            filter: { _id: log.deposit.leafIndex },
            update: {
              $set: {
                commitment: new Binary(Buffer.from(log.deposit.commitment)),
                ephemeralPk: new Binary(Buffer.from(log.deposit.ephemeralPk)),
                ciphertext: new Binary(Buffer.from(log.deposit.ciphertext)),
                block: Number(log.blockNumber),
                txHash: log.txHash,
                ts,
              },
            },
            upsert: true,
          },
        });
      }
      if (log.spent) {
        nullifierOps.push({
          updateOne: {
            filter: { _id: log.spent.nullifierHex },
            update: {
              $set: {
                block: Number(log.blockNumber),
                txHash: log.txHash,
                ts,
              },
            },
            upsert: true,
          },
        });
      }
    }

    const [deposits, nullifiers] = await Promise.all([
      getDeposits(),
      getSpentNullifiers(),
    ]);
    await Promise.all([
      depositOps.length
        ? deposits.bulkWrite(depositOps, { ordered: false })
        : Promise.resolve(),
      nullifierOps.length
        ? nullifiers.bulkWrite(nullifierOps, { ordered: false })
        : Promise.resolve(),
    ]);

    // Integrity check at the exact block we scanned up to: every leaf the
    // contract had inserted by then must be mirrored.
    const [onChainCount, mirroredCount] = await Promise.all([
      publicClient.readContract({
        address: poolAddress,
        abi: maweePoolAbi,
        functionName: "nextIndex",
        blockNumber: scannedTo,
      }),
      deposits.countDocuments({ block: { $lte: Number(scannedTo) } }),
    ]);
    if (onChainCount !== mirroredCount) {
      throw new DepositIndexGapError(onChainCount, mirroredCount);
    }

    const indexedAt = new Date();
    await states.updateOne(
      { _id: "pool", leaseOwner: owner },
      {
        $set: {
          scope: scope(),
          publishedBlock: Number(scannedTo),
          publishedLeafIndex: onChainCount - 1,
          indexedAt,
          updatedAt: indexedAt,
          health: "healthy",
        },
        $unset: { lastError: "" },
      },
    );

    return {
      status: "synced",
      fromBlock,
      toBlock: Number(scannedTo),
      latestBlock: Number(latestBlock),
      depositsUpserted: depositOps.length,
      nullifiersUpserted: nullifierOps.length,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Indexer sync failed";
    await states.updateOne(
      { _id: "pool", leaseOwner: owner },
      {
        $set: {
          health: "degraded",
          lastError: message,
          updatedAt: new Date(),
        },
      },
    );
    return {
      status: "degraded",
      fromBlock,
      toBlock: fromBlock,
      latestBlock: fromBlock,
      depositsUpserted: 0,
      nullifiersUpserted: 0,
      durationMs: Date.now() - startedAt,
      error: message,
    };
  } finally {
    await releaseLease(owner);
  }
}

function toDepositOutput(d: DepositDoc): DepositOutput {
  return {
    leafIndex: d._id,
    commitmentHex: bytesToHex(d.commitment.buffer),
    ephemeralPkHex: bytesToHex(d.ephemeralPk.buffer),
    ciphertextHex: bytesToHex(d.ciphertext.buffer),
    block: d.block,
    txHash: d.txHash,
    ts: d.ts.toISOString(),
  };
}

let healInFlight: Promise<PoolSyncResult> | null = null;
let lastHealAttempt = 0;
const HEAL_COOLDOWN_MS = 15_000;

function healMirror(): Promise<PoolSyncResult> {
  if (healInFlight) return healInFlight;
  lastHealAttempt = Date.now();
  healInFlight = syncPoolIndex().finally(() => {
    healInFlight = null;
  });
  return healInFlight;
}

const strip0x = (hex: string) =>
  (hex.startsWith("0x") ? hex.slice(2) : hex).toLowerCase();

function toDate(value: string | number | null): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/**
 * Snapshot served from Envio HyperIndex. Envio's progress block is the
 * watermark; rows beyond it are excluded so client watermarks never skip data.
 */
async function getEnvioSnapshot(
  afterLeafIndex: number,
  spentAfterBlock: number,
): Promise<PoolSnapshotOutput> {
  const meta = await envioMeta(chain.id);
  const publishedBlock = meta?.progressBlock ?? 0;
  const [notes, spent] = meta
    ? await Promise.all([
        envioNotesAfter(afterLeafIndex, publishedBlock),
        envioNullifiersBetween(spentAfterBlock, publishedBlock),
      ])
    : [[], []];

  // Merkle proofs need every leaf, so only publish a contiguous prefix.
  const deposits: DepositOutput[] = [];
  let expected = afterLeafIndex + 1;
  for (const note of notes) {
    if (note.leafIndex !== expected) break;
    deposits.push({
      leafIndex: note.leafIndex,
      commitmentHex: strip0x(note.commitment),
      ephemeralPkHex: strip0x(note.ephemeralPk),
      ciphertextHex: strip0x(note.ciphertext),
      block: note.blockNumber,
      txHash: note.txHash,
      ts: new Date(note.timestamp * 1000).toISOString(),
    });
    expected += 1;
  }
  const gap = deposits.length !== notes.length;
  if (gap) {
    console.warn(
      `[pool-snapshot] Envio leaf gap after ${expected - 1}; serving the contiguous prefix`,
    );
  }

  const indexedAt = toDate(meta?.progressBlockTime ?? null);
  const stale = !indexedAt || Date.now() - indexedAt.getTime() > STALE_AFTER_MS;
  return {
    deposits,
    spentNullifiers: spent.map((row) => ({
      nullifierHex: strip0x(row.id),
      block: row.blockNumber,
      ts: new Date(row.timestamp * 1000).toISOString(),
    })),
    index: {
      poolAddress,
      network,
      // A gap means a later leaf is missing; hold the spend watermark back so
      // nothing is skipped once the gap fills.
      publishedBlock: gap ? Math.max(0, spentAfterBlock) : publishedBlock,
      publishedLeafIndex: expected - 1,
      indexedAt: (indexedAt ?? new Date(0)).toISOString(),
      health: !meta?.isReady || gap ? "degraded" : stale ? "stale" : "healthy",
    },
  };
}

/** Pool-wide privacy stats (anonymity set etc.). */
export async function getPoolStats(): Promise<PoolStatsOutput> {
  if (envioConfigured()) {
    const stats = await envioPoolStats();
    return {
      source: "envio",
      notes: stats?.notes ?? 0,
      spent: stats?.spent ?? 0,
      anonymitySet: stats?.anonymitySet ?? 0,
      withdrawals: stats?.withdrawals ?? null,
      shieldedTransfers: stats?.shieldedTransfers ?? null,
      accounts: stats?.accounts ?? null,
      paused: stats?.paused ?? false,
    };
  }
  const [deposits, nullifiers] = await Promise.all([
    getDeposits(),
    getSpentNullifiers(),
  ]);
  const [notes, spent] = await Promise.all([
    deposits.countDocuments(),
    nullifiers.countDocuments(),
  ]);
  return {
    source: "rpc",
    notes,
    spent,
    anonymitySet: Math.max(0, notes - spent),
    withdrawals: null,
    shieldedTransfers: null,
    accounts: null,
    paused: false,
  };
}

export async function getPoolSnapshot(
  afterLeafIndex: number,
  spentAfterBlock: number,
): Promise<PoolSnapshotOutput> {
  if (envioConfigured()) {
    return getEnvioSnapshot(afterLeafIndex, spentAfterBlock);
  }
  const startedAt = Date.now();
  const [states, deposits, nullifiers] = await Promise.all([
    getIndexerState(),
    getDeposits(),
    getSpentNullifiers(),
  ]);
  let state = await states.findOne({ _id: "pool" });

  const published = state?.scope === scope() && state.indexedAt !== undefined;
  const cooled = Date.now() - lastHealAttempt > HEAL_COOLDOWN_MS;
  if (!published) {
    if (healInFlight || cooled) {
      await healMirror().catch(() => {});
      state = await states.findOne({ _id: "pool" });
    }
  } else {
    const isStale =
      !state?.indexedAt ||
      Date.now() - state.indexedAt.getTime() > STALE_AFTER_MS;
    if (isStale && (healInFlight || cooled)) void healMirror().catch(() => {});
  }
  const configuredPool = state?.scope === scope();
  const publishedBlock = configuredPool ? (state?.publishedBlock ?? 0) : 0;
  const publishedLeafIndex = configuredPool
    ? (state?.publishedLeafIndex ?? -1)
    : -1;
  const indexedAt = configuredPool ? state?.indexedAt : undefined;
  const stale = !indexedAt || Date.now() - indexedAt.getTime() > STALE_AFTER_MS;
  const health =
    !configuredPool || state?.health === "degraded"
      ? "degraded"
      : stale
        ? "stale"
        : "healthy";

  const [depositDocs, spentDocs] = await Promise.all([
    deposits
      .find({ _id: { $gt: afterLeafIndex, $lte: publishedLeafIndex } })
      .sort({ _id: 1 })
      .toArray(),
    nullifiers
      .find({ block: { $gt: spentAfterBlock, $lte: publishedBlock } })
      .sort({ block: 1, _id: 1 })
      .toArray(),
  ]);

  const snapshot: PoolSnapshotOutput = {
    deposits: depositDocs.map(toDepositOutput),
    spentNullifiers: spentDocs.map((doc) => ({
      nullifierHex: doc._id,
      block: doc.block,
      ts: doc.ts.toISOString(),
    })),
    index: {
      poolAddress,
      network,
      publishedBlock: Math.max(0, publishedBlock),
      publishedLeafIndex,
      indexedAt: indexedAt?.toISOString() ?? new Date(0).toISOString(),
      health,
    },
  };
  console.info(
    "[pool-snapshot]",
    JSON.stringify({
      durationMs: Date.now() - startedAt,
      deposits: snapshot.deposits.length,
      nullifiers: snapshot.spentNullifiers.length,
      publishedBlock,
      health,
    }),
  );
  return snapshot;
}

// Compatibility query for callers deployed before `deposits.snapshot`.
export async function listDeposits(since: number): Promise<DepositOutput[]> {
  const snapshot = await getPoolSnapshot(since, Number.MAX_SAFE_INTEGER);
  return snapshot.deposits;
}
