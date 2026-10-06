import "server-only";
import { verifyTypedData } from "viem";
import {
  transferDigest,
  transferTypedData,
} from "../../../features/transfers/transferTypedData";
import type {
  SignedTransfer,
  TransferParticipant,
} from "../../../features/transfers/types";
import { signedTransferSchema } from "../../../features/transfers/validation";
import { requirePaymentPool } from "../../../lib/paymentAsset";
import type { PoolScope } from "../../../lib/pools";
import { getDb } from "../../db/mongo";
import { rateLimit } from "../../lib/rateLimit";
import { resolveUsername } from "../usernames/usernames.service";
import { currentWallet } from "../wallets/wallets.service";
import {
  TransferNotFoundError,
  TransferRejectedError,
  TransferUnavailableError,
} from "./transfers.errors";
import { publicRecord, TransferRepository } from "./transfers.repository";
export async function transferRepo() {
  const repo = new TransferRepository(await getDb());
  await repo.ensureIndexes();
  return repo;
}
export async function transferCaller(user: string) {
  const wallet = await currentWallet(user);
  if (!wallet) throw new TransferNotFoundError();
  return wallet.address.toLowerCase();
}
export function enforceTransferLimit(
  user: string,
  kind: "create" | "query" | "submit",
) {
  if (
    !rateLimit(`transfers:${kind}:${user}`, kind === "query" ? 480 : 20, 60_000)
      .ok
  )
    throw new TransferUnavailableError("Too many attempts. Try again shortly.");
}
async function registered(p: TransferParticipant) {
  const r = await resolveUsername(p.username);
  const strip = (s: string) => s.replace(/^0x/, "").toLowerCase();
  if (
    !r ||
    r.owner.toLowerCase() !== p.wallet.toLowerCase() ||
    strip(r.notePubkeyHex) !== strip(p.notePubkey) ||
    strip(r.viewPubkeyHex) !== strip(p.viewPubkey)
  )
    throw new TransferRejectedError(
      "The recipient or account keys changed. Review the recipient again.",
    );
}
export async function createTransfer(user: string, input: SignedTransfer) {
  enforceTransferLimit(user, "create");
  const record = signedTransferSchema.parse(input),
    wallet = await transferCaller(user);
  try {
    requirePaymentPool(record.pool, "transfer");
  } catch {
    throw new TransferUnavailableError();
  }
  if (record.sender.wallet.toLowerCase() !== wallet)
    throw new TransferRejectedError("Sign with your own sending account.");
  if (
    !(await verifyTypedData({
      address: record.sender.wallet,
      ...transferTypedData(record),
      signature: record.signature,
    }))
  )
    throw new TransferRejectedError("The transfer signature is invalid.");
  const repo = await transferRepo(),
    prior = await repo.collection.findOne({ _id: record.id });
  if (prior && prior.digest === transferDigest(record))
    return publicRecord(prior);
  if (Math.abs(Date.now() - Date.parse(record.createdAt)) > 10 * 60_000)
    throw new TransferRejectedError("Refresh this transfer before sending.");
  await Promise.all([registered(record.sender), registered(record.recipient)]);
  return repo.create(record);
}
export async function getTransfer(user: string, id: string) {
  enforceTransferLimit(user, "query");
  return (await transferRepo()).get(await transferCaller(user), id);
}
export async function listTransfers(
  user: string,
  input: { direction: "sent" | "received" | "all"; cursor?: string },
) {
  enforceTransferLimit(user, "query");
  return (await transferRepo()).list(await transferCaller(user), input);
}
export async function pendingTransfer(user: string, pool?: PoolScope) {
  enforceTransferLimit(user, "query");
  return (await transferRepo()).pending(await transferCaller(user), pool);
}
