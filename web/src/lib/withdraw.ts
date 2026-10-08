import { getAddress } from "viem";
import { accountForNote } from "../features/privacyKeys/keyRing";
import { getPrivacyKeyring } from "../features/privacyKeys/session";
import { api } from "../trpc/client";
import {
  isEvmAddress,
  poolWithdraw,
  revertErrorName,
  type Signer,
} from "./chain";
import {
  commitment,
  merkleProof,
  nullifier as nullifierHash,
  ownerPk,
  recipientField,
  TREE_DEPTH,
  toBE32,
} from "./crypto";
import type { LocalAccount, MyNote, ScanResult } from "./notes";
import { resolvePool } from "./pools";
import { proveWithdraw, type WithdrawInput } from "./prover";

export type WithdrawResult = {
  provingMs: number;
  txHash: string;
};

export type BatchWithdrawResult = {
  total: bigint; // base units successfully cashed out
  succeeded: WithdrawResult[]; // per-note results, largest-first order
  failed: { leafIndex: number; amount: bigint; error: string }[];
};

export function isAlreadyCashedOut(error: unknown): boolean {
  return revertErrorName(error) === "DoubleSpend";
}

const ALREADY_CASHED_OUT_MESSAGE =
  "This payment was already cashed out. Refreshing your balance…";

export function claimableNotes(notes: MyNote[]): MyNote[] {
  return notes
    .filter((n) => !n.spent)
    .sort((a, b) => (a.amount === b.amount ? 0 : a.amount > b.amount ? -1 : 1));
}

export function largestNote(notes: MyNote[]): bigint {
  return claimableNotes(notes).reduce(
    (max, n) => (n.amount > max ? n.amount : max),
    0n,
  );
}

/// A destination must be a Monad (EVM) address.
export function isValidDestination(address: string): boolean {
  return isEvmAddress(address);
}

export async function withdrawNote(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  destination: string;
}): Promise<WithdrawResult> {
  const { signer, acct, scan, note, destination } = params;
  if (!isValidDestination(destination)) {
    throw new Error("Enter a valid Monad address (0x…).");
  }
  return directWithdraw({
    signer,
    acct,
    scan,
    note,
    dest: getAddress(destination.trim()),
  });
}

export async function withdrawAll(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  notes: MyNote[];
  destination: string;
}): Promise<BatchWithdrawResult> {
  const { signer, acct, scan, notes, destination } = params;
  if (!isValidDestination(destination)) {
    throw new Error("Enter a valid Monad address (0x…).");
  }
  const dest = getAddress(destination.trim());
  if (notes.some((n) => n.scope !== scan.scope)) {
    throw new Error("Withdraw from one pool at a time.");
  }

  const succeeded: WithdrawResult[] = [];
  const failed: BatchWithdrawResult["failed"] = [];
  let total = 0n;

  for (const note of claimableNotes(notes)) {
    try {
      succeeded.push(await directWithdraw({ signer, acct, scan, note, dest }));
      total += note.amount;
    } catch (error) {
      failed.push({
        leafIndex: note.leafIndex,
        amount: note.amount,
        error: isAlreadyCashedOut(error)
          ? ALREADY_CASHED_OUT_MESSAGE
          : error instanceof Error
            ? error.message
            : "Withdrawal failed.",
      });
    }
  }

  return { total, succeeded, failed };
}

async function directWithdraw(params: {
  signer: Signer;
  acct: LocalAccount;
  scan: ScanResult;
  note: MyNote;
  dest: string;
}): Promise<WithdrawResult> {
  const { signer, scan, note, dest } = params;
  const ring = getPrivacyKeyring();
  const acct = ring ? accountForNote(ring, note) : params.acct;
  // A note's Merkle path and nullifier are only meaningful in its own pool.
  if (note.scope !== scan.scope) {
    throw new Error("This balance belongs to a different pool.");
  }
  const pool = resolvePool(note.scope);
  if (!ring && note.keyGeneration !== undefined && note.keyGeneration !== 0)
    throw new Error(
      "Unlock the retained privacy key history for this payment.",
    );
  if (
    note.leafIndex < 0 ||
    !Number.isInteger(note.leafIndex) ||
    note.amount <= 0n ||
    scan.leaves[note.leafIndex] !==
      (await commitment(
        note.amount,
        await ownerPk(acct.ownerSecret),
        note.salt,
      ))
  )
    throw new Error(
      "This payment does not match its owning privacy key and pool leaf.",
    );

  const mp = await merkleProof(scan.leaves, note.leafIndex, TREE_DEPTH);
  const nf = await nullifierHash(acct.ownerSecret, note.leafIndex);

  const input: WithdrawInput = {
    root: mp.root.toString(),
    nullifier: nf.toString(),
    recipient: recipientField(dest).toString(),
    amount: note.amount.toString(),
    ownerSecret: acct.ownerSecret.toString(),
    salt: note.salt.toString(),
    pathElements: mp.pathElements.map((x) => x.toString()),
    pathIndices: mp.pathIndices,
  };

  const { proof, ms } = await proveWithdraw(input);
  if (ring && getPrivacyKeyring() !== ring)
    throw new Error("Privacy key session changed during cash-out.");
  const operationId = crypto.randomUUID();
  const capture = ring
    ? await api.privacyKeys.admitCashout.mutate({
        operationId,
        fundingGeneration: note.keyGeneration ?? 0,
        keyRevision: ring.revision,
        pool: pool.scope,
        nullifier: `0x${Array.from(toBE32(nf), (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
      })
    : null;
  if (
    capture?.accountTicketId &&
    capture.fundingGeneration !== undefined &&
    capture.keyRevision !== undefined
  ) {
    if (getPrivacyKeyring() !== ring) {
      await api.privacyKeys.cancelCashout.mutate({
        operationId: capture.operationId,
      });
      throw new Error("Privacy key session changed during cash-out.");
    }
    await api.privacyKeys.dispatchCashout.mutate({
      operationId: capture.operationId,
      accountTicketId: capture.accountTicketId,
      fundingGeneration: capture.fundingGeneration,
      keyRevision: capture.keyRevision,
    });
  }
  const txHash = await poolWithdraw(
    signer,
    dest,
    note.amount,
    toBE32(mp.root),
    toBE32(nf),
    proof,
    pool,
  );
  if (
    capture?.accountTicketId &&
    capture.fundingGeneration !== undefined &&
    capture.keyRevision !== undefined
  )
    await api.privacyKeys.finishCashout
      .mutate({
        operationId: capture.operationId,
        accountTicketId: capture.accountTicketId,
        fundingGeneration: capture.fundingGeneration,
        keyRevision: capture.keyRevision,
      })
      .catch(() => {
        /* The durable operation is reconciled before the next rotation. */
      });
  return { provingMs: ms, txHash };
}
