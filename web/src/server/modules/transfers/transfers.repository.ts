import "server-only";
import { randomUUID } from "node:crypto";
import {
  type Db,
  type Filter,
  type IndexDescription,
  MongoServerError,
} from "mongodb";
import { signedTransferOf } from "../../../features/transfers/transferCrypto";
import { transferDigest } from "../../../features/transfers/transferTypedData";
import type {
  ConfirmedTransferStep,
  SignedTransfer,
  SignedTransferSubmission,
  TransferOperation,
  TransferRecord,
} from "../../../features/transfers/types";
import {
  TransferConflictError,
  TransferNotFoundError,
  TransferRejectedError,
} from "./transfers.errors";
export type TransferDoc = TransferRecord & {
  _id: string;
  digest: string;
  operation: TransferOperation;
  currentSubmission: SignedTransferSubmission | null;
};
export type TransferStepDoc = {
  _id: string;
  transferId: string;
  operationId: string;
  step: number;
  submission: SignedTransferSubmission;
  evidence: ConfirmedTransferStep | null;
};
export const TRANSFER_INDEXES: IndexDescription[] = [
  {
    key: { "sender.wallet": 1, pool: 1 },
    unique: true,
    name: "one_pending_sender_pool",
    partialFilterExpression: { status: "pending" },
  },
  {
    key: { pool: 1, recipientCommitment: 1 },
    unique: true,
    name: "transfer_commitment",
  },
  {
    key: { "sender.wallet": 1, createdAt: -1, _id: -1 },
    name: "transfer_sent",
  },
  {
    key: { "recipient.wallet": 1, createdAt: -1, _id: -1 },
    name: "transfer_received",
  },
  { key: { status: 1, "operation.phase": 1 }, name: "transfer_reconciliation" },
];
export function publicRecord(doc: TransferDoc): TransferRecord {
  return {
    ...signedTransferOf(doc),
    status: doc.status,
    revision: doc.revision,
    operationId: doc.operationId,
    updatedAt: doc.updatedAt,
    receipt: doc.receipt,
  };
}
export class TransferRepository {
  readonly collection;
  readonly steps;
  constructor(db: Db) {
    this.collection = db.collection<TransferDoc>("private_transfers");
    this.steps = db.collection<TransferStepDoc>("private_transfer_steps");
  }
  async ensureIndexes() {
    await this.collection.createIndexes(TRANSFER_INDEXES);
    await this.steps.createIndex(
      { transferId: 1, operationId: 1, step: 1 },
      { unique: true, name: "transfer_step_unique" },
    );
  }
  async create(record: SignedTransfer): Promise<TransferRecord> {
    const digest = transferDigest(record),
      prior = await this.collection.findOne({ _id: record.id });
    if (prior) {
      if (prior.digest !== digest)
        throw new TransferConflictError(
          "This transfer intent cannot be changed.",
        );
      return publicRecord(prior);
    }
    const id = randomUUID(),
      now = new Date().toISOString();
    const doc: TransferDoc = {
      ...record,
      _id: record.id,
      digest,
      status: "pending",
      revision: 0,
      operationId: id,
      updatedAt: now,
      receipt: null,
      operation: {
        id,
        transferId: record.id,
        phase: "preparing",
        nextStep: 0,
        txHash: null,
        updatedAt: now,
      },
      currentSubmission: null,
    };
    try {
      await this.collection.insertOne(doc);
    } catch (e) {
      if (e instanceof MongoServerError && e.code === 11000) {
        const existing = await this.collection.findOne({ _id: record.id });
        if (existing?.digest === digest) return publicRecord(existing);
        throw new TransferConflictError();
      }
      throw e;
    }
    return publicRecord(doc);
  }
  async getDoc(wallet: string, id: string) {
    const doc = await this.collection.findOne({
      _id: id,
      $or: [
        { "sender.wallet": wallet.toLowerCase() },
        { "recipient.wallet": wallet.toLowerCase() },
      ],
    });
    if (!doc) throw new TransferNotFoundError();
    return doc;
  }
  async get(wallet: string, id: string) {
    return publicRecord(await this.getDoc(wallet, id));
  }
  async pending(wallet: string) {
    const doc = await this.collection.findOne({
      "sender.wallet": wallet.toLowerCase(),
      status: "pending",
    });
    return doc ? publicRecord(doc) : null;
  }
  async list(
    wallet: string,
    input: { direction: "sent" | "received" | "all"; cursor?: string },
  ) {
    const w = wallet.toLowerCase();
    const participant: Filter<TransferDoc> =
      input.direction === "sent"
        ? { "sender.wallet": w }
        : input.direction === "received"
          ? { "recipient.wallet": w }
          : { $or: [{ "sender.wallet": w }, { "recipient.wallet": w }] };
    let filter = participant;
    if (input.cursor) {
      try {
        if (input.cursor.length > 200) throw new Error();
        const c: unknown = JSON.parse(
          Buffer.from(input.cursor, "base64url").toString(),
        );
        if (
          !Array.isArray(c) ||
          c.length !== 2 ||
          typeof c[0] !== "string" ||
          typeof c[1] !== "string" ||
          !Number.isFinite(Date.parse(c[0])) ||
          !/^[-a-f0-9]{36}$/.test(c[1])
        )
          throw new Error();
        filter = {
          $and: [
            participant,
            {
              $or: [
                { createdAt: { $lt: c[0] } },
                { createdAt: c[0], _id: { $lt: c[1] } },
              ],
            },
          ],
        };
      } catch {
        throw new TransferRejectedError("The history cursor is invalid.");
      }
    }
    const docs = await this.collection
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(21)
      .toArray();
    const items = docs.slice(0, 20),
      last = items.at(-1);
    return {
      items: items.map(publicRecord),
      nextCursor:
        docs.length > 20 && last
          ? Buffer.from(JSON.stringify([last.createdAt, last._id])).toString(
              "base64url",
            )
          : null,
    };
  }
}
