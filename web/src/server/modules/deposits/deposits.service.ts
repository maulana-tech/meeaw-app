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
  publicClient,
  registryAddress,
} from "../../../lib/chain";
import { bytesToHex } from "../../../lib/crypto";
import {
  activePool,
  findPool,
  listPools,
  type PoolDescriptor,
} from "../../../lib/pools";
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
  envioRegistryAccounts,
} from "../../lib/envio";
import { DepositIndexGapError, UnknownPoolError } from "./deposits.errors";
import type {
  DepositOutput,
  PoolSnapshotOutput,
  PoolStatsOutput,
} from "./deposits.schema";
import { depositDocId, nullifierDocId, poolStateId } from "./poolScope";

const LEASE_MS = 50_000;
const STALE_AFTER_MS = 120_000;
// Bounds one cron run (each chunk is one eth_getLogs call).
const MAX_CHUNKS_PER_RUN = 400;

const startBlock = (pool: PoolDescriptor) => Math.max(0, pool.deployBlock - 1);

/**
 * With Envio configured it serves every manifest pool (its config must list
 * all of them, legacy included); otherwise the RPC poller mirrors each pool.
 */
const servedByEnvio = (_pool: PoolDescriptor) => envioConfigured();

function resolvePoolScope(scope: string | undefined): PoolDescriptor {
  if (scope === undefined) return activePool();
  const pool = findPool(scope);
  if (!pool) throw new UnknownPoolError();
  return pool;
}

export type PoolSyncResult = {
  pool: string;
  status: "synced" | "skipped" | "degraded";
  fromBlock: number;
  toBlock: number;
  latestBlock: number;
  depositsUpserted: number;
  nullifiersUpserted: number;
  durationMs: number;
  error?: string;
};

