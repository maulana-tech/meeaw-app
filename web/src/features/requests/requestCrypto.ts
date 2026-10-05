// Two-party encrypted payment requests.
//
// The requester encrypts one fixed-size frame (amount, note, recipient salt and
// the immutable metadata) twice: once to their own viewing key and once to the
// addressee's. Each envelope uses its own ephemeral x25519 key and nonce, and
// authenticates the metadata as AAD so the server cannot move an envelope onto
// another request. Plaintext only exists in this module's call frames — never
// log, persist or include it in error messages.

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import {
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  toBytes,
  toHex,
  verifyTypedData,
} from "viem";
import type { Signer } from "../../lib/chain";
import {
  ownerPk,
  poseidonHash,
  randomFieldElement,
  bytesToHex as rawHex,
  toBE32,
} from "../../lib/crypto";
import type { LocalAccount } from "../../lib/notes";
import { requestTypedData } from "./requestTypedData";
import type {
  Envelope,
  Participant,
  PoolDescriptor,
  RequestMetadata,
  RequestPayload,
  SignedRequest,
} from "./types";
import {
  MAX_REQUEST_AMOUNT,
  REQUEST_FRAME_SIZE,
  requestMetadataSchema,
  requestPayloadSchema,
  signedRequestSchema,
  validateRequestNote,
} from "./validation";

const DOMAIN = toBytes("mawee.request.envelope.v1");
const NONCE_BYTES = 24;
const ROLE = { requester: 1, addressee: 2 } as const;
type Role = keyof typeof ROLE;

/** Generic failure: never says which check failed or echoes any content. */
export class RequestUnreadableError extends Error {
  constructor() {
    super("This request can't be opened with your account.");
    this.name = "RequestUnreadableError";
  }
}

export async function localParticipantKeys(
  account: LocalAccount,
): Promise<{ notePubkey: Hex; viewPubkey: Hex }> {
  return {
    notePubkey: toHex(toBE32(await ownerPk(account.ownerSecret))),
    viewPubkey: toHex(x25519.getPublicKey(account.viewSk)),
  };
}

// --- metadata binding (AAD) -------------------------------------------------

const participantTuple = {
  type: "tuple",
  components: [
    { name: "username", type: "string" },
    { name: "wallet", type: "address" },
    { name: "notePubkey", type: "bytes32" },
    { name: "viewPubkey", type: "bytes32" },
  ],
} as const;

function metadataBinding(m: RequestMetadata): Uint8Array {
  const participant = (p: Participant) => ({
    username: p.username,
    wallet: p.wallet,
    notePubkey: p.notePubkey,
    viewPubkey: p.viewPubkey,
  });
  return hexToBytes(
    keccak256(
      encodeAbiParameters(
        [
          { type: "uint8" },
          { type: "string" },
          { type: "string" },
          participantTuple,
          participantTuple,
          { type: "string" },
          { type: "bytes32" },
        ],
        [
          m.version,
          m.id,
          m.pool,
          participant(m.requester),
          participant(m.addressee),
          m.createdAt,
          m.recipientCommitment,
        ],
      ),
    ),
  );
}

function associatedData(m: RequestMetadata, role: Role): Uint8Array {
  return concatBytes(DOMAIN, Uint8Array.of(ROLE[role]), metadataBinding(m));
}

function metadataOf(record: RequestMetadata): RequestMetadata {
  return {
    version: record.version,
    id: record.id,
    pool: record.pool,
    requester: { ...record.requester },
    addressee: { ...record.addressee },
    createdAt: record.createdAt,
    recipientCommitment: record.recipientCommitment,
  };
}

// --- fixed-size frame ---------------------------------------------------------

