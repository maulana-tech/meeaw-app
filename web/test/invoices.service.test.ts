import { randomUUID } from "node:crypto";
import { Binary, type Db, MongoClient } from "mongodb";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  hexToBytes,
  type TransactionReceipt,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoiceInput } from "../src/features/invoices/input";
import { maweePoolAbi } from "../src/lib/abi";
import { decryptNote } from "../src/lib/crypto";
import { __resetRateLimit } from "../src/server/lib/rateLimit";
import { assetPool } from "./helpers/multiAssetFixtures";
import { testAccount, testParticipant } from "./helpers/requestFixtures";

const state = vi.hoisted(() => ({
  db: null as Db | null,
  recipient: null as unknown,
  pool: null as unknown,
  receipt: vi.fn(),
  head: vi.fn(async () => 100n),
  chainId: vi.fn(async () => 31337),
  block: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock("../src/server/db/mongo", () => ({ getDb: async () => state.db }));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: async (user: string) => ({
    address:
      user === "alice"
        ? (state.recipient as { wallet: string }).wallet
        : `0x${"9".repeat(40)}`,
  }),
}));
vi.mock("../src/server/modules/usernames/usernames.service", () => ({
  resolveUsername: async () => {
    const r = state.recipient as {
      wallet: string;
      notePubkey: string;
      viewPubkey: string;
    };
    return {
      owner: r.wallet,
      notePubkeyHex: r.notePubkey,
      viewPubkeyHex: r.viewPubkey,
    };
  },
}));
vi.mock("../src/lib/pools", () => ({
  activePoolFor: (asset: string) => (asset === "AUSD" ? state.pool : null),
}));
vi.mock("../src/server/modules/invoices/invoices.rpc", () => ({
  invoiceReader: () => ({
    chainId: state.chainId,
    head: state.head,
    receipt: state.receipt,
    blockHash: state.block,
    transaction: state.transaction,
  }),
}));

import {
  checkInvoicePayment,
  confirmInvoicePayment,
  createInvoice,
  getInvoice,
  getPublicInvoice,
  listInvoices,
  reconcileInvoices,
  voidInvoice,
} from "../src/server/modules/invoices/invoices.service";

let client: MongoClient;
let db: Db;
beforeEach(async () => {
  client = new MongoClient("mongodb://127.0.0.1:27017", {
    serverSelectionTimeoutMS: 3000,
  });
  await client.connect();
  db = client.db(`meaw_invoice_test_${randomUUID().replaceAll("-", "")}`);
  state.db = db;
  state.recipient = await testParticipant("alice", 1);
  state.pool = assetPool("AUSD");
  state.head.mockReset().mockResolvedValue(100n);
  state.chainId.mockReset().mockResolvedValue(31337);
  state.receipt.mockReset();
  state.block.mockReset();
  state.transaction.mockReset();
  __resetRateLimit();
});
afterEach(async () => {
  if (db?.databaseName.startsWith("meaw_invoice_test_"))
    await db.dropDatabase();
  await client?.close();
});
const input = () =>
  invoiceInput.parse({
    username: "alice",
    number: "inv-001",
    clientName: "Client",
    asset: "AUSD",
    dueDate: "2026-10-12",
    items: [{ description: "Design", quantity: 2, unitPrice: "1.25" }],
  });
