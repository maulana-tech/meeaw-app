// Participant-only payment requests. The caller's wallet always comes from the
// verified Privy mapping; submitted usernames or wallets are never evidence of
// who the caller is. The server stores and returns opaque envelopes only.

import "server-only";
import { verifyTypedData } from "viem";
import {
  requestDigest,
  requestTypedData,
} from "../../../features/requests/requestTypedData";
import type {
  Participant,
  PaymentRequest,
  RequestPage,
  SignedRequest,
} from "../../../features/requests/types";
import { resolvePool } from "../../../lib/pools";
import { getPaymentRequests } from "../../db/mongo";
import { rateLimit } from "../../lib/rateLimit";
import { RegistryLookupFailedError } from "../usernames/usernames.errors";
import { resolveUsername } from "../usernames/usernames.service";
import { currentWallet } from "../wallets/wallets.service";
import {
  RequestConflictError,
  RequestNotFoundError,
  RequestRateLimitedError,
  RequestRejectedError,
  RequestUnavailableError,
} from "./requests.errors";
import {
  countPendingReceived,
  findForParticipant,
  InvalidCursorError,
  insertRequest,
  listForWallet,
  type RequestDirection,
  terminateRequest,
  toPaymentRequest,
  toRequestDoc,
} from "./requests.repository";

const TEN_MINUTES = 10 * 60_000;
export const REQUEST_LIMITS = {
  create: { limit: 20, windowMs: TEN_MINUTES },
  paymentStart: { limit: 10, windowMs: TEN_MINUTES },
  query: { limit: 120, windowMs: 60_000 },
  paymentStatus: { limit: 480, windowMs: 60_000 },
} as const;
/** How far a signed creation time may be from the server clock. */
const MAX_CLOCK_SKEW_MS = TEN_MINUTES;

export function enforceRequestLimit(
  privyUserId: string,
  kind: keyof typeof REQUEST_LIMITS,
): void {
  const { limit, windowMs } = REQUEST_LIMITS[kind];
  if (!rateLimit(`requests:${kind}:${privyUserId}`, limit, windowMs).ok)
    throw new RequestRateLimitedError();
}

/** The caller's verified wallet, lowercase, or null if none is linked. */
export async function callerWallet(
  privyUserId: string,
): Promise<string | null> {
  const wallet = await currentWallet(privyUserId);
  return wallet ? wallet.address.toLowerCase() : null;
}

const strip = (hex: string) => hex.replace(/^0x/, "").toLowerCase();

/** The participant's snapshot must match the registry's current record. */
async function assertRegistered(p: Participant): Promise<void> {
  let record: Awaited<ReturnType<typeof resolveUsername>>;
  try {
    record = await resolveUsername(p.username);
  } catch (error) {
    if (error instanceof RegistryLookupFailedError)
      throw new RequestUnavailableError(
        "The username registry is unavailable. Try again.",
      );
    throw error;
  }
  if (
    !record ||
    record.owner.toLowerCase() !== p.wallet.toLowerCase() ||
    strip(record.notePubkeyHex) !== strip(p.notePubkey) ||
    strip(record.viewPubkeyHex) !== strip(p.viewPubkey)
  )
    throw new RequestRejectedError(
      `@${p.username} is not registered with these keys.`,
    );
}

async function verifyRequesterSignature(record: SignedRequest): Promise<void> {
  let valid = false;
  try {
    valid = await verifyTypedData({
      address: record.requester.wallet,
      ...requestTypedData(record),
      signature: record.signature,
    });
  } catch {
    valid = false;
  }
  if (!valid)
    throw new RequestRejectedError("The request signature is invalid.");
}

function sameRecord(
  existing: { requesterWallet: string; digest: string },
  wallet: string,
  digest: string,
): boolean {
  return (
    existing.requesterWallet === wallet &&
    existing.digest === digest.toLowerCase()
  );
}

/**
 * Store a new signed, encrypted request. Idempotent per requester and request
 * id: an identical retry returns the stored record; changed content conflicts.
 */