// frame = uint32 BE length ‖ canonical JSON ‖ random padding (REQUEST_FRAME_SIZE).
function packPayload(payload: RequestPayload): Uint8Array {
  const canonical = {
    metadata: metadataOf(payload.metadata),
    amount: payload.amount,
    note: payload.note,
    salt: payload.salt,
  };
  const encoded = new TextEncoder().encode(JSON.stringify(canonical));
  if (encoded.length > REQUEST_FRAME_SIZE - 4)
    throw new Error("Request is too large.");
  const frame = randomBytes(REQUEST_FRAME_SIZE);
  new DataView(frame.buffer).setUint32(0, encoded.length, false);
  frame.set(encoded, 4);
  return frame;
}

function unpackPayload(frame: Uint8Array): RequestPayload {
  if (frame.length !== REQUEST_FRAME_SIZE) throw new RequestUnreadableError();
  const length = new DataView(
    frame.buffer,
    frame.byteOffset,
    frame.byteLength,
  ).getUint32(0, false);
  if (length > REQUEST_FRAME_SIZE - 4) throw new RequestUnreadableError();
  let json: unknown;
  try {
    json = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        frame.subarray(4, 4 + length),
      ),
    );
  } catch {
    throw new RequestUnreadableError();
  }
  const parsed = requestPayloadSchema.safeParse(json);
  if (!parsed.success) throw new RequestUnreadableError();
  return parsed.data as RequestPayload;
}

// --- envelopes ----------------------------------------------------------------

function envelopeKey(
  shared: Uint8Array,
  ephemeralPk: Uint8Array,
  recipientPk: Uint8Array,
): Uint8Array {
  return hkdf(
    sha256,
    shared,
    concatBytes(ephemeralPk, recipientPk),
    DOMAIN,
    32,
  );
}

function sealEnvelope(
  frame: Uint8Array,
  recipientViewPk: Hex,
  aad: Uint8Array,
): Envelope {
  const recipientPk = hexToBytes(recipientViewPk);
  const ephSk = x25519.utils.randomSecretKey();
  const ephPk = x25519.getPublicKey(ephSk);
  const key = envelopeKey(
    x25519.getSharedSecret(ephSk, recipientPk),
    ephPk,
    recipientPk,
  );
  const nonce = randomBytes(NONCE_BYTES);
  const ct = xchacha20poly1305(key, nonce, aad).encrypt(frame);
  ephSk.fill(0);
  key.fill(0);
  return {
    ephemeralPk: toHex(ephPk),
    ciphertext: toHex(concatBytes(nonce, ct)),
  };
}

function openEnvelope(
  envelope: Envelope,
  viewSk: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  try {
    const ephPk = hexToBytes(envelope.ephemeralPk);
    const myPk = x25519.getPublicKey(viewSk);
    const key = envelopeKey(x25519.getSharedSecret(viewSk, ephPk), ephPk, myPk);
    const bytes = hexToBytes(envelope.ciphertext);
    const frame = xchacha20poly1305(
      key,
      bytes.subarray(0, NONCE_BYTES),
      aad,
    ).decrypt(bytes.subarray(NONCE_BYTES));
    key.fill(0);
    return frame;
  } catch {
    throw new RequestUnreadableError();
  }
}

/** Encrypt one payload to both participants with independent randomness. */
export function sealRequest(payload: RequestPayload): {
  requesterEnvelope: Envelope;
  addresseeEnvelope: Envelope;
} {
  const m = payload.metadata;
  const frame = packPayload(payload);
  try {
    return {
      requesterEnvelope: sealEnvelope(
        frame,
        m.requester.viewPubkey,
        associatedData(m, "requester"),
      ),
      addresseeEnvelope: sealEnvelope(
        frame,
        m.addressee.viewPubkey,
        associatedData(m, "addressee"),
      ),
    };
  } finally {
    frame.fill(0);
  }
}

async function expectedCommitment(
  amount: bigint,
  notePubkey: Hex,
  salt: bigint,
): Promise<Hex> {
  return toHex(toBE32(await poseidonHash([amount, BigInt(notePubkey), salt])));
}

/**
 * Verify the requester's signature, decrypt the envelope addressed to this
 * account, and check every metadata field and the settlement commitment. Any
 * failure is reported as the same generic RequestUnreadableError.
 */
