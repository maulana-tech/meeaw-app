import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, randomBytes } from "@noble/hashes/utils.js";
import { hexToBytes, toBytes, toHex, verifyTypedData } from "viem";
import { poseidonHash, randomFieldElement, toBE32 } from "../../lib/crypto";
import type { LocalAccount } from "../../lib/notes";
import { localParticipantKeys } from "../requests/requestCrypto";
import { transferMetadataHash, transferTypedData } from "./transferTypedData";
import type {
  CreateTransferInput,
  Envelope,
  Hex,
  PoolDescriptor,
  SignedTransfer,
  TransferPayload,
} from "./types";
import {
  signedTransferSchema,
  transferMetadataSchema,
  transferPayloadSchema,
  validateTransferNote,
} from "./validation";

const DOMAIN = toBytes("mawee.transfer.envelope.v1");
const FRAME = 4096;
export class TransferUnreadableError extends Error {
  constructor() {
    super("This transfer cannot be opened with your account.");
    this.name = "TransferUnreadableError";
  }
}
export function sealTransferEnvelope(
  value: unknown,
  viewPk: Hex,
  binding: Uint8Array,
): Envelope {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  if (encoded.length > FRAME - 4)
    throw new Error("Transfer metadata is too large.");
  const frame = randomBytes(FRAME),
    secret = x25519.utils.randomSecretKey(),
    epk = x25519.getPublicKey(secret),
    recipient = hexToBytes(viewPk);
  new DataView(frame.buffer).setUint32(0, encoded.length, false);
  frame.set(encoded, 4);
  let key: Uint8Array | undefined;
  try {
    key = hkdf(
      sha256,
      x25519.getSharedSecret(secret, recipient),
      concatBytes(epk, recipient),
      DOMAIN,
      32,
    );
    const nonce = randomBytes(24),
      encrypted = xchacha20poly1305(
        key,
        nonce,
        concatBytes(DOMAIN, binding),
      ).encrypt(frame);
    return {
      ephemeralPk: toHex(epk),
      ciphertext: toHex(concatBytes(nonce, encrypted)),
    };
  } finally {
    secret.fill(0);
    key?.fill(0);
    frame.fill(0);
    encoded.fill(0);
  }
}
export function openTransferEnvelope(
  envelope: Envelope,
  account: LocalAccount,
  binding: Uint8Array,
): unknown {
  let key: Uint8Array | undefined, frame: Uint8Array | undefined;
  try {
    const epk = hexToBytes(envelope.ephemeralPk),
      recipient = x25519.getPublicKey(account.viewSk),
      bytes = hexToBytes(envelope.ciphertext);
    if (bytes.length !== 4136) throw new TransferUnreadableError();
    key = hkdf(
      sha256,
      x25519.getSharedSecret(account.viewSk, epk),
      concatBytes(epk, recipient),
      DOMAIN,
      32,
    );
    frame = xchacha20poly1305(
      key,
      bytes.subarray(0, 24),
      concatBytes(DOMAIN, binding),
    ).decrypt(bytes.subarray(24));
    const length = new DataView(
      frame.buffer,
      frame.byteOffset,
      frame.byteLength,
    ).getUint32(0, false);
    if (frame.length !== FRAME || length > FRAME - 4)
      throw new TransferUnreadableError();
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        frame.subarray(4, 4 + length),
      ),
    );
  } catch {
    throw new TransferUnreadableError();
  } finally {
    key?.fill(0);
    frame?.fill(0);
  }
}
async function commitment(amount: bigint, pk: Hex, salt: bigint) {
  return toHex(toBE32(await poseidonHash([amount, BigInt(pk), salt])));
}
export async function createSignedTransfer(
  input: CreateTransferInput,
): Promise<SignedTransfer> {
  const keys = await localParticipantKeys(input.account);
  if (
    input.pool.role !== "active" ||
    !(input.pool.transferCapable ?? input.pool.requestCapable) ||
    input.amount <= 0n ||
    input.amount > (1n << 64n) - 1n
  )
    throw new Error("This balance cannot fund the transfer.");
  if (
    input.signer.address.toLowerCase() !== input.sender.wallet.toLowerCase() ||
    keys.notePubkey.toLowerCase() !== input.sender.notePubkey.toLowerCase() ||
    keys.viewPubkey.toLowerCase() !== input.sender.viewPubkey.toLowerCase()
  )
    throw new Error("Unlock the sending account.");
  const salt = randomFieldElement();
  const metadata = transferMetadataSchema.parse({
    version: 1,
    id: input.id,
    pool: input.pool.scope,
    sender: input.sender,
    recipient: input.recipient,
    createdAt: input.createdAt,
    recipientCommitment: await commitment(
      input.amount,
      input.recipient.notePubkey,
      salt,
    ),
  });
  const payload: TransferPayload = {
    metadata,
    amount: input.amount.toString(),
    note: validateTransferNote(input.note),
    salt: salt.toString(),
  };
  const binding = hexToBytes(transferMetadataHash(metadata));
  const unsigned = {
    ...metadata,
    senderEnvelope: sealTransferEnvelope(
      payload,
      input.sender.viewPubkey,
      concatBytes(Uint8Array.of(1), binding),
    ),
    recipientEnvelope: sealTransferEnvelope(
      payload,
      input.recipient.viewPubkey,
      concatBytes(Uint8Array.of(2), binding),
    ),
  };
  const signature = await input.signer.walletClient.signTypedData({
    account: input.signer.walletClient.account ?? input.signer.address,
    ...transferTypedData(unsigned),
  });
  return { ...unsigned, signature };
}
export function signedTransferOf(record: SignedTransfer): SignedTransfer {
  return {
    version: record.version,
    id: record.id,
    pool: record.pool,
    sender: record.sender,
    recipient: record.recipient,
    createdAt: record.createdAt,
    recipientCommitment: record.recipientCommitment,
    senderEnvelope: record.senderEnvelope,
    recipientEnvelope: record.recipientEnvelope,
    signature: record.signature,
  };
}
export async function openTransfer(
  record: SignedTransfer,
  account: LocalAccount,
  pool: PoolDescriptor,
): Promise<TransferPayload> {
  try {
    const r = signedTransferSchema.parse(signedTransferOf(record));
    if (
      r.pool !== pool.scope ||
      !(await verifyTypedData({
        address: r.sender.wallet,
        ...transferTypedData(r),
        signature: r.signature,
      }))
    )
      throw new TransferUnreadableError();
    const keys = await localParticipantKeys(account);
    const role =
      keys.viewPubkey.toLowerCase() === r.sender.viewPubkey.toLowerCase()
        ? 1
        : keys.viewPubkey.toLowerCase() === r.recipient.viewPubkey.toLowerCase()
          ? 2
          : 0;
    const participant = role === 1 ? r.sender : r.recipient;
    if (
      !role ||
      keys.notePubkey.toLowerCase() !== participant.notePubkey.toLowerCase()
    )
      throw new TransferUnreadableError();
    const payload = transferPayloadSchema.parse(
      openTransferEnvelope(
        role === 1 ? r.senderEnvelope : r.recipientEnvelope,
        account,
        concatBytes(Uint8Array.of(role), hexToBytes(transferMetadataHash(r))),
      ),
    );
    if (
      transferMetadataHash(payload.metadata) !== transferMetadataHash(r) ||
      (await commitment(
        BigInt(payload.amount),
        r.recipient.notePubkey,
        BigInt(payload.salt),
      )) !== r.recipientCommitment
    )
      throw new TransferUnreadableError();
    return payload;
  } catch {
    throw new TransferUnreadableError();
  }
}
