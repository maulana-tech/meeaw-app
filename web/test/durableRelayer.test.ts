import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex, TransactionReceipt } from "viem";
import { keccak256, parseTransaction, encodeFunctionData } from "viem";
import { maweePoolAbi } from "../src/lib/abi";
import { SpendReservations } from "../src/server/lib/spendReservations";
import { openIsolatedRequestDb } from "./helpers/requestDb";
import { RelayJournal } from "../src/server/lib/relayJournal";
import {
  makeDurableSender,
  type RelayIntent,
  type RelayPort,
} from "../src/server/lib/durableRelayer";
describe("durable transaction recovery", () => {
  let db: Awaited<ReturnType<typeof openIsolatedRequestDb>>,
    journal: RelayJournal;
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const intent: RelayIntent = {
    operationKey: "request:example:0",
    chainId: 31337,
    wallet: account.address,
    to: "0x2222222222222222222222222222222222222222",
    data: "0x1234",
    confirmations: 1,
  };
  let calls: Hex[],
    fail: boolean,
    mined: TransactionReceipt | null,
    signs: number;
  let port: RelayPort;
  beforeAll(async () => {
    db = await openIsolatedRequestDb();
    journal = new RelayJournal(db.db);
  }, 15000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.db.collection("relay_wallets").deleteMany({});
    await db.db.collection("relay_sends").deleteMany({});
    await db.db.collection("spend_claims").deleteMany({});
    await db.db.collection("spend_nullifiers").deleteMany({});
    calls = [];
    fail = true;
    mined = null;
    signs = 0;
    port = {
      pendingNonce: async () => 0,
      blockNumber: async () => 1n,
      receipt: async () => mined,
      prepareAndSign: async (i, nonce) => {
        signs++;
        return account.signTransaction({
          chainId: i.chainId,
          type: "eip1559",
          nonce,
          to: i.to,
          data: i.data,
          gas: 100000n,
          maxFeePerGas: 1n,
          maxPriorityFeePerGas: 0n,
        });
      },
      broadcast: async (bytes) => {
        calls.push(bytes);
        if (fail) throw Error("RPC timeout");
        return keccak256(bytes);
      },
    };
  });
  it("recovers and rebroadcasts the same signed bytes after an uncertain send", async () => {
    const sender = makeDurableSender(journal, port);
    const prepared = await sender.prepare(intent);
    await expect(sender.broadcast(intent)).rejects.toThrow();
    fail = false;
    await makeDurableSender(new RelayJournal(db.db), port).broadcast(intent);
    expect(calls).toEqual([
      prepared.serializedTransaction,
      prepared.serializedTransaction,
    ]);
    expect(signs).toBe(1);
    expect((await sender.reconcile(intent)).state).toBe("unknown");
    await expect(
      sender.prepare({ ...intent, operationKey: "another" }),
    ).rejects.toThrow();
  });
  it("rejects altered retries without sending them", async () => {
    const sender = makeDurableSender(journal, port);
    await sender.prepare(intent);
    await expect(
      sender.prepare({ ...intent, data: "0xabcd" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it("releases the wallet only after an identified mined receipt", async () => {
    const sender = makeDurableSender(journal, port),
      prepared = await sender.prepare(intent);
    mined = {
      transactionHash: prepared.txHash,
      blockNumber: 1n,
      status: "success",
    } as TransactionReceipt;
    expect((await sender.reconcile(intent)).state).toBe("confirmed");
    const next = await sender.prepare({ ...intent, operationKey: "next" });
    expect(parseTransaction(next.serializedTransaction).nonce).toBe(1);
  });
  it("does not let an expired worker release a replacement worker's spend claim", async () => {
    const h = `0x${"11".repeat(32)}` as Hex,
      o = { commitment: h, ephemeralPk: h, ciphertext: "0x1234" as Hex };
    const spending = {
      ...intent,
      operationKey: "transfer:race:0",
      data: encodeFunctionData({
        abi: maweePoolAbi,
        functionName: "transfer",
        args: [
          h,
          h,
          {
            a: [1n, 2n],
            b: [
              [1n, 2n],
              [1n, 2n],
            ],
            c: [1n, 2n],
          },
          o,
          o,
        ],
      }),
    };
    let enterFirst!: () => void,
      enterSecond!: () => void,
      rejectFirst!: (e: Error) => void,
      releaseSecond!: (bytes: Hex) => void,
      count = 0;
    const firstEntered = new Promise<void>((resolve) => {
        enterFirst = resolve;
      }),
      secondEntered = new Promise<void>((resolve) => {
        enterSecond = resolve;
      });
    const signing = port.prepareAndSign;
    port.prepareAndSign = async () => {
      if (++count === 1) {
        enterFirst();
        return new Promise<Hex>((_, reject) => {
          rejectFirst = reject;
        });
      }
      enterSecond();
      return new Promise<Hex>((resolve) => {
        releaseSecond = resolve;
      });
    };
    const sender = makeDurableSender(
      journal,
      port,
      new SpendReservations(db.db),
    );
    const first = sender.prepare(spending).catch(() => null);
    await firstEntered;
    await journal.wallets.updateOne(
      { _id: `${spending.chainId}:${spending.wallet.toLowerCase()}` },
      { $set: { "active.expiresAt": new Date(0) } },
    );
    const second = sender.prepare(spending);
    await secondEntered;
    rejectFirst(new Error("Old worker stopped"));
    await first;
    releaseSecond(await signing(spending, 0));
    await expect(second).resolves.toHaveProperty("serializedTransaction");
  });
});
