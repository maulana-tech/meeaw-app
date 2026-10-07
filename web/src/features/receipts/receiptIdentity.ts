import { bytesToHex } from "../../lib/crypto";
import { normalizeReceipt, receiptWireSchema } from "./receiptSchema";
import type { ReceiptBundle, ReceiptIdentity } from "./receiptTypes";
export function canonicalReceiptJson(bundle: ReceiptBundle): string {
  const parsed = receiptWireSchema.safeParse(bundle);
  if (!parsed.success) throw new Error("Invalid receipt data.");
  const b = normalizeReceipt(parsed.data as ReceiptBundle);
  return JSON.stringify({
    version: b.version,
    pool: b.pool,
    network: b.network,
    leafIndex: b.leafIndex,
    commitmentHex: b.commitmentHex,
    commitment: b.commitment,
    rootHex: b.rootHex,
    root: b.root,
    amount: b.amount,
    amountLabel: b.amountLabel,
    ownerPk: b.ownerPk,
    salt: b.salt,
    pathElements: b.pathElements,
    pathIndices: b.pathIndices,
    username: b.username,
    disclosedAt: b.disclosedAt,
    ...(b.asset !== undefined ? { asset: b.asset } : {}),
    ...(b.tokenDecimals !== undefined
      ? { tokenDecimals: b.tokenDecimals }
      : {}),
    ...(b.version === 2 ? { anchor: b.anchor } : {}),
  });
}
export async function receiptIdentity(
  bundle: ReceiptBundle,
): Promise<ReceiptIdentity> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalReceiptJson(bundle)),
  );
  const hex = bytesToHex(new Uint8Array(digest));
  return {
    reference: `MAWEE-${hex.slice(0, 16).toUpperCase()}`,
    fingerprint: `sha256:${hex}`,
  };
}
