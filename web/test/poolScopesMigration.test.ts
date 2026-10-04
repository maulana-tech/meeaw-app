// @vitest-environment node
import { Binary, type Db } from "mongodb";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { down, up } from "../migrations/20261005090000-pool-scopes.js";
import {
  type IsolatedDb,
  mongoAvailable,
  openIsolatedDb,
} from "./helpers/mongoTestDb";

const OLD = "0x00000000000000000000000000000000000000b0";
const SCOPE = `10143:${OLD}`;
const OTHER = "10143:0x00000000000000000000000000000000000000c0";
const NULLIFIER = "ab".repeat(32);

let available = false;
beforeAll(async () => {
  available = await mongoAvailable();
});

async function seedLegacy(db: Db) {
  const deposits = db.collection<Record<string, unknown>>("deposits");
  for (const leaf of [0, 1, 2]) {
    await deposits.insertOne({
      _id: leaf as unknown as string,
      commitment: new Binary(Buffer.alloc(32, leaf)),
      ephemeralPk: new Binary(Buffer.alloc(32, 9)),
      ciphertext: new Binary(Buffer.alloc(8, 7)),
      block: 100 + leaf,
      txHash: `0x${leaf}`,
      ts: new Date(0),
    });
  }
  await db.collection<Record<string, unknown>>("spent_nullifiers").insertOne({
    _id: NULLIFIER,
    block: 101,
    txHash: "0xspend",
    ts: new Date(0),
  });
  await db.collection<Record<string, unknown>>("indexer_state").insertOne({
    _id: "pool",
    scope: `eip155:${SCOPE}`,
    publishedBlock: 102,
    publishedLeafIndex: 2,
    health: "healthy",
    updatedAt: new Date(0),
    leaseOwner: "stale-worker",
  });
}

describe("pool-scopes migration (real MongoDB)", () => {
  let handle: IsolatedDb | null = null;

  beforeEach(async (ctx) => {
    if (!available) ctx.skip();
    handle = await openIsolatedDb();
    process.env.MAWEE_LEGACY_POOL_SCOPE = SCOPE;
  });

  afterEach(async () => {
    delete process.env.MAWEE_LEGACY_POOL_SCOPE;
    await handle?.dispose();
    handle = null;
  });

  it("moves unscoped rows to the explicit legacy scope, idempotently", async () => {
    const { db } = handle as IsolatedDb;
    await seedLegacy(db);
    await up(db);
    await up(db);

    const deposits = await db
      .collection("deposits")
      .find({})
      .sort({ leafIndex: 1 })
      .toArray();
    expect(deposits.map((d) => d._id)).toEqual([
      `${SCOPE}:0`,
      `${SCOPE}:1`,
      `${SCOPE}:2`,
    ]);
    expect(deposits.every((d) => d.scope === SCOPE)).toBe(true);
    expect(deposits[1].txHash).toBe("0x1");

    const [spent] = await db.collection("spent_nullifiers").find({}).toArray();
    expect(spent).toMatchObject({
      _id: `${SCOPE}:${NULLIFIER}`,
      scope: SCOPE,
      nullifierHex: NULLIFIER,
      block: 101,
    });

    const states = await db.collection("indexer_state").find({}).toArray();
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      _id: `pool:${SCOPE}`,
      scope: SCOPE,
      publishedBlock: 102,
      publishedLeafIndex: 2,
    });
    expect(states[0].leaseOwner).toBeUndefined();
  });

  it("enforces one row per pool leaf after migration", async () => {
    const { db } = handle as IsolatedDb;
    await seedLegacy(db);
    await up(db);
    await expect(
      db.collection<Record<string, unknown>>("deposits").insertOne({
        _id: "duplicate",
        scope: SCOPE,
        leafIndex: 1,
      }),
    ).rejects.toThrow();
    // The same leaf index in another pool is a different row.
    await db
      .collection<Record<string, unknown>>("deposits")
      .insertOne({ _id: `${OTHER}:1`, scope: OTHER, leafIndex: 1 });
  });

  it("refuses to guess a legacy scope", async () => {
    const { db } = handle as IsolatedDb;
    await seedLegacy(db);
    delete process.env.MAWEE_LEGACY_POOL_SCOPE;
    await expect(up(db)).rejects.toThrow("MAWEE_LEGACY_POOL_SCOPE");
    process.env.MAWEE_LEGACY_POOL_SCOPE = OTHER;
    await expect(up(db)).rejects.toThrow("does not match");
    // Nothing moved.
    expect(
      await db
        .collection("deposits")
        .countDocuments({ scope: { $exists: true } }),
    ).toBe(0);
  });

  it("needs no legacy scope on a fresh database", async () => {
    const { db } = handle as IsolatedDb;
    delete process.env.MAWEE_LEGACY_POOL_SCOPE;
    await up(db);
    expect(await db.collection("deposits").countDocuments()).toBe(0);
  });

  it("rolls the legacy scope back without deleting another pool's history", async () => {
    const { db } = handle as IsolatedDb;
    await seedLegacy(db);
    await up(db);
    await db
      .collection<Record<string, unknown>>("deposits")
      .insertOne({ _id: `${OTHER}:0`, scope: OTHER, leafIndex: 0 });
    await down(db);

    const ids = (await db.collection("deposits").find({}).toArray()).map(
      (d) => d._id,
    );
    expect(ids).toEqual(expect.arrayContaining([0, 1, 2, `${OTHER}:0`]));
    const [spent] = await db.collection("spent_nullifiers").find({}).toArray();
    expect(spent._id).toBe(NULLIFIER);
    const state = await db.collection("indexer_state").findOne({});
    expect(state).toMatchObject({ _id: "pool", scope: `eip155:${SCOPE}` });
  });
});