async function paidReceipt(id: string) {
  const doc = await db.collection("invoices").findOne({ _id: id } as never);
  if (!doc) throw new Error("Fixture missing");
  const hash = `0x${"a".repeat(64)}` as const,
    blockHash = `0x${"b".repeat(64)}` as const;
  const log = {
    address: doc.pool.address,
    topics: encodeEventTopics({
      abi: maweePoolAbi,
      eventName: "Deposit",
      args: { leafIndex: 4 },
    }),
    data: encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }],
      [doc.commitment, doc.ephemeralPk, doc.ciphertext],
    ),
    removed: false,
    transactionHash: hash,
    blockHash,
    blockNumber: 100n,
    logIndex: 0,
    transactionIndex: 0,
  };
  state.receipt.mockResolvedValue({
    status: "success",
    to: doc.pool.address,
    transactionHash: hash,
    blockHash,
    blockNumber: 100n,
    logs: [log],
  } as unknown as TransactionReceipt);
  state.block.mockResolvedValue(blockHash);
  return { hash, doc };
}
describe("invoices with real isolated Mongo", () => {
  it("releases a restored reverted payment only when canonical calldata matches", async () => {
    const invoice = await createInvoice("alice", input());
    const { hash, doc } = await paidReceipt(invoice.id);
    const receipt = await state.receipt();
    state.receipt.mockResolvedValue({
      ...receipt,
      status: "reverted",
      logs: [],
    });
    const proof = {
      a: [0n, 0n] as [bigint, bigint],
      b: [
        [0n, 0n],
        [0n, 0n],
      ] as [[bigint, bigint], [bigint, bigint]],
      c: [0n, 0n] as [bigint, bigint],
    };
    state.transaction.mockResolvedValue({
      hash,
      to: doc.pool.address,
      blockHash: receipt.blockHash,
      blockNumber: 100n,
      input: encodeFunctionData({
        abi: maweePoolAbi,
        functionName: "deposit",
        args: [
          doc.commitment,
          BigInt(doc.amount),
          proof,
          doc.ephemeralPk,
          doc.ciphertext,
        ],
      }),
    });
    expect(await checkInvoicePayment(invoice.token, hash)).toMatchObject({
      status: "pending",
      paymentOutcome: "reverted",
      verifiedRevertHash: hash,
    });
    state.transaction.mockResolvedValue({
      ...(await state.transaction()),
      input: encodeFunctionData({
        abi: maweePoolAbi,
        functionName: "deposit",
        args: [
          `0x${"1".repeat(64)}`,
          BigInt(doc.amount),
          proof,
          doc.ephemeralPk,
          doc.ciphertext,
        ],
      }),
    });
    await expect(
      checkInvoicePayment(invoice.token, hash),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("checks an uncertain payment from the mirror without a client hash", async () => {
    const invoice = await createInvoice("alice", input());
    const { hash, doc } = await paidReceipt(invoice.id);
    await db.collection("deposits").insertOne({
      scope: doc.pool.scope,
      commitment: new Binary(Buffer.from(doc.commitment.slice(2), "hex")),
      block: 100,
      txHash: hash,
    });
    expect((await checkInvoicePayment(invoice.token)).status).toBe("paid");
  });
  it("keeps payment pending when RPC evidence is unavailable", async () => {
    const invoice = await createInvoice("alice", input());
    state.receipt.mockRejectedValue(new Error("RPC offline"));
    await expect(
      confirmInvoicePayment(invoice.token, `0x${"a".repeat(64)}`),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await getPublicInvoice(invoice.token)).status).toBe("pending");
  });
  it("cannot settle from a forged mirror row", async () => {
    const invoice = await createInvoice("alice", input());
    const { hash, doc } = await paidReceipt(invoice.id);
    state.receipt.mockResolvedValue({
      ...(await state.receipt()),
      to: assetPool("USDC").address,
    });
    await db.collection("deposits").insertOne({
      scope: doc.pool.scope,
      commitment: new Binary(Buffer.from(doc.commitment.slice(2), "hex")),
      block: 100,
      txHash: hash,
    });
    expect(await reconcileInvoices()).toMatchObject({
      paid: 0,
      unavailable: 1,
    });
    expect((await getPublicInvoice(invoice.token)).status).toBe("pending");
  });
  it("preserves Paid when confirmation races with Void", async () => {
    const invoice = await createInvoice("alice", input());
    const { hash } = await paidReceipt(invoice.id);
    await Promise.allSettled([
      voidInvoice("alice", invoice.id),
      confirmInvoicePayment(invoice.token, hash),
    ]);
    expect((await getPublicInvoice(invoice.token)).status).toBe("paid");
  });
  it("applies indexes idempotently and preserves records on migration down", async () => {
    const invoice = await createInvoice("alice", input());
    const migration = await import("../migrations/20261010150000-invoices.js");
    await migration.up(db);
    await migration.up(db);
    await migration.down(db);
    expect((await getInvoice("alice", invoice.id)).number).toBe("INV-001");
  });
  it("stores an exact immutable invoice and a decryptable recipient note", async () => {
    const invoice = await createInvoice("alice", input());
    expect(invoice.amount).toBe("2500000");
    expect(invoice.number).toBe("INV-001");
    expect(invoice.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(invoice).not.toHaveProperty("ownerPrivyUserId");
    const checkout = invoice.checkout;
    if (!checkout) throw new Error("Checkout missing");
    expect(
      decryptNote(
        testAccount(1).viewSk,
        hexToBytes(checkout.ephemeralPk),
        hexToBytes(checkout.ciphertext),
      ),
    ).toEqual({ amount: 2_500_000n, salt: BigInt(checkout.salt) });
  });
  it("isolates owner reads and prevents impersonating a username", async () => {
    const invoice = await createInvoice("alice", input());
    expect((await listInvoices("mallory")).items).toEqual([]);
    await expect(getInvoice("mallory", invoice.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(voidInvoice("mallory", invoice.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(createInvoice("mallory", input())).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
  it("enforces unique invoice numbers across concurrent creation", async () => {
    const result = await Promise.allSettled([
      createInvoice("alice", input()),
      createInvoice("alice", input()),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.collection("invoices").countDocuments()).toBe(1);
  });
  it("rejects a forged receipt and leaves pending status unchanged", async () => {
    const invoice = await createInvoice("alice", input());
    const { hash } = await paidReceipt(invoice.id);
    state.receipt.mockResolvedValue({
      ...(await state.receipt()),
      status: "reverted",
    });
    await expect(
      confirmInvoicePayment(invoice.token, hash),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await getPublicInvoice(invoice.token)).status).toBe("pending");
  });
  it("settles idempotently and cannot void a paid invoice", async () => {
    const invoice = await createInvoice("alice", input());
    const { hash } = await paidReceipt(invoice.id);
    const result = await Promise.all([
      confirmInvoicePayment(invoice.token, hash),
      confirmInvoicePayment(invoice.token, hash),
    ]);
    expect(
      result.every((r) => r.status === "paid" && r.checkout === null),
    ).toBe(true);
    await expect(voidInvoice("alice", invoice.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("records a valid payment that arrives after void", async () => {
    const invoice = await createInvoice("alice", input());
    await voidInvoice("alice", invoice.id);
    const { hash } = await paidReceipt(invoice.id);
    const result = await confirmInvoicePayment(invoice.token, hash);
    expect(result.status).toBe("paid");
    expect(result.voidedAt).not.toBeNull();
  });
  it("finds a payment via the mirror without the payer reporting its hash", async () => {
    const invoice = await createInvoice("alice", input());
    const { hash, doc } = await paidReceipt(invoice.id);
    await db.collection("deposits").insertOne({
      scope: doc.pool.scope,
      commitment: new Binary(Buffer.from(doc.commitment.slice(2), "hex")),
      block: 100,
      txHash: hash,
    });
    expect(await reconcileInvoices()).toMatchObject({ paid: 1 });
    expect((await getPublicInvoice(invoice.token)).status).toBe("paid");
  });
  it("rotates bounded reconciliation across unmatched records", async () => {
    const first = await createInvoice("alice", input());
    const second = await createInvoice("alice", {
      ...input(),
      number: "INV-002",
    });
    await reconcileInvoices(1);
    const a = await db
      .collection("invoices")
      .findOne({ _id: first.id } as never);
    const b = await db
      .collection("invoices")
      .findOne({ _id: second.id } as never);
    expect(Number(Boolean(a?.checkedAt)) + Number(Boolean(b?.checkedAt))).toBe(
      1,
    );
    await reconcileInvoices(1);
    expect(
      await db
        .collection("invoices")
        .countDocuments({ checkedAt: { $ne: null } }),
    ).toBe(2);
  });
});