export async function createRequest(
  privyUserId: string,
  record: SignedRequest,
  now: Date = new Date(),
): Promise<PaymentRequest> {
  enforceRequestLimit(privyUserId, "create");
  let pool: ReturnType<typeof resolvePool>;
  try {
    pool = resolvePool(record.pool);
  } catch {
    throw new RequestRejectedError("This request targets an unsupported pool.");
  }
  if (pool.role !== "active" || !pool.requestCapable)
    throw new RequestRejectedError("This request targets an unsupported pool.");

  const wallet = await callerWallet(privyUserId);
  if (!wallet)
    throw new RequestRejectedError(
      "No Meaw wallet is linked to this account.",
    );
  if (record.requester.wallet.toLowerCase() !== wallet)
    throw new RequestRejectedError("Sign the request with your own account.");

  const digest = requestDigest(record);
  const requests = await getPaymentRequests();
  const prior = await requests.findOne({ _id: record.id });
  if (prior) {
    if (sameRecord(prior, wallet, digest)) return toPaymentRequest(prior);
    throw new RequestConflictError("This request id is already in use.");
  }

  const skew = Math.abs(now.getTime() - Date.parse(record.createdAt));
  if (!(skew <= MAX_CLOCK_SKEW_MS))
    throw new RequestRejectedError("Check your device clock and try again.");
  await verifyRequesterSignature(record);
  await Promise.all([
    assertRegistered(record.requester),
    assertRegistered(record.addressee),
  ]);

  const outcome = await insertRequest(
    requests,
    toRequestDoc(record, digest, now),
  );
  if (outcome.kind === "inserted") return toPaymentRequest(outcome.doc);
  if (outcome.existing && sameRecord(outcome.existing, wallet, digest))
    return toPaymentRequest(outcome.existing);
  throw new RequestConflictError("This request already exists.");
}

async function list(
  privyUserId: string,
  direction: RequestDirection,
  cursor: string | undefined,
): Promise<RequestPage> {
  enforceRequestLimit(privyUserId, "query");
  const wallet = await callerWallet(privyUserId);
  if (!wallet) return { items: [], nextCursor: null };
  try {
    return await listForWallet(
      await getPaymentRequests(),
      direction,
      wallet,
      cursor,
    );
  } catch (error) {
    if (error instanceof InvalidCursorError)
      throw new RequestRejectedError(error.message);
    throw error;
  }
}

export function listReceived(
  privyUserId: string,
  input?: { cursor?: string },
): Promise<RequestPage> {
  return list(privyUserId, "received", input?.cursor);
}

export function listSent(
  privyUserId: string,
  input?: { cursor?: string },
): Promise<RequestPage> {
  return list(privyUserId, "sent", input?.cursor);
}

export async function pendingCount(privyUserId: string): Promise<number> {
  enforceRequestLimit(privyUserId, "query");
  const wallet = await callerWallet(privyUserId);
  if (!wallet) return 0;
  return countPendingReceived(await getPaymentRequests(), wallet);
}

export async function getRequest(
  privyUserId: string,
  input: { id: string },
): Promise<PaymentRequest> {
  enforceRequestLimit(privyUserId, "query");
  const wallet = await callerWallet(privyUserId);
  if (!wallet) throw new RequestNotFoundError();
  const doc = await findForParticipant(
    await getPaymentRequests(),
    input.id,
    wallet,
  );
  if (!doc) throw new RequestNotFoundError();
  return toPaymentRequest(doc);
}

async function terminate(
  privyUserId: string,
  input: { id: string; revision: number },
  to: "declined" | "cancelled",
): Promise<PaymentRequest> {
  enforceRequestLimit(privyUserId, "query");
  const wallet = await callerWallet(privyUserId);
  if (!wallet) throw new RequestNotFoundError();
  const requests = await getPaymentRequests();
  const changed = await terminateRequest(requests, {
    ...input,
    wallet,
    to,
    now: new Date(),
  });
  if (changed) return toPaymentRequest(changed);

  const doc = await findForParticipant(requests, input.id, wallet);
  if (!doc) throw new RequestNotFoundError();
  const allowed =
    to === "declined"
      ? doc.addresseeWallet === wallet
      : doc.requesterWallet === wallet;
  if (!allowed)
    throw new RequestRejectedError(
      to === "declined"
        ? "Only the person asked to pay can decline."
        : "Only the requester can cancel.",
    );
  if (doc.status !== "pending")
    throw new RequestConflictError("This request is no longer pending.");
  if (doc.operationId !== null)
    throw new RequestConflictError(
      "A payment for this request is in progress.",
    );
  throw new RequestConflictError();
}

/** Addressee only. Blocked while a payment is reserved or in flight. */
export function declineRequest(
  privyUserId: string,
  input: { id: string; revision: number },
): Promise<PaymentRequest> {
  return terminate(privyUserId, input, "declined");
}

/** Requester only. Blocked while a payment is reserved or in flight. */
export function cancelRequest(
  privyUserId: string,
  input: { id: string; revision: number },
): Promise<PaymentRequest> {
  return terminate(privyUserId, input, "cancelled");
}
