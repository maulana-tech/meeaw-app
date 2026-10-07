import { verifyReceiptMath } from "../features/receipts/receiptProof";
import type { AssetSymbol } from "./assets";
import { network } from "./chain";
import {
  bytesToHex,
  commitment as commitmentHash,
  merkleProof,
  ownerPk as ownerPkHash,
  TREE_DEPTH,
  toBE32,
} from "./crypto";
import type { LocalAccount, MyNote, ScanResult } from "./notes";
import { formatAssetUnits } from "./paymentAsset";
import { activePool, resolvePool } from "./pools";

export const DISCLOSURE_VERSION = 1 as const;

export type DisclosureBundle = {
  version: typeof DISCLOSURE_VERSION;
  pool: string;
  network: string;
  leafIndex: number;
  commitmentHex: string;
  commitment: string;
  rootHex: string;
  root: string;
  amount: string; // token base units (USDC_DECIMALS)
  amountLabel: string; // human "12.5"
  ownerPk: string;
  salt: string;
  pathElements: string[];
  pathIndices: number[];
  username: string | null;
  disclosedAt: string; // ISO-8601
  asset?: AssetSymbol;
  tokenDecimals?: number;
};

export async function buildDisclosure(params: {
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  username?: string | null;
}): Promise<DisclosureBundle> {
  const { acct, scan, note, username } = params;
  const pool = scan.scope ? resolvePool(scan.scope) : activePool();
  if (note.scope && note.scope !== pool.scope)
    throw new Error("The receipt belongs to another pool.");

  const ownerPk = await ownerPkHash(acct.ownerSecret);
  const comm = await commitmentHash(note.amount, ownerPk, note.salt);
  const mp = await merkleProof(scan.leaves, note.leafIndex, TREE_DEPTH);

  return {
    version: DISCLOSURE_VERSION,
    pool: pool.address,
    network,
    leafIndex: note.leafIndex,
    commitmentHex: bytesToHex(toBE32(comm)),
    commitment: comm.toString(),
    rootHex: bytesToHex(toBE32(mp.root)),
    root: mp.root.toString(),
    amount: note.amount.toString(),
    amountLabel: formatAssetUnits(note.amount, pool.tokenDecimals),
    asset: pool.asset,
    tokenDecimals: pool.tokenDecimals,
    ownerPk: ownerPk.toString(),
    salt: note.salt.toString(),
    pathElements: mp.pathElements.map((x) => x.toString()),
    pathIndices: mp.pathIndices,
    username: username ?? null,
    disclosedAt: new Date().toISOString(),
  };
}

export type DisclosureCheck = {
  commitmentOk: boolean;
  rootOk: boolean;
  valid: boolean;
};

export async function verifyDisclosure(
  bundle: DisclosureBundle,
): Promise<DisclosureCheck> {
  return verifyReceiptMath(bundle);
}
