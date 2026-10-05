import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";
import { classifyPoolTransaction, kindDelta } from "./handlers/poolScope";

// Simulated events run through the real handlers against an in-memory store,
// so these tests cover the derived entities and aggregates without HyperSync.

const CHAIN = 10143;
const B32 = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;
const NULLIFIER = B32(0xabc);
const NULLIFIER_B = B32(0xdef);
const RECIPIENT = "0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c";
const OWNER = "0x00000000000000000000000000000000000000E1";
// The pool and registry addresses listed in config.yaml, plus a second pool.
const POOL = "0xfdfcb53eeb148709510bbd4e7d164065605baea5";
const OTHER_POOL = "0x00000000000000000000000000000000000000c0";
const REGISTRY = "0xa3024964732bf324256c3dbb3be314e254cb6a70";
const SCOPE = `${CHAIN}:${POOL}`;
const OTHER_SCOPE = `${CHAIN}:${OTHER_POOL}`;
const DAY_1 = 1_760_000_000; // 2025-10-09T08:53:20Z
const DAY_2 = DAY_1 + 86_400;

function deposit(
  leafIndex: number,
  block: number,
  { timestamp = DAY_1, tx = 1000 + leafIndex, pool = POOL }: { timestamp?: number; tx?: number; pool?: `0x${string}` } = {},
) {
  return {
    contract: "Pool" as const,
    event: "Deposit" as const,
    srcAddress: pool,
    block: { number: block, timestamp },
    transaction: { hash: B32(tx) },
    params: {
      leafIndex: BigInt(leafIndex),
      commitment: B32(leafIndex + 1),
      ephemeralPk: B32(7),
      ciphertext: "0xdeadbeef",
    },
  };
}

function spend(nullifier: string, block: number, tx: number, pool: `0x${string}` = POOL) {
  return {
    contract: "Pool" as const,
    event: "Spend" as const,
    srcAddress: pool,
    block: { number: block, timestamp: DAY_1 },
    transaction: { hash: B32(tx) },
    params: { nullifier },
  };
}

describe("transaction classification", () => {
  it("keeps consolidation out of transfer totals", () => {
    expect(classifyPoolTransaction(1, 2, 0)).toBe("merge");
    expect(classifyPoolTransaction(1, 1, 0)).toBe("incomplete");
    expect(classifyPoolTransaction(2, 1, 0)).toBe("transfer");
    expect(classifyPoolTransaction(0, 1, 1)).toBe("withdraw");
    expect(classifyPoolTransaction(1, 0, 0)).toBe("deposit");
    expect(kindDelta("incomplete", "merge")).toEqual({
      shieldedTransfers: 0,
      merges: 1,
    });
    expect(kindDelta("transfer", "transfer")).toEqual({
      shieldedTransfers: 0,
      merges: 0,
    });
  });
});

