/**
 * Scopes the public pool mirror by pool, so a new active pool and a legacy pool
 * can share one database without leaf-index or nullifier collisions.
 *
 * Unscoped rows (numeric deposit `_id`, bare nullifier `_id`, the singleton
 * "pool" indexer state) all belong to the pool the mirror was built from. That
 * pool must be named explicitly — it is never guessed from the newly configured
 * active address:
 *
 *   MAWEE_LEGACY_POOL_SCOPE=<chainId>:<lowercase pool address> pnpm --filter web migrate:up
 *
 * Re-running is safe. Formats match src/server/modules/deposits/poolScope.ts:
 *   deposits          _id `${scope}:${leafIndex}`  + scope, leafIndex
 *   spent_nullifiers  _id `${scope}:${nullifierHex}` + scope, nullifierHex
 *   indexer_state     _id `pool:${scope}`          + scope
 */

const SCOPE_RE = /^([1-9]\d{0,15}):(0x[0-9a-f]{40})$/;
const NULLIFIER_RE = /^[0-9a-f]{64}$/;
const BATCH = 500;

function legacyScope() {
  const raw = (process.env.MAWEE_LEGACY_POOL_SCOPE ?? "").trim().toLowerCase();
  if (!SCOPE_RE.test(raw)) {
    throw new Error(
      "Set MAWEE_LEGACY_POOL_SCOPE=<chainId>:<pool address> for the pool the existing mirror was built from.",
    );
  }
  return raw;
}

/** The pre-scope state stored `eip155:<chainId>:<address>`. */
const legacyStateScope = (scope) => `eip155:${scope}`;

async function scopeDeposits(deposits, scope) {
  for (;;) {
    const batch = await deposits
      .find({ scope: { $exists: false } })
      .limit(BATCH)
      .toArray();
    if (batch.length === 0) return;
    for (const doc of batch) {
      const { _id, ...rest } = doc;
      if (!Number.isSafeInteger(_id) || _id < 0) {
        throw new Error(`Unexpected unscoped deposit id ${String(_id)}.`);
      }
      // Write the scoped copy before removing the original, so an interrupted
      // run leaves a duplicate that the next run collapses, never a gap.
      await deposits.replaceOne(
        { _id: `${scope}:${_id}` },
        { ...rest, scope, leafIndex: _id },
        { upsert: true },
      );
      await deposits.deleteOne({ _id });
    }
  }
}

async function scopeNullifiers(nullifiers, scope) {
  for (;;) {
    const batch = await nullifiers
      .find({ scope: { $exists: false } })
      .limit(BATCH)
      .toArray();
    if (batch.length === 0) return;
    for (const doc of batch) {
      const { _id, ...rest } = doc;
      if (typeof _id !== "string" || !NULLIFIER_RE.test(_id)) {
        throw new Error("Unexpected unscoped nullifier id.");
      }
      await nullifiers.replaceOne(
        { _id: `${scope}:${_id}` },
        { ...rest, scope, nullifierHex: _id },
        { upsert: true },
      );
      await nullifiers.deleteOne({ _id });
    }
  }
}

async function ensureIndex(collection, key, options) {
  // A fresh database has no collection yet; createIndex creates it.
  const indexes = await collection.indexes().catch((error) => {
    if (error?.codeName === "NamespaceNotFound") return [];
    throw error;
  });
  if (!indexes.some((index) => index.name === options.name)) {
    await collection.createIndex(key, options);
  }
}

/**
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const up = async (db) => {
  const deposits = db.collection("deposits");
  const nullifiers = db.collection("spent_nullifiers");
  const states = db.collection("indexer_state");

  const oldState = await states.findOne({ _id: "pool" });
  const unscoped =
    oldState !== null ||
    (await deposits.countDocuments(
      { scope: { $exists: false } },
      { limit: 1 },
    )) > 0 ||
    (await nullifiers.countDocuments(
      { scope: { $exists: false } },
      { limit: 1 },
    )) > 0;

  if (unscoped) {
    const scope = legacyScope();
    if (oldState?.scope && oldState.scope !== legacyStateScope(scope)) {
      throw new Error(
        `MAWEE_LEGACY_POOL_SCOPE does not match the mirrored pool (${oldState.scope}).`,
      );
    }
    await scopeDeposits(deposits, scope);
    await scopeNullifiers(nullifiers, scope);
    if (oldState) {
      const { _id, leaseOwner, leaseUntil, ...rest } = oldState;
      await states.updateOne(
        { _id: `pool:${scope}` },
        { $setOnInsert: { ...rest, scope } },
        { upsert: true },
      );
      await states.deleteOne({ _id: "pool" });
    }
  }

  const scoped = { scope: { $exists: true } };
  await ensureIndex(
    deposits,
    { scope: 1, leafIndex: 1 },
    {
      name: "scope_leaf_unique",
      unique: true,
      partialFilterExpression: scoped,
    },
  );
  await ensureIndex(deposits, { scope: 1, block: 1 }, { name: "scope_block" });
  await ensureIndex(
    nullifiers,
    { scope: 1, block: 1 },
    { name: "scope_block" },
  );
};

/**
 * Restores the legacy pool's rows to their unscoped shape. Rows of any other
 * pool are left in place: rolling back configuration never deletes history.
 *
 * @param db {import('mongodb').Db}
 * @returns {Promise<void>}
 */
export const down = async (db) => {
  const scope = legacyScope();
  const deposits = db.collection("deposits");
  const nullifiers = db.collection("spent_nullifiers");
  const states = db.collection("indexer_state");

  for (const doc of await deposits.find({ scope }).toArray()) {
    const { _id, scope: _scope, leafIndex, ...rest } = doc;
    await deposits.replaceOne({ _id: leafIndex }, rest, { upsert: true });
    await deposits.deleteOne({ _id });
  }
  for (const doc of await nullifiers.find({ scope }).toArray()) {
    const { _id, scope: _scope, nullifierHex, ...rest } = doc;
    await nullifiers.replaceOne({ _id: nullifierHex }, rest, { upsert: true });
    await nullifiers.deleteOne({ _id });
  }
  const state = await states.findOne({ _id: `pool:${scope}` });
  if (state) {
    const { _id, leaseOwner, leaseUntil, ...rest } = state;
    await states.updateOne(
      { _id: "pool" },
      { $set: { ...rest, scope: legacyStateScope(scope) } },
      { upsert: true },
    );
    await states.deleteOne({ _id });
  }
  for (const [collection, name] of [
    [deposits, "scope_leaf_unique"],
    [deposits, "scope_block"],
    [nullifiers, "scope_block"],
  ]) {
    await collection.dropIndex(name).catch(() => {});
  }
};