export async function openRequest(
  record: SignedRequest,
  account: LocalAccount,
  pool: PoolDescriptor,
): Promise<RequestPayload> {
  const parsed = signedRequestSchema.safeParse(record);
  if (!parsed.success) throw new RequestUnreadableError();
  const r = parsed.data as SignedRequest;
  if (r.pool !== pool.scope) throw new RequestUnreadableError();

  let signed = false;
  try {
    signed = await verifyTypedData({
      address: r.requester.wallet,
      ...requestTypedData(r),
      signature: r.signature,
    });
  } catch {
    signed = false;
  }
  if (!signed) throw new RequestUnreadableError();

  const myViewPk = rawHex(x25519.getPublicKey(account.viewSk));
  const role: Role | null =
    r.requester.viewPubkey.slice(2).toLowerCase() === myViewPk
      ? "requester"
      : r.addressee.viewPubkey.slice(2).toLowerCase() === myViewPk
        ? "addressee"
        : null;
  if (!role) throw new RequestUnreadableError();

  const metadata = metadataOf(r);
  const frame = openEnvelope(
    role === "requester" ? r.requesterEnvelope : r.addresseeEnvelope,
    account.viewSk,
    associatedData(metadata, role),
  );
  let payload: RequestPayload;
  try {
    payload = unpackPayload(frame);
  } finally {
    frame.fill(0);
  }

  const bound = (m: RequestMetadata) => toHex(metadataBinding(m));
  if (bound(payload.metadata) !== bound(metadata))
    throw new RequestUnreadableError();
  const amount = BigInt(payload.amount);
  if (amount <= 0n || amount > MAX_REQUEST_AMOUNT)
    throw new RequestUnreadableError();
  const commitment = await expectedCommitment(
    amount,
    metadata.requester.notePubkey,
    BigInt(payload.salt),
  );
  if (commitment.toLowerCase() !== metadata.recipientCommitment.toLowerCase())
    throw new RequestUnreadableError();
  return payload;
}

/**
 * Build, encrypt and sign a new request. The caller supplies the key snapshots
 * resolved for both usernames; the requester's wallet must be the signer.
 */
export async function createSignedRequest(
  input: {
    id: string;
    pool: PoolDescriptor;
    requester: Participant;
    addressee: Participant;
    amount: bigint;
    note: string;
    createdAt: string;
  },
  signer: Signer,
): Promise<{ record: SignedRequest; payload: RequestPayload }> {
  if (!input.pool.requestCapable)
    throw new Error("This pool does not accept requests.");
  if (input.amount <= 0n || input.amount > MAX_REQUEST_AMOUNT)
    throw new Error("Amount is outside the supported range.");
  if (signer.address.toLowerCase() !== input.requester.wallet.toLowerCase())
    throw new Error("Sign with the requesting account's wallet.");
  const note = validateRequestNote(input.note);
  const salt = randomFieldElement();

  const metadataInput: RequestMetadata = {
    version: 1,
    id: input.id,
    pool: input.pool.scope,
    requester: input.requester,
    addressee: input.addressee,
    createdAt: input.createdAt,
    recipientCommitment: await expectedCommitment(
      input.amount,
      input.requester.notePubkey,
      salt,
    ),
  };
  const checked = requestMetadataSchema.safeParse(metadataInput);
  if (!checked.success) throw new Error("Request details are invalid.");
  const metadata = checked.data as RequestMetadata;

  const payload: RequestPayload = {
    metadata,
    amount: input.amount.toString(),
    note,
    salt: salt.toString(),
  };
  const envelopes = sealRequest(payload);
  const unsigned = { ...metadata, ...envelopes };
  const signature = await signer.walletClient.signTypedData({
    account: signer.walletClient.account ?? signer.address,
    ...requestTypedData(unsigned),
  });
  return { record: { ...unsigned, signature }, payload };
}