describe("Pool handlers", () => {
  it("stores notes per pool in leaf order and grows the anonymity set", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { [CHAIN]: { simulate: [deposit(0, 10), deposit(1, 11)] } },
    });

    const note = await indexer.Note.getOrThrow(`${SCOPE}:1`);
    expect(note).toMatchObject({
      pool: SCOPE,
      leafIndex: 1,
      commitment: B32(2),
      ciphertext: "0xdeadbeef",
      blockNumber: 11,
      txHash: B32(1001),
    });
    expect(await indexer.PoolStats.getOrThrow(SCOPE)).toMatchObject({
      notes: 2,
      spent: 0,
      anonymitySet: 2,
    });
  });

  it("classifies a withdrawal and links it to its nullifier", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            deposit(0, 10),
            deposit(1, 10),
            {
              contract: "Pool",
              event: "Withdrawal",
              srcAddress: POOL,
              block: { number: 12, timestamp: DAY_1 },
              transaction: { hash: B32(2000) },
              params: {
                nullifier: NULLIFIER,
                recipient: RECIPIENT,
                amount: 5_000_000n,
              },
            },
            spend(NULLIFIER, 12, 2000),
          ],
        },
      },
    });

    const id = `${SCOPE}:${NULLIFIER.slice(2)}`;
    expect(await indexer.Nullifier.getOrThrow(id)).toMatchObject({
      nullifier: NULLIFIER.slice(2),
      blockNumber: 12,
      withdrawal_id: id,
    });
    expect(await indexer.Withdrawal.getOrThrow(id)).toMatchObject({
      recipient: RECIPIENT.toLowerCase(),
      amount: 5_000_000n,
    });
    expect(await indexer.PoolStats.getOrThrow(SCOPE)).toMatchObject({
      notes: 2,
      spent: 1,
      anonymitySet: 1,
      withdrawals: 1,
      shieldedTransfers: 0,
      merges: 0,
      totalWithdrawn: 5_000_000n,
    });
  });

  it("counts two outputs and one spend in one transaction as one shielded transfer", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            deposit(0, 10),
            deposit(1, 20, { tx: 3000 }),
            deposit(2, 20, { tx: 3000 }),
            spend(NULLIFIER, 20, 3000),
          ],
        },
      },
    });

    const nullifier = await indexer.Nullifier.getOrThrow(
      `${SCOPE}:${NULLIFIER.slice(2)}`,
    );
    expect(nullifier.withdrawal_id).toBeUndefined();
    expect(await indexer.PoolStats.getOrThrow(SCOPE)).toMatchObject({
      notes: 3,
      spent: 1,
      anonymitySet: 2,
      withdrawals: 0,
      shieldedTransfers: 1,
      merges: 0,
    });
    expect(
      await indexer.PoolTransaction.getOrThrow(`${SCOPE}:${B32(3000)}`),
    ).toMatchObject({ deposits: 2, spends: 1, kind: "transfer" });
  });

  it("counts a merge (one output, two spends) as a merge, not two transfers", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            deposit(0, 10),
            deposit(1, 11),
            deposit(2, 20, { tx: 4000 }),
            spend(NULLIFIER, 20, 4000),
            spend(NULLIFIER_B, 20, 4000),
          ],
        },
      },
    });

    expect(await indexer.PoolStats.getOrThrow(SCOPE)).toMatchObject({
      // notes +1, spent +2, anonymity set -1 for the merge itself.
      notes: 3,
      spent: 2,
      anonymitySet: 1,
      shieldedTransfers: 0,
      merges: 1,
    });
    expect(
      await indexer.PoolTransaction.getOrThrow(`${SCOPE}:${B32(4000)}`),
    ).toMatchObject({ deposits: 1, spends: 2, kind: "merge" });
  });

  it("does not publish an aggregate for an incomplete event group", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [deposit(0, 20, { tx: 5000 }), spend(NULLIFIER, 20, 5000)],
        },
      },
    });
    expect(await indexer.PoolStats.getOrThrow(SCOPE)).toMatchObject({
      shieldedTransfers: 0,
      merges: 0,
    });
    expect(
      await indexer.PoolTransaction.getOrThrow(`${SCOPE}:${B32(5000)}`),
    ).toMatchObject({ kind: "incomplete" });
  });

  it("keeps the same leaf index and nullifier in two pools apart", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            deposit(0, 10),
            deposit(0, 11, { tx: 6000, pool: OTHER_POOL }),
            spend(NULLIFIER, 12, 6001, OTHER_POOL),
          ],
        },
      },
    });

    expect((await indexer.Note.getOrThrow(`${SCOPE}:0`)).pool).toBe(SCOPE);
    expect((await indexer.Note.getOrThrow(`${OTHER_SCOPE}:0`)).pool).toBe(
      OTHER_SCOPE,
    );
    expect(
      await indexer.Nullifier.get(`${SCOPE}:${NULLIFIER.slice(2)}`),
    ).toBeUndefined();
    expect(await indexer.PoolStats.getOrThrow(SCOPE)).toMatchObject({
      notes: 1,
      spent: 0,
    });
    expect(await indexer.PoolStats.getOrThrow(OTHER_SCOPE)).toMatchObject({
      notes: 1,
      spent: 1,
    });
  });

  it("buckets activity per pool and UTC day", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            deposit(0, 10, { timestamp: DAY_1 }),
            deposit(1, 20, { timestamp: DAY_2 }),
            deposit(2, 21, { timestamp: DAY_2 }),
          ],
        },
      },
    });
    const day = (t: number) =>
      new Date((t - (t % 86_400)) * 1000).toISOString().slice(0, 10);
    expect(
      (await indexer.DailyStats.getOrThrow(`${SCOPE}:${day(DAY_1)}`)).notes,
    ).toBe(1);
    expect(
      (await indexer.DailyStats.getOrThrow(`${SCOPE}:${day(DAY_2)}`)).notes,
    ).toBe(2);
  });

  it("tracks the paused flag per pool", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "Pool",
              event: "PausedSet",
              srcAddress: POOL,
              block: { number: 5, timestamp: DAY_1 },
              params: { paused: true },
            },
          ],
        },
      },
    });
    expect((await indexer.PoolStats.getOrThrow(SCOPE)).paused).toBe(true);
  });
});

describe("Registry handlers", () => {
  it("registers accounts per registry and records key rotations by owner", async () => {
    const indexer = createTestIndexer();
    const registry = `${CHAIN}:${REGISTRY}`;
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "Registry",
              event: "Registered",
              srcAddress: REGISTRY,
              block: { number: 3, timestamp: DAY_1 },
              params: {
                usernameHash: B32(99),
                username: "dinar",
                owner: OWNER,
                notePubkey: B32(1),
                viewPubkey: B32(2),
              },
            },
            {
              contract: "Registry",
              event: "PubkeysRotated",
              srcAddress: REGISTRY,
              block: { number: 4, timestamp: DAY_1 },
              params: {
                usernameHash: B32(99),
                owner: OWNER,
                notePubkey: B32(3),
                viewPubkey: B32(4),
              },
            },
          ],
        },
      },
    });

    expect(await indexer.Account.getOrThrow(`${registry}:dinar`)).toMatchObject({
      registry,
      owner: OWNER.toLowerCase(),
      notePubkey: B32(3),
      viewPubkey: B32(4),
      keyRotations: 1,
    });
    const rotations = await indexer.KeyRotation.getAll();
    expect(rotations).toHaveLength(1);
    expect(rotations[0]).toMatchObject({
      account_id: `${registry}:dinar`,
      notePubkey: B32(3),
    });
    expect((await indexer.RegistryStats.getOrThrow(registry)).accounts).toBe(1);
  });
});
