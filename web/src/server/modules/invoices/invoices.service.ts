import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Binary } from "mongodb";
import { bytesToHex, type Hex, hexToBytes } from "viem";
import {
  type InvoiceInput,
  invoiceInput,
  invoicePriceUnits,
  invoiceTotal,
} from "../../../features/invoices/input";
import {
  commitment,
  encryptNote,
  fromBE,
  R,
  randomFieldElement,
  toBE32,
} from "../../../lib/crypto";
import { activePoolFor } from "../../../lib/pools";
import { type DepositDoc, getDb } from "../../db/mongo";
import { rateLimit } from "../../lib/rateLimit";
import { resolveUsername } from "../usernames/usernames.service";
import { currentWallet } from "../wallets/wallets.service";
import { verifyInvoiceReceipt, verifyInvoiceRevert } from "./invoiceReceipt";
import {
  ensureInvoiceIndexes,
  type InvoiceDoc,
  invoiceCollection,
  invoiceView,
} from "./invoices.repository";
import { invoiceReader } from "./invoices.rpc";

const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Invoice not found." });
const rejected = (message: string) =>
  new TRPCError({ code: "BAD_REQUEST", message });
const unavailable = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "Payment evidence is unavailable. Check again shortly.",
  });
function publicKey(value: string): Hex {
  const hex = value.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex))
    throw rejected("Your receiving keys are unavailable.");
  return `0x${hex}`;
}
export async function createInvoice(userId: string, raw: InvoiceInput) {
  const input = invoiceInput.parse(raw);
  if (!rateLimit(`invoices:create:${userId}`, 20, 60 * 60_000).ok)
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Try creating another invoice later.",
    });
  const wallet = await currentWallet(userId),
    recipient = await resolveUsername(input.username);
  if (
    !wallet ||
    !recipient ||
    wallet.address.toLowerCase() !== recipient.owner.toLowerCase()
  )
    throw rejected("Choose your registered Meaw username.");
  const pool = activePoolFor(input.asset);
  if (
    pool?.role !== "active" ||
    pool.tokenDecimals !== 6 ||
    !(pool.requestCapable || pool.transferCapable)
  )
    throw rejected("This invoice asset is unavailable.");
  const reader = invoiceReader();
  let createdBlock: number;
  try {
    const [id, head] = await Promise.all([reader.chainId(), reader.head()]);
    if (id !== pool.chainId) throw unavailable();
    createdBlock = Number(head);
    if (!Number.isSafeInteger(createdBlock) || createdBlock < 0)
      throw unavailable();
  } catch {
    throw unavailable();
  }
  const notePubkey = publicKey(recipient.notePubkeyHex),
    viewPubkey = publicKey(recipient.viewPubkeyHex),
    ownerPk = fromBE(hexToBytes(notePubkey));
  if (ownerPk <= 0n || ownerPk >= R)
    throw rejected("Your receiving keys are unavailable.");
  const amount = invoiceTotal(input.items),
    salt = randomFieldElement();
  const envelope = encryptNote(hexToBytes(viewPubkey), amount, salt);
  const now = new Date();
  const doc: InvoiceDoc = {
    _id: randomUUID(),
    token: randomBytes(24).toString("base64url"),
    ownerPrivyUserId: userId,
    ownerWallet: wallet.address.toLowerCase() as Hex,
    username: input.username,
    number: input.number,
    clientName: input.clientName,
    asset: input.asset,
    amount: amount.toString(),
    items: input.items.map((item) => ({
      ...item,
      id: randomUUID(),
      unitPrice: invoicePriceUnits(item.unitPrice).toString(),
    })),
    notes: input.notes,
    dueDate: input.dueDate,
    pool,
    salt: salt.toString(),
    commitment: bytesToHex(toBE32(await commitment(amount, ownerPk, salt))),
    ephemeralPk: bytesToHex(envelope.ephemeralPk),
    ciphertext: bytesToHex(envelope.ciphertext),
    notePubkey,
    viewPubkey,
    createdBlock,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    checkedAt: null,
    paidAt: null,
    paidTx: null,
    paidBlock: null,
    leafIndex: null,
    voidedAt: null,
  };
  const collection = await ensureInvoiceIndexes();
  try {
    await collection.insertOne(doc);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "An invoice with this number already exists.",
      });
    throw error;
  }
  return invoiceView(doc);
}
export async function listInvoices(userId: string, cursor?: string) {
  const collection = await invoiceCollection();
  const anchor = cursor
    ? await collection.findOne({ _id: cursor, ownerPrivyUserId: userId })
    : null;
  if (cursor && !anchor) throw rejected("Invalid invoice page.");
  const records = await collection
    .find({
      ownerPrivyUserId: userId,
      ...(anchor
        ? {
            $or: [
              { createdAt: { $lt: anchor.createdAt } },
              { createdAt: anchor.createdAt, _id: { $lt: anchor._id } },
            ],
          }
        : {}),
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(51)
    .toArray();
  return {
    items: records.slice(0, 50).map(invoiceView),
    nextCursor: records.length > 50 ? records[49]._id : null,
  };
}
export async function getInvoice(userId: string, id: string) {
  const doc = await (await invoiceCollection()).findOne({
    _id: id,
    ownerPrivyUserId: userId,
  });
  if (!doc) throw missing();
  return invoiceView(doc);
}
export async function getPublicInvoice(token: string) {
  const doc = await (await invoiceCollection()).findOne({ token });
  if (!doc) throw missing();
  return invoiceView(doc);
}
export async function voidInvoice(userId: string, id: string) {
  const collection = await invoiceCollection(),
    now = new Date();
  const doc = await collection.findOneAndUpdate(
    { _id: id, ownerPrivyUserId: userId, status: "pending" },
    { $set: { status: "void", voidedAt: now, updatedAt: now } },
    { returnDocument: "after" },
  );
  if (doc) return invoiceView(doc);
  const existing = await collection.findOne({
    _id: id,
    ownerPrivyUserId: userId,
  });
  if (!existing) throw missing();
  if (existing.status === "void") return invoiceView(existing);
  throw new TRPCError({
    code: "CONFLICT",
    message: "A paid invoice cannot be voided.",
  });
}
export async function confirmInvoicePayment(token: string, hash: Hex) {
  const collection = await invoiceCollection(),
    doc = await collection.findOne({ token });
  if (!doc) throw missing();
  if (doc.status === "paid") {
    if (doc.paidTx?.toLowerCase() !== hash.toLowerCase())
      throw new TRPCError({
        code: "CONFLICT",
        message: "This invoice is already paid.",
      });
    return invoiceView(doc);
  }
  const reader = invoiceReader();
  let receipt: Awaited<ReturnType<typeof reader.receipt>>,
    chainId: number,
    head: bigint,
    canonicalHash: Hex | null;
  try {
    [receipt, chainId, head] = await Promise.all([
      reader.receipt(hash),
      reader.chainId(),
      reader.head(),
    ]);
    canonicalHash = await reader.blockHash(receipt.blockNumber);
  } catch {
    throw unavailable();
  }
  const leafIndex = verifyInvoiceReceipt({
    invoice: doc,
    receipt,
    hash,
    chainId,
    head,
    canonicalHash,
  });
  if (leafIndex === null)
    throw rejected("Payment evidence does not match this invoice.");
  const now = new Date();
  const updated = await collection.findOneAndUpdate(
    { _id: doc._id, status: { $in: ["pending", "void"] } },
    {
      $set: {
        status: "paid",
        paidAt: now,
        paidTx: hash,
        paidBlock: Number(receipt.blockNumber),
        leafIndex,
        updatedAt: now,
      },
    },
    { returnDocument: "after" },
  );
  if (updated) return invoiceView(updated);
  const settled = await collection.findOne({ _id: doc._id });
  if (
    settled?.status === "paid" &&
    settled.paidTx?.toLowerCase() === hash.toLowerCase()
  )
    return invoiceView(settled);
  throw new TRPCError({
    code: "CONFLICT",
    message: "Invoice status changed. Refresh it.",
  });
}
export async function reconcileInvoices(limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new RangeError("Invalid invoice reconciliation limit.");
  const collection = await invoiceCollection(),
    mirror = (await getDb()).collection<DepositDoc>("deposits");
  const docs = await collection
    .find({ status: { $in: ["pending", "void"] } })
    .sort({ checkedAt: 1, _id: 1 })
    .limit(limit)
    .toArray();
  const result = { checked: docs.length, paid: 0, unavailable: 0 };
  for (let offset = 0; offset < docs.length; offset += 4) {
    await Promise.all(
      docs.slice(offset, offset + 4).map(async (doc) => {
        try {
          const row = await mirror.findOne({
            scope: doc.pool.scope,
            commitment: new Binary(Buffer.from(doc.commitment.slice(2), "hex")),
            block: { $gte: doc.createdBlock },
          });
          if (row) {
            await confirmInvoicePayment(doc.token, row.txHash as Hex);
            result.paid++;
          }
        } catch {
          result.unavailable++;
        } finally {
          await collection.updateOne(
            { _id: doc._id },
            { $set: { checkedAt: new Date() } },
          );
        }
      }),
    );
  }
  return result;
}
export async function checkInvoicePayment(token: string, hash?: Hex) {
  const doc = await (await invoiceCollection()).findOne({ token });
  if (!doc) throw missing();
  if (doc.status === "paid")
    return {
      ...invoiceView(doc),
      paymentOutcome: "paid" as const,
      verifiedRevertHash: null,
    };
  if (hash) {
    const reader = invoiceReader();
    try {
      const [receipt, head, chainId, transaction] = await Promise.all([
        reader.receipt(hash),
        reader.head(),
        reader.chainId(),
        reader.transaction(hash),
      ]);
      const canonicalHash = await reader.blockHash(receipt.blockNumber);
      if (
        verifyInvoiceRevert({
          invoice: doc,
          hash,
          receipt,
          head,
          chainId,
          transaction,
          canonicalHash,
        })
      )
        return {
          ...invoiceView(doc),
          paymentOutcome: "reverted" as const,
          verifiedRevertHash: hash,
        };
    } catch {
      throw unavailable();
    }
    return {
      ...(await confirmInvoicePayment(token, hash)),
      paymentOutcome: "paid" as const,
      verifiedRevertHash: null,
    };
  }
  const mirror = (await getDb()).collection<DepositDoc>("deposits");
  const row = await mirror.findOne({
    scope: doc.pool.scope,
    commitment: new Binary(Buffer.from(doc.commitment.slice(2), "hex")),
    block: { $gte: doc.createdBlock },
  });
  return row
    ? {
        ...(await confirmInvoicePayment(token, row.txHash as Hex)),
        paymentOutcome: "paid" as const,
        verifiedRevertHash: null,
      }
    : {
        ...invoiceView(doc),
        paymentOutcome: "pending" as const,
        verifiedRevertHash: null,
      };
}
