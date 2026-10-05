import { api } from "../trpc/client";
import type { DepositEvent } from "./chain";
import { hexToBytes } from "./crypto";
import { activePool, mirrorScope, type PoolDescriptor } from "./pools";

const DB_NAME = "mawee-pool-mirror";
const STORE_NAME = "mirrors";
const DB_VERSION = 1;

export type PoolMirror = {
  scope: string;
  deposits: DepositEvent[];
  spentNullifiers: string[];
  spentAtByNullifier?: Record<string, string>;
  publishedBlock: number;
  publishedLeafIndex: number;
  indexedAt: string;
  health: "healthy" | "stale" | "degraded";
  hydrated: boolean;
};

// Every pool has its own mirror (keyed by chain and pool address), so leaf 0 of
// a legacy pool never mixes with leaf 0 of the active pool, and configuring a
// new active pool leaves the legacy mirror intact.
const memory = new Map<string, PoolMirror>();
const inFlight = new Map<string, Promise<PoolMirror>>();

function emptyMirror(pool: PoolDescriptor): PoolMirror {
  return {
    scope: mirrorScope(pool),
    deposits: [],
    spentNullifiers: [],
    spentAtByNullifier: {},
    publishedBlock: 0,
    publishedLeafIndex: -1,
    indexedAt: new Date(0).toISOString(),
    health: "degraded",
    hydrated: false,
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "scope" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedDb(scope: string): Promise<PoolMirror | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .get(scope);
      request.onsuccess = () =>
        resolve((request.result as PoolMirror | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeIndexedDb(mirror: PoolMirror): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(mirror);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadPoolMirror(
  pool: PoolDescriptor = activePool(),
): Promise<PoolMirror> {
  const scope = mirrorScope(pool);
  const cached = memory.get(scope);
  if (cached) return cached;
  try {
    const persisted = await readIndexedDb(scope);
    if (persisted) {
      const hydrated = { ...persisted, hydrated: true };
      memory.set(scope, hydrated);
      return hydrated;
    }
  } catch {
    // IndexedDB can be unavailable in private modes; use the session mirror.
  }
  const empty = emptyMirror(pool);
  memory.set(scope, empty);
  return empty;
}

async function fetchAndMerge(pool: PoolDescriptor): Promise<PoolMirror> {
  const current = await loadPoolMirror(pool);
  const snapshot = await api.deposits.snapshot.query({
    pool: pool.scope,
    afterLeafIndex: current.publishedLeafIndex,
    spentAfterBlock: current.publishedBlock,
  });
  const responseScope = `${snapshot.index.network}:${snapshot.index.poolAddress.toLowerCase()}`;
  // Never merge another pool's leaves into this mirror.
  if (responseScope !== current.scope)
    throw new Error("The pool index answered for a different pool.");
  const base = current;
  const deposits = new Map(base.deposits.map((row) => [row.leafIndex, row]));
  for (const row of snapshot.deposits) {
    deposits.set(row.leafIndex, {
      leafIndex: row.leafIndex,
      commitment: hexToBytes(row.commitmentHex),
      ephemeralPk: hexToBytes(row.ephemeralPkHex),
      ciphertext: hexToBytes(row.ciphertextHex),
      receivedAt: row.ts,
    });
  }
  const spent = new Set(base.spentNullifiers);
  const spentAtByNullifier = { ...base.spentAtByNullifier };
  for (const row of snapshot.spentNullifiers) {
    spent.add(row.nullifierHex);
    spentAtByNullifier[row.nullifierHex] = row.ts;
  }

  const merged: PoolMirror = {
    scope: responseScope,
    deposits: [...deposits.values()].sort((a, b) => a.leafIndex - b.leafIndex),
    spentNullifiers: [...spent],
    spentAtByNullifier,
    publishedBlock: snapshot.index.publishedBlock,
    publishedLeafIndex: snapshot.index.publishedLeafIndex,
    indexedAt: snapshot.index.indexedAt,
    health: snapshot.index.health,
    hydrated: true,
  };
  memory.set(responseScope, merged);
  try {
    await writeIndexedDb(merged);
  } catch {
    // The in-memory result remains valid for this session.
  }
  return merged;
}

export function refreshPoolMirror(
  pool: PoolDescriptor = activePool(),
): Promise<PoolMirror> {
  const scope = mirrorScope(pool);
  const pending = inFlight.get(scope);
  if (pending) return pending;
  const refresh = fetchAndMerge(pool).finally(() => inFlight.delete(scope));
  inFlight.set(scope, refresh);
  return refresh;
}
