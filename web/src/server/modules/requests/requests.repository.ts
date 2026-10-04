// Persistence for private payment requests. Every state change is a single
// conditional write on one document (the VPS MongoDB is standalone, so there
// are no multi-document transactions to lean on).

import "server-only";
import {
  Binary,
  type Collection,
  type Filter,
  type IndexDescription,
  MongoServerError,
} from "mongodb";
import type {
  Envelope,
  Hex,
  Participant,
  PaymentRequest,
  PoolScope,
  RequestPage,
  RequestStatus,
  SignedRequest,
} from "../../../features/requests/types";
import type {
  PaymentRequestDoc,
  RequestEnvelopeDoc,
  RequestParticipantDoc,
} from "../../db/mongo";

export const REQUEST_PAGE_SIZE = 20;
const MAX_CURSOR_CHARS = 200;

/**
 * Indexes of `payment_requests`. The payment-requests migration creates the
 * same set; keep them in sync.
 */
export const REQUEST_INDEXES: IndexDescription[] = [
  {
    key: { scope: 1, recipientCommitment: 1 },
    name: "scope_commitment_unique",
    unique: true,
  },
  {
    key: { requesterWallet: 1, createdAt: -1, _id: -1 },
    name: "requester_created",
  },
  {
    key: { addresseeWallet: 1, createdAt: -1, _id: -1 },
    name: "addressee_created",
  },
  { key: { addresseeWallet: 1, status: 1 }, name: "addressee_status" },
  { key: { requesterWallet: 1, status: 1 }, name: "requester_status" },
  {
    key: { operationId: 1 },
    name: "operation_unique",
    unique: true,
    partialFilterExpression: { operationId: { $type: "string" } },
  },
];

export type RequestDirection = "received" | "sent";

const walletField = (direction: RequestDirection) =>
  direction === "received" ? "addresseeWallet" : "requesterWallet";

const lower = (value: string) => value.toLowerCase();

function participantDoc(p: Participant): RequestParticipantDoc {
  return {
    username: p.username,
    wallet: lower(p.wallet),
    notePubkey: lower(p.notePubkey),
    viewPubkey: lower(p.viewPubkey),
  };
}

function envelopeDoc(e: Envelope): RequestEnvelopeDoc {
  return {
    ephemeralPk: new Binary(Buffer.from(e.ephemeralPk.slice(2), "hex")),
    ciphertext: new Binary(Buffer.from(e.ciphertext.slice(2), "hex")),
  };
}

const binHex = (b: Binary) =>
  `0x${Buffer.from(b.buffer).toString("hex")}` as Hex;

/** Build a fresh pending document from a validated, verified signed record. */
export function toRequestDoc(
  record: SignedRequest,
  digest: Hex,
  now: Date,
): PaymentRequestDoc {
  return {
    _id: record.id,
    version: 1,
    scope: record.pool,
    requesterWallet: lower(record.requester.wallet),
    addresseeWallet: lower(record.addressee.wallet),
    requester: participantDoc(record.requester),
    addressee: participantDoc(record.addressee),
    createdAt: new Date(record.createdAt),
    recipientCommitment: lower(record.recipientCommitment),
    requesterEnvelope: envelopeDoc(record.requesterEnvelope),
    addresseeEnvelope: envelopeDoc(record.addresseeEnvelope),
    signature: lower(record.signature),
    digest: lower(digest),
    status: "pending",
    revision: 0,
    operationId: null,
    reservation: null,
    receipt: null,
    updatedAt: now,
  };
}

function participantWire(p: RequestParticipantDoc): Participant {
  return {
    username: p.username,
    wallet: p.wallet as Hex,
    notePubkey: p.notePubkey as Hex,
    viewPubkey: p.viewPubkey as Hex,
  };
}

/** Wire form. Envelopes stay opaque; the server never decrypts them. */
export function toPaymentRequest(doc: PaymentRequestDoc): PaymentRequest {
  return {
    version: 1,
    id: doc._id,
    pool: doc.scope as PoolScope,
    requester: participantWire(doc.requester),
    addressee: participantWire(doc.addressee),
    createdAt: doc.createdAt.toISOString(),
    recipientCommitment: doc.recipientCommitment as Hex,
    requesterEnvelope: {
      ephemeralPk: binHex(doc.requesterEnvelope.ephemeralPk),
      ciphertext: binHex(doc.requesterEnvelope.ciphertext),
    },
    addresseeEnvelope: {
      ephemeralPk: binHex(doc.addresseeEnvelope.ephemeralPk),
      ciphertext: binHex(doc.addresseeEnvelope.ciphertext),
    },
    signature: doc.signature as Hex,
    status: doc.status,
    revision: doc.revision,
    operationId: doc.operationId,
    updatedAt: doc.updatedAt.toISOString(),
    receipt: doc.receipt
      ? {
          txHash: doc.receipt.txHash as Hex,
          leafIndex: doc.receipt.leafIndex,
          block: doc.receipt.block,
        }
      : null,
  };
}