async function acquireLease(
  pool: PoolDescriptor,
  owner: string,
): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const states = await getIndexerState();
  try {
    const state = await states.findOneAndUpdate(
      {
        _id: poolStateId(pool.scope),
        $or: [
          { leaseUntil: { $exists: false } },
          { leaseUntil: { $lte: now } },
          { leaseOwner: owner },
        ],
      },
      {
        $set: { leaseOwner: owner, leaseUntil },
        $setOnInsert: {
          scope: pool.scope,
          publishedBlock: startBlock(pool),
          publishedLeafIndex: -1,
          health: "degraded",
          updatedAt: now,
        },
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

async function releaseLease(
  pool: PoolDescriptor,
  owner: string,
): Promise<void> {
  const states = await getIndexerState();
  await states.updateOne(
    { _id: poolStateId(pool.scope), leaseOwner: owner },
    { $unset: { leaseOwner: "", leaseUntil: "" } },
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

/** Mirror one pool's public events (the active pool by default). */
export async function syncPoolIndex(
  pool: PoolDescriptor = activePool(),
): Promise<PoolSyncResult> {
  const startedAt = Date.now();
  const owner = randomUUID();
  const stateId = poolStateId(pool.scope);
  // With Envio HyperIndex serving this pool, Envio is the mirror; nothing to poll.
  if (servedByEnvio(pool) || !(await acquireLease(pool, owner))) {
    return {
      pool: pool.scope,
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
  let leaseError: Error | null = null;
  let renewal = Promise.resolve();
  let finished = false;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  const renewLease = () => {
    heartbeat = setTimeout(
      () => {
        renewal = states
          .updateOne(
            { _id: stateId, leaseOwner: owner },
            { $set: { leaseUntil: new Date(Date.now() + LEASE_MS) } },
          )
          .then((result) => {
            if (result.matchedCount === 0)
              leaseError = new Error("Pool index lease was lost.");
          })
          .catch(() => {
            leaseError = new Error("Pool index lease could not be renewed.");
          })
          .finally(() => {
            if (!finished && !leaseError) renewLease();
          });
      },
      Math.floor(LEASE_MS / 3),
    );
    heartbeat.unref?.();
  };
  renewLease();
  let fromBlock = startBlock(pool);
  try {
    // Each pool has its own watermark; configuring a new active pool starts a
    // fresh one and never deletes another pool's mirrored history.
    const state = await states.findOne({ _id: stateId });
    fromBlock = state?.publishedBlock ?? startBlock(pool);

    const { logs, scannedTo, latestBlock } = await fetchPoolLogs({
      afterBlock: BigInt(fromBlock),
      blockRange: getServerEnv().MONAD_LOGS_BLOCK_RANGE,
      maxChunks: MAX_CHUNKS_PER_RUN,
      pool,
    });
    const timestamps = await blockTimestamps(logs.map((l) => l.blockNumber));

    const depositOps = [];
    const nullifierOps = [];
    for (const log of logs) {
      const ts = timestamps.get(log.blockNumber) ?? new Date();
      if (log.deposit) {
        depositOps.push({
          updateOne: {
            filter: { _id: depositDocId(pool.scope, log.deposit.leafIndex) },
            update: {
              $set: {
                scope: pool.scope,
                leafIndex: log.deposit.leafIndex,
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
            filter: {
              _id: nullifierDocId(pool.scope, log.spent.nullifierHex),
            },
            update: {
              $set: {
                scope: pool.scope,
                nullifierHex: log.spent.nullifierHex,
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
        address: pool.address,
        abi: maweePoolAbi,
        functionName: "nextIndex",
        blockNumber: scannedTo,
      }),
      deposits.countDocuments({
        scope: pool.scope,
        block: { $lte: Number(scannedTo) },
      }),
    ]);
    if (onChainCount !== mirroredCount) {
      throw new DepositIndexGapError(onChainCount, mirroredCount);
    }

    const indexedAt = new Date();
    await renewal;
    if (leaseError) throw leaseError;
    const published = await states.updateOne(
      { _id: stateId, leaseOwner: owner },
      {
        $set: {
          scope: pool.scope,
          publishedBlock: Number(scannedTo),
          publishedLeafIndex: onChainCount - 1,
          indexedAt,
          updatedAt: indexedAt,
          health: "healthy",
        },
        $unset: { lastError: "" },
      },
    );
    if (published.matchedCount === 0)
      throw new Error("Pool index lease was lost before publication.");

    return {
      pool: pool.scope,
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
      { _id: stateId, leaseOwner: owner },
      {
        $set: {
          health: "degraded",
          lastError: message,
          updatedAt: new Date(),
        },
      },
    );
    return {
      pool: pool.scope,
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
    finished = true;
    clearTimeout(heartbeat);
    await renewal;
    await releaseLease(pool, owner);
  }
}

/** Cron entry point: every configured pool, one after another. */
export async function syncAllPoolIndexes(): Promise<{
  status: PoolSyncResult["status"];
  pools: PoolSyncResult[];
}> {
  const pools: PoolSyncResult[] = [];
  for (const pool of listPools()) pools.push(await syncPoolIndex(pool));
  const status = pools.some((r) => r.status === "degraded")
    ? "degraded"
    : pools.some((r) => r.status === "synced")
      ? "synced"
      : "skipped";
  return { status, pools };
}

function toDepositOutput(d: DepositDoc): DepositOutput {
  return {
    leafIndex: d.leafIndex,
    commitmentHex: bytesToHex(d.commitment.buffer),
    ephemeralPkHex: bytesToHex(d.ephemeralPk.buffer),
    ciphertextHex: bytesToHex(d.ciphertext.buffer),
    block: d.block,
    txHash: d.txHash,
    ts: d.ts.toISOString(),
  };
}

const healInFlight = new Map<string, Promise<PoolSyncResult>>();
const lastHealAttempt = new Map<string, number>();
const HEAL_COOLDOWN_MS = 15_000;

function healMirror(pool: PoolDescriptor): Promise<PoolSyncResult> {
  const pending = healInFlight.get(pool.scope);
  if (pending) return pending;
  lastHealAttempt.set(pool.scope, Date.now());
  const heal = syncPoolIndex(pool).finally(() => {
    healInFlight.delete(pool.scope);
  });
  healInFlight.set(pool.scope, heal);
  return heal;
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
  pool: PoolDescriptor,
  afterLeafIndex: number,
  spentAfterBlock: number,
): Promise<PoolSnapshotOutput> {
  const meta = await envioMeta(chain.id);
  const publishedBlock = meta?.progressBlock ?? 0;
  const [notes, spent] = meta
    ? await Promise.all([
        envioNotesAfter(pool.scope, afterLeafIndex, publishedBlock),
        envioNullifiersBetween(pool.scope, spentAfterBlock, publishedBlock),
      ])
    : [[], []];

  // Merkle proofs need every leaf, so only publish a contiguous prefix. The
  // notes are this pool's only, so another pool's leaf can never fill a gap.
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
      nullifierHex: strip0x(row.nullifier),
      block: row.blockNumber,
      ts: new Date(row.timestamp * 1000).toISOString(),
    })),
    index: {
      poolAddress: pool.address,
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

/** Privacy stats (anonymity set etc.) for one pool, the active pool by default. */
export async function getPoolStats(
  poolScope?: string,
): Promise<PoolStatsOutput> {
  const pool = resolvePoolScope(poolScope);
  if (envioConfigured()) {
    const [stats, accounts] = await Promise.all([
      envioPoolStats(pool.scope),
      envioRegistryAccounts(`${chain.id}:${registryAddress.toLowerCase()}`),
    ]);
    return {
      source: "envio",
      notes: stats?.notes ?? 0,
      spent: stats?.spent ?? 0,
      anonymitySet: stats?.anonymitySet ?? 0,
      withdrawals: stats?.withdrawals ?? null,
      shieldedTransfers: stats?.shieldedTransfers ?? null,
      merges: stats?.merges ?? null,
      accounts,
      paused: stats?.paused ?? false,
    };
  }
  const [deposits, nullifiers] = await Promise.all([
    getDeposits(),
    getSpentNullifiers(),
  ]);
  const { scope } = pool;
  const [notes, spent] = await Promise.all([
    deposits.countDocuments({ scope }),
    nullifiers.countDocuments({ scope }),
  ]);
  return {
    source: "rpc",
    notes,
    spent,
    anonymitySet: Math.max(0, notes - spent),
    withdrawals: null,
    shieldedTransfers: null,
    merges: null,
    accounts: null,
    paused: false,
  };
}

/**
 * Public mirror rows for one configured pool (the active pool by default).
 * Unknown scopes are rejected rather than served another pool's leaves.
 */
export async function getPoolSnapshot(
  afterLeafIndex: number,
  spentAfterBlock: number,
  poolScope?: string,
): Promise<PoolSnapshotOutput> {
  const pool = resolvePoolScope(poolScope);
  if (servedByEnvio(pool)) {
    return getEnvioSnapshot(pool, afterLeafIndex, spentAfterBlock);
  }
  const startedAt = Date.now();
  const [states, deposits, nullifiers] = await Promise.all([
    getIndexerState(),
    getDeposits(),
    getSpentNullifiers(),
  ]);
  const stateId = poolStateId(pool.scope);
  let state = await states.findOne({ _id: stateId });

  const published =
    state?.scope === pool.scope && state.indexedAt !== undefined;
  const cooled =
    Date.now() - (lastHealAttempt.get(pool.scope) ?? 0) > HEAL_COOLDOWN_MS;
  const healing = healInFlight.has(pool.scope);
  if (!published) {
    if (healing || cooled) {
      await healMirror(pool).catch(() => {});
      state = await states.findOne({ _id: stateId });
    }
  } else {
    const isStale =
      !state?.indexedAt ||
      Date.now() - state.indexedAt.getTime() > STALE_AFTER_MS;
    if (isStale && (healing || cooled)) void healMirror(pool).catch(() => {});
  }
  const configuredPool = state?.scope === pool.scope;
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
      .find({
        scope: pool.scope,
        leafIndex: { $gt: afterLeafIndex, $lte: publishedLeafIndex },
      })
      .sort({ leafIndex: 1 })
      .toArray(),
    nullifiers
      .find({
        scope: pool.scope,
        block: { $gt: spentAfterBlock, $lte: publishedBlock },
      })
      .sort({ block: 1, _id: 1 })
      .toArray(),
  ]);

  const snapshot: PoolSnapshotOutput = {
    deposits: depositDocs.map(toDepositOutput),
    spentNullifiers: spentDocs.map((doc) => ({
      nullifierHex: doc.nullifierHex,
      block: doc.block,
      ts: doc.ts.toISOString(),
    })),
    index: {
      poolAddress: pool.address,
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
      pool: pool.scope,
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
