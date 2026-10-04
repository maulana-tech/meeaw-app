import { createTestIndexer } from "envio";
import { describe, expect, it } from "vitest";

// Simulated events run through the real handlers against an in-memory store,
// so these tests cover the derived entities and aggregates without HyperSync.

const CHAIN = 10143;
const B32 = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const NULLIFIER = B32(0xabc);
const RECIPIENT = "0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c";
const OWNER = "0x00000000000000000000000000000000000000E1";
const DAY_1 = 1_760_000_000; // 2025-10-09T08:53:20Z
const DAY_2 = DAY_1 + 86_400;

function deposit(leafIndex: number, block: number, timestamp = DAY_1) {
  return {
    contract: "Pool" as const,
    event: "Deposit" as const,
    block: { number: block, timestamp },
    transaction: { hash: B32(1000 + leafIndex) },
    params: {
      leafIndex: BigInt(leafIndex),
      commitment: B32(leafIndex + 1),
      ephemeralPk: B32(7),
      ciphertext: "0xdeadbeef",
    },
  };
}

describe("Pool handlers", () => {
  it("stores notes in leaf order and grows the anonymity set", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { [CHAIN]: { simulate: [deposit(0, 10), deposit(1, 11)] } },
    });

    const note = await indexer.Note.getOrThrow("1");
    expect(note).toMatchObject({
      leafIndex: 1,
      commitment: B32(2),
      ciphertext: "0xdeadbeef",
      blockNumber: 11,
      txHash: B32(1001),
    });
    expect(await indexer.PoolStats.getOrThrow("global")).toMatchObject({
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
              block: { number: 12, timestamp: DAY_1 },
              transaction: { hash: B32(2000) },
              params: {
                nullifier: NULLIFIER,
                recipient: RECIPIENT,
                amount: 5_000_000n,
              },
            },
            {
              contract: "Pool",
              event: "Spend",
              block: { number: 12, timestamp: DAY_1 },
              transaction: { hash: B32(2000) },
              params: { nullifier: NULLIFIER },
            },
          ],
        },
      },
    });

    const id = NULLIFIER.slice(2);
    expect(await indexer.Nullifier.getOrThrow(id)).toMatchObject({
      blockNumber: 12,
      withdrawal_id: id,
    });
    expect(await indexer.Withdrawal.getOrThrow(id)).toMatchObject({
      recipient: RECIPIENT.toLowerCase(),
      amount: 5_000_000n,
    });
    expect(await indexer.PoolStats.getOrThrow("global")).toMatchObject({
      notes: 2,
      spent: 1,
      anonymitySet: 1,
      withdrawals: 1,
      shieldedTransfers: 0,
      totalWithdrawn: 5_000_000n,
    });
  });

  it("counts a spend without a withdrawal as a shielded transfer", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            deposit(0, 10),
            deposit(1, 20),
            deposit(2, 20),
            {
              contract: "Pool",
              event: "Spend",
              block: { number: 20, timestamp: DAY_1 },
              params: { nullifier: NULLIFIER },
            },
          ],
        },
      },
    });

    const nullifier = await indexer.Nullifier.getOrThrow(NULLIFIER.slice(2));
    expect(nullifier.withdrawal_id).toBeUndefined();
    expect(await indexer.PoolStats.getOrThrow("global")).toMatchObject({
      notes: 3,
      spent: 1,
      anonymitySet: 2,
      withdrawals: 0,
      shieldedTransfers: 1,
    });
  });

  it("buckets activity per UTC day", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [deposit(0, 10, DAY_1), deposit(1, 20, DAY_2), deposit(2, 21, DAY_2)],
        },
      },
    });
    const day1 = new Date((DAY_1 - (DAY_1 % 86_400)) * 1000).toISOString().slice(0, 10);
    const day2 = new Date((DAY_2 - (DAY_2 % 86_400)) * 1000).toISOString().slice(0, 10);
    expect((await indexer.DailyStats.getOrThrow(day1)).notes).toBe(1);
    expect((await indexer.DailyStats.getOrThrow(day2)).notes).toBe(2);
  });

  it("tracks the paused flag", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "Pool",
              event: "PausedSet",
              block: { number: 5, timestamp: DAY_1 },
              params: { paused: true },
            },
          ],
        },
      },
    });
    expect((await indexer.PoolStats.getOrThrow("global")).paused).toBe(true);
  });
});

describe("Registry handlers", () => {
  it("registers accounts and records key rotations by owner", async () => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        [CHAIN]: {
          simulate: [
            {
              contract: "Registry",
              event: "Registered",
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

    expect(await indexer.Account.getOrThrow("dinar")).toMatchObject({
      owner: OWNER.toLowerCase(),
      notePubkey: B32(3),
      viewPubkey: B32(4),
      keyRotations: 1,
    });
    const rotations = await indexer.KeyRotation.getAll();
    expect(rotations).toHaveLength(1);
    expect(rotations[0]).toMatchObject({ account_id: "dinar", notePubkey: B32(3) });
    expect((await indexer.PoolStats.getOrThrow("global")).accounts).toBe(1);
  });
});