type Cursor = { t: number; id: string };

export function encodeCursor(doc: Pick<PaymentRequestDoc, "_id" | "createdAt">) {
  return Buffer.from(
    JSON.stringify({ t: doc.createdAt.getTime(), id: doc._id }),
  ).toString("base64url");
}

/** Returns null for anything that is not a cursor this module produced. */
export function decodeCursor(raw: string): Cursor | null {
  if (raw.length > MAX_CURSOR_CHARS || !/^[A-Za-z0-9_-]+$/.test(raw))
    return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      Object.keys(value).length !== 2 ||
      !Number.isSafeInteger(value.t) ||
      value.t < 0 ||
      typeof value.id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(value.id)
    )
      return null;
    return { t: value.t, id: value.id };
  } catch {
    return null;
  }
}

export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid page cursor.");
    this.name = "InvalidCursorError";
  }
}

/**
 * One page, newest first. Ordering is (createdAt DESC, _id DESC) and the
 * cursor carries both, so equal timestamps across a page boundary are neither
 * skipped nor repeated. Always filtered by the participant's own wallet.
 */
export async function listForWallet(
  requests: Collection<PaymentRequestDoc>,
  direction: RequestDirection,
  wallet: string,
  cursor: string | null | undefined,
): Promise<RequestPage> {
  const filter: Filter<PaymentRequestDoc> = {
    [walletField(direction)]: lower(wallet),
  };
  if (cursor) {
    const after = decodeCursor(cursor);
    if (!after) throw new InvalidCursorError();
    const at = new Date(after.t);
    filter.$or = [
      { createdAt: { $lt: at } },
      { createdAt: at, _id: { $lt: after.id } },
    ];
  }
  const rows = await requests
    .find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(REQUEST_PAGE_SIZE + 1)
    .toArray();
  const page = rows.slice(0, REQUEST_PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map(toPaymentRequest),
    nextCursor: rows.length > REQUEST_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}

/** All pending received requests, independent of any page. */
export function countPendingReceived(
  requests: Collection<PaymentRequestDoc>,
  wallet: string,
): Promise<number> {
  return requests.countDocuments({
    addresseeWallet: lower(wallet),
    status: "pending",
  });
}

export function findForParticipant(
  requests: Collection<PaymentRequestDoc>,
  id: string,
  wallet: string,
): Promise<PaymentRequestDoc | null> {
  const w = lower(wallet);
  return requests.findOne({
    _id: id,
    $or: [{ requesterWallet: w }, { addresseeWallet: w }],
  });
}

export type InsertOutcome =
  | { kind: "inserted"; doc: PaymentRequestDoc }
  | { kind: "duplicate"; existing: PaymentRequestDoc | null };

/** Insert once. A duplicate id or output commitment reports the collision. */
export async function insertRequest(
  requests: Collection<PaymentRequestDoc>,
  doc: PaymentRequestDoc,
): Promise<InsertOutcome> {
  try {
    await requests.insertOne(doc);
    return { kind: "inserted", doc };
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return {
        kind: "duplicate",
        existing: await requests.findOne({ _id: doc._id }),
      };
    }
    throw error;
  }
}

/**
 * Pending → declined (addressee) or cancelled (requester), conditional on the
 * caller's role, the expected revision and no active payment reservation.
 * Returns null when any condition no longer holds.
 */
export function terminateRequest(
  requests: Collection<PaymentRequestDoc>,
  input: {
    id: string;
    revision: number;
    wallet: string;
    to: Extract<RequestStatus, "declined" | "cancelled">;
    now: Date;
  },
): Promise<PaymentRequestDoc | null> {
  const role = input.to === "declined" ? "addresseeWallet" : "requesterWallet";
  return requests.findOneAndUpdate(
    {
      _id: input.id,
      status: "pending",
      revision: input.revision,
      operationId: null,
      [role]: lower(input.wallet),
    },
    {
      $set: { status: input.to, updatedAt: input.now },
      $inc: { revision: 1 },
    },
    { returnDocument: "after", includeResultMetadata: false },
  );
}
