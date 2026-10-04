// Mongo identifiers for the public pool mirror. Every row carries its pool
// scope, and composite `_id`s keep leaf 0 (or one nullifier) of one pool from
// colliding with another pool's. The pool-scopes migration writes the same
// formats; keep them in sync.

import type { PoolScope } from "../../../lib/pools";

export function depositDocId(scope: PoolScope, leafIndex: number): string {
  if (!Number.isSafeInteger(leafIndex) || leafIndex < 0)
    throw new Error("Invalid leaf index.");
  return `${scope}:${leafIndex}`;
}

export function nullifierDocId(scope: PoolScope, nullifierHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(nullifierHex))
    throw new Error("Invalid nullifier.");
  return `${scope}:${nullifierHex}`;
}

/** Per-pool indexer watermark/lease document. */
export function poolStateId(scope: PoolScope): `pool:${PoolScope}` {
  return `pool:${scope}`;
}
