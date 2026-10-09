import { type Binary, type Collection, type Db, MongoClient } from "mongodb";
import { getServerEnv } from "../../env.server";

export type DepositDoc = {
  _id: string; // `${scope}:${leafIndex}` (see deposits/poolScope.ts)
  scope: string; // `${chainId}:${poolAddress}`
  leafIndex: number;
  commitment: Binary;
  ephemeralPk: Binary;
  ciphertext: Binary;
  block: number;
  txHash: string;
  ts: Date;
};

export type UsernameDoc = {
  _id: string; // lowercased username
  owner: string; // checksummed EVM address
  notePubkey: Binary;
  viewPubkey: Binary;
  createdAt: Date;
  updatedAt?: Date;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
};

export type IndexerStateDoc = {
  /** `pool:${scope}` per pool; bare "pool" only exists before migration. */
  _id: "pool" | "registry" | `pool:${string}`;
  /** Pool scope (`${chainId}:${poolAddress}`) the watermark belongs to. */
  scope?: string;
  publishedBlock?: number;
  publishedLeafIndex?: number;
  updatedAt: Date;
  indexedAt?: Date;
  health?: "healthy" | "degraded";
  lastError?: string;
  leaseOwner?: string;
  leaseUntil?: Date;
};

export type SpentNullifierDoc = {
  _id: string; // `${scope}:${nullifierHex}` (see deposits/poolScope.ts)
  scope: string;
  nullifierHex: string; // no 0x
  block: number;
  txHash: string;
  ts: Date;
};

export type PaymentLinkDoc = {
  _id: string;
  owner: string;
  slug?: string;
  amount: string | null;
  asset?: import("../../lib/assets").AssetSymbol;
  tokenDecimals?: number;
  description?: string | null;
  label: string | null;
  state?: "active" | "archived";
  status: "pending" | "paid";
  manageTokenHash?: string; // sha-256 of the per-link manage capability token
  createdAt: Date;
  updatedAt?: Date;
  archivedAt?: Date | null;
};

export type UserDoc = {
  _id: string; // checksummed address of the user's Privy embedded wallet
  privyUserId: string;
  privyWalletId?: string;
  encryptedMaster?: Binary;
  masterSalt?: Binary;
  kdfParams?: { m: number; t: number; p: number };
  escrowRevision?: number;
  // Passkey recovery (Mera PRF). All public: the credential to ask for and
  // the viewing pubkey its derived keys must reproduce. No secret material.
  passkeyCredentialId?: string;
  passkeyTransports?: string[];
  passkeyViewPubkey?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type RequestParticipantDoc = {
  username: string;
  wallet: string; // lowercase
  notePubkey: string; // 0x-prefixed, lowercase
  viewPubkey: string; // 0x-prefixed, lowercase
};

export type RequestEnvelopeDoc = { ephemeralPk: Binary; ciphertext: Binary };

/** Active payment reservation, embedded so reserve/cancel races are one atomic write. */
export type RequestReservationDoc = {
  sponsorshipAction?: import("../../features/sponsorship/types").ActionTicket;
  sponsorshipPause?: import("../../features/sponsorship/types").UnavailableReason;
  fundingGeneration?: number;
  keyRevision?: number;
  accountTicketId?: string;
  attemptId: string;
  phase:
    | "preparing"
    | "submitting"
    | "submitted"
    | "confirmed"
    | "failed"
    | "needsReconciliation";
  updatedAt: Date;
  completedMerges: number;
  nextStep: number;
  txHash: string | null;
  relayWallet: string | null;
  currentSubmission:
    | import("../../features/requests/types").SignedSubmission
    | null;
  currentDigest: string | null;
};

/**
 * A private payment request. Holds only signed public metadata, the two
 * opaque fixed-size envelopes and public status: never a plaintext amount,
 * note, salt or decrypted payload.
 */
export type PaymentRequestDoc = {
  _id: string; // client-generated UUID v4
  version: 1;
  scope: string; // `${chainId}:${poolAddress}`
  requesterWallet: string; // lowercase
  addresseeWallet: string; // lowercase
  requester: RequestParticipantDoc;
  addressee: RequestParticipantDoc;
  createdAt: Date; // the signed creation time
  recipientCommitment: string; // 0x-prefixed, lowercase
  requesterEnvelope: RequestEnvelopeDoc;
  addresseeEnvelope: RequestEnvelopeDoc;
  signature: string;
  digest: string; // EIP-712 digest of the immutable record
  status: "pending" | "paid" | "declined" | "cancelled";
  revision: number;
  operationId: string | null;
  reservation: RequestReservationDoc | null;
  receipt: { txHash: string; leafIndex: number; block: number } | null;
  updatedAt: Date;
};

declare global {
  // eslint-disable-next-line no-var
  var _maweeMongoClientPromise: Promise<MongoClient> | undefined;
}

let clientPromise: Promise<MongoClient> | undefined;

function getClient(): Promise<MongoClient> {
  if (clientPromise) return clientPromise;

  const serverEnv = getServerEnv();
  const configuredUri = serverEnv.MONGODB_URI;
  if (serverEnv.NODE_ENV === "production" && !configuredUri) {
    throw new Error("MONGODB_URI must be configured in production.");
  }
  const uri = configuredUri || "mongodb://localhost:27017/mawee";

  if (serverEnv.NODE_ENV === "development") {
    // Reuse the connection across HMR reloads in dev.
    if (!global._maweeMongoClientPromise) {
      global._maweeMongoClientPromise = new MongoClient(uri).connect();
    }
    clientPromise = global._maweeMongoClientPromise;
  } else {
    clientPromise = new MongoClient(uri).connect();
  }
  // Don't cache a failed connect, or one Mongo outage breaks every later request.
  clientPromise.catch(() => {
    clientPromise = undefined;
    global._maweeMongoClientPromise = undefined;
  });
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(); // resolves db name from the URI path (`mawee`)
}

export async function getDeposits(): Promise<Collection<DepositDoc>> {
  return (await getDb()).collection<DepositDoc>("deposits");
}

export async function getUsernames(): Promise<Collection<UsernameDoc>> {
  return (await getDb()).collection<UsernameDoc>("usernames");
}

export async function getIndexerState(): Promise<Collection<IndexerStateDoc>> {
  return (await getDb()).collection<IndexerStateDoc>("indexer_state");
}

export async function getSpentNullifiers(): Promise<
  Collection<SpentNullifierDoc>
> {
  return (await getDb()).collection<SpentNullifierDoc>("spent_nullifiers");
}

export async function getUsers(): Promise<Collection<UserDoc>> {
  return (await getDb()).collection<UserDoc>("users");
}

export async function getPaymentLinks(): Promise<Collection<PaymentLinkDoc>> {
  return (await getDb()).collection<PaymentLinkDoc>("payment_links");
}

export async function getPaymentRequests(): Promise<
  Collection<PaymentRequestDoc>
> {
  return (await getDb()).collection<PaymentRequestDoc>("payment_requests");
}
