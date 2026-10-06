import { hexToBytes, toBytes, toHex } from "viem";
import {
  merkleProof,
  nullifier,
  ownerPk,
  randomFieldElement,
  toBE32,
  viewPubkey,
} from "../../lib/crypto";
import { proveMerge, proveTransfer } from "../../lib/prover";
import type { FundingAction } from "../payments/funding";
import { createNoteOutput, proofWire } from "../payments/proofOutputs";
import { localParticipantKeys } from "../requests/requestCrypto";
import { openTransfer, sealTransferEnvelope } from "./transferCrypto";
import { transferSubmissionTypedData } from "./transferTypedData";
import type {
  SignedTransferSubmission,
  TransferProofContext,
  TransferSubmissionBody,
} from "./types";

export type OwnedRecoveryOutput = {
  position: number;
  amount: string;
  salt: string;
  commitment: `0x${string}`;
};
export function recoveryBinding(s: {
  pool: string;
  transferId: string;
  operationId: string;
  step: number;
  kind: string;
}) {
  return toBytes(
    JSON.stringify([
      "mawee.transfer.recovery.v1",
      s.pool,
      s.transferId,
      s.operationId,
      s.step,
      s.kind,
    ]),
  );
}
export async function buildTransferSubmission(
  c: TransferProofContext,
  action: FundingAction,
): Promise<SignedTransferSubmission> {
  const { record: r, operation: op, account, scan, pool, signer } = c,
    keys = await localParticipantKeys(account);
  if (
    scan.scope !== r.pool ||
    pool.scope !== r.pool ||
    pool.role !== "active" ||
    !pool.requestCapable ||
    scan.health !== "healthy" ||
    op.transferId !== r.id ||
    op.id !== r.operationId ||
    op.phase !== "preparing" ||
    signer.address.toLowerCase() !== r.sender.wallet.toLowerCase() ||
    keys.notePubkey.toLowerCase() !== r.sender.notePubkey.toLowerCase() ||
    keys.viewPubkey.toLowerCase() !== r.sender.viewPubkey.toLowerCase()
  )
    throw new Error("Unlock the sending account and refresh its balance.");
  const payload = await openTransfer(r, account, pool),
    pk = await ownerPk(account.ownerSecret);
  const owned = (index: number) => {
    const n = scan.notes.find(
      (n) =>
        n.scope === r.pool &&
        n.leafIndex === index &&
        !n.spent &&
        n.amount > 0n,
    );
    if (!n) throw new Error("The balance changed. Refresh before sending.");
    return n;
  };
  const base = {
    version: 1 as const,
    transferId: r.id,
    operationId: op.id,
    step: op.nextStep,
    pool: r.pool,
    kind: action.kind,
  };
  let body: Omit<TransferSubmissionBody, "recoveryEnvelope">;
  let recovery: OwnedRecoveryOutput[];
  if (action.kind === "merge") {
    const [ai, bi] = action.inputIndices;
    if (ai === bi) throw new Error("Choose distinct notes.");
    const a = owned(ai),
      b = owned(bi),
      sum = a.amount + b.amount,
      salt = randomFieldElement();
    if (sum > (1n << 64n) - 1n)
      throw new Error("Split this balance before combining it.");
    const paths = await Promise.all([
      merkleProof(scan.leaves, ai, pool.depth),
      merkleProof(scan.leaves, bi, pool.depth),
    ]);
    if (paths[0].root !== paths[1].root)
      throw new Error("Refresh this balance.");
    const nfs = await Promise.all([
      nullifier(account.ownerSecret, ai),
      nullifier(account.ownerSecret, bi),
    ]);
    const output = await createNoteOutput(
      sum,
      pk,
      viewPubkey(account.viewSk),
      salt,
    );
    const proof = await proveMerge(
      {
        root: String(paths[0].root),
        nullifierA: String(nfs[0]),
        nullifierB: String(nfs[1]),
        outCommitment: String(BigInt(output.commitment)),
        ownerSecret: String(account.ownerSecret),
        amounts: [String(a.amount), String(b.amount)],
        salts: [String(a.salt), String(b.salt)],
        pathElements: [
          paths[0].pathElements.map(String),
          paths[1].pathElements.map(String),
        ],
        pathIndices: [paths[0].pathIndices, paths[1].pathIndices],
        outSalt: String(salt),
      },
      c.artifactRoot,
    );
    body = {
      ...base,
      root: toHex(toBE32(paths[0].root)),
      nullifiers: nfs.map((n) => toHex(toBE32(n))),
      proof: proofWire(proof.proof),
      outputs: [output],
    };
    recovery = [
      {
        position: 0,
        amount: String(sum),
        salt: String(salt),
        commitment: output.commitment,
      },
    ];
  } else {
    const n = owned(action.inputIndex),
      amount =
        action.kind === "payment" ? BigInt(payload.amount) : action.amount;
    if (amount <= 0n || amount > n.amount)
      throw new Error("Your private balance is too low.");
    const recipientPk =
        action.kind === "payment" ? BigInt(r.recipient.notePubkey) : pk,
      recipientView =
        action.kind === "payment"
          ? hexToBytes(r.recipient.viewPubkey)
          : viewPubkey(account.viewSk),
      salt =
        action.kind === "payment" ? BigInt(payload.salt) : randomFieldElement(),
      changeSalt = randomFieldElement();
    const path = await merkleProof(scan.leaves, n.leafIndex, pool.depth),
      nf = await nullifier(account.ownerSecret, n.leafIndex);
    const recipient = await createNoteOutput(
        amount,
        recipientPk,
        recipientView,
        salt,
      ),
      change = await createNoteOutput(
        n.amount - amount,
        pk,
        viewPubkey(account.viewSk),
        changeSalt,
      );
    if (
      action.kind === "payment" &&
      recipient.commitment !== r.recipientCommitment
    )
      throw new Error("The recipient commitment changed.");
    const proof = await proveTransfer(
      {
        root: String(path.root),
        nullifier: String(nf),
        outCommitmentRecipient: String(BigInt(recipient.commitment)),
        outCommitmentChange: String(BigInt(change.commitment)),
        inAmount: String(n.amount),
        ownerSecret: String(account.ownerSecret),
        inSalt: String(n.salt),
        pathElements: path.pathElements.map(String),
        pathIndices: path.pathIndices,
        recipientPk: String(recipientPk),
        recipientAmount: String(amount),
        recipientSalt: String(salt),
        changeAmount: String(n.amount - amount),
        changeSalt: String(changeSalt),
      },
      c.artifactRoot,
    );
    body = {
      ...base,
      root: toHex(toBE32(path.root)),
      nullifiers: [toHex(toBE32(nf))],
      proof: proofWire(proof.proof),
      outputs: [recipient, change],
    };
    recovery = [
      ...(action.kind === "split"
        ? [
            {
              position: 0,
              amount: String(amount),
              salt: String(salt),
              commitment: recipient.commitment,
            },
          ]
        : []),
      {
        position: 1,
        amount: String(n.amount - amount),
        salt: String(changeSalt),
        commitment: change.commitment,
      },
    ];
  }
  const full: TransferSubmissionBody = {
    ...body,
    recoveryEnvelope: sealTransferEnvelope(
      recovery,
      r.sender.viewPubkey,
      recoveryBinding(body),
    ),
  };
  const signature = await signer.walletClient.signTypedData({
    account: signer.walletClient.account ?? signer.address,
    ...transferSubmissionTypedData(full),
  });
  return { ...full, signature };
}
