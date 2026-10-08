import { toHex, verifyTypedData } from "viem";
import { z } from "zod";
import { isSpent } from "../../lib/chain";
import { commitment, nullifier, ownerPk, toBE32 } from "../../lib/crypto";
import type { LocalAccount, MyNote, ScanResult } from "../../lib/notes";
import { api } from "../../trpc/client";
import {
  accountForGeneration,
  accountForParticipants,
  privacyAccountPubkeys,
  samePublicKeys,
} from "../privacyKeys/keyRing";
import type { LocalPrivacyKeyring } from "../privacyKeys/types";
import { localParticipantKeys } from "../requests/requestCrypto";
import { SNARK_FIELD } from "../requests/validation";
import { openTransfer, openTransferEnvelope } from "./transferCrypto";
import { recoveryBinding } from "./transferProofs";
import { transferSubmissionTypedData } from "./transferTypedData";
import type {
  ConfirmedTransferStep,
  PoolDescriptor,
  SignedTransferSubmission,
  TransferEvidence,
  TransferPage,
  TransferPayload,
  TransferRecord,
  TransferRecoveryPage,
} from "./types";

const integer = (bound: bigint) =>
  z
    .string()
    .regex(/^(0|[1-9]\d{0,77})$/)
    .refine((v) => BigInt(v) < bound);
const recoverySchema = z
  .array(
    z.strictObject({
      position: z.number().int().min(0).max(1),
      amount: integer(1n << 64n),
      salt: integer(SNARK_FIELD),
      commitment: z.string().regex(/^0x[0-9a-f]{64}$/),
      generation: z.number().int().min(0).max(63).optional(),
    }),
  )
  .max(2);
export async function recoverTransferNotes(input: {
  record: TransferRecord;
  submissions: readonly SignedTransferSubmission[];
  evidence: readonly ConfirmedTransferStep[];
  account: LocalAccount;
  keyring?: LocalPrivacyKeyring;
  scan: ScanResult;
  pool: PoolDescriptor;
  isSpent?: (nf: Uint8Array) => Promise<boolean>;
}): Promise<readonly MyNote[]> {
  const { record: r, account, scan, pool } = input;
  if (scan.scope !== r.pool || pool.scope !== r.pool)
    throw new Error("Transfer recovery pool mismatch.");
  let payload: TransferPayload;
  try {
    payload = await openTransfer(r, account, pool);
  } catch {
    return [];
  }
  const pk = await ownerPk(account.ownerSecret),
    notes = new Map<number, MyNote>();
  const add = async (
    amount: bigint,
    salt: bigint,
    expected: string,
    leafIndex: number,
    at: string,
    internal = false,
    owningAccount = account,
    generation?: number,
  ) => {
    if (amount <= 0n) return;
    const comm = await commitment(
      amount,
      await ownerPk(owningAccount.ownerSecret),
      salt,
    );
    if (comm !== BigInt(expected) || scan.leaves[leafIndex] !== comm) return;
    const existing = scan.notes.find(
      (n) => n.scope === r.pool && n.leafIndex === leafIndex,
    );
    const nf = toBE32(await nullifier(owningAccount.ownerSecret, leafIndex)),
      spent =
        existing?.spent ??
        (await (input.isSpent ? input.isSpent(nf) : isSpent(nf, pool)));
    notes.set(leafIndex, {
      scope: r.pool,
      leafIndex,
      amount,
      salt,
      spent,
      receivedAt: at,
      nullifierHex: toHex(nf),
      internal,
      ...(generation === undefined ? {} : { keyGeneration: generation }),
    });
  };
  if (
    pk === BigInt(r.recipient.notePubkey) &&
    r.status === "confirmed" &&
    r.receipt
  )
    await add(
      BigInt(payload.amount),
      BigInt(payload.salt),
      r.recipientCommitment,
      r.receipt.leafIndex,
      r.receipt.confirmedAt,
    );
  if (pk === BigInt(r.sender.notePubkey))
    for (const s of input.submissions) {
      if (
        s.transferId !== r.id ||
        s.operationId !== r.operationId ||
        s.pool !== r.pool
      )
        continue;
      const step = input.evidence.find((e) => e.step === s.step);
      if (!step) continue;
      try {
        if (
          !(await verifyTypedData({
            address: r.sender.wallet,
            ...transferSubmissionTypedData(s),
            signature: s.signature,
          }))
        )
          continue;
        const decoded = openTransferEnvelope(
          s.recoveryEnvelope,
          account,
          recoveryBinding(s),
        );
        const outputs = Array.isArray(decoded)
          ? recoverySchema.parse(decoded)
          : z
              .strictObject({
                version: z.literal(2),
                outputs: recoverySchema.refine((outputs) =>
                  outputs.every((output) => output.generation !== undefined),
                ),
              })
              .parse(decoded).outputs;
        for (const o of outputs) {
          const e = step.outputs.find((e) => e.position === o.position);
          if (
            !e ||
            e.commitment.toLowerCase() !== o.commitment.toLowerCase() ||
            s.outputs[o.position]?.commitment.toLowerCase() !==
              o.commitment.toLowerCase()
          )
            continue;
          await add(
            BigInt(o.amount),
            BigInt(o.salt),
            o.commitment,
            e.leafIndex,
            step.confirmedAt,
            true,
            o.generation === undefined
              ? account
              : input.keyring
                ? accountForGeneration(input.keyring, o.generation)
                : o.generation === 0
                  ? account
                  : (() => {
                      throw new Error("Owned output generation is unavailable");
                    })(),
            o.generation,
          );
        }
      } catch {
        /* Invalid encrypted metadata never adds spendable funds. */
      }
    }
  return [...notes.values()];
}
export async function recoverParticipantTransfers(
  account: LocalAccount,
  pool: PoolDescriptor,
  scan: ScanResult,
  ports: TransferRecoveryPorts = defaultRecoveryPorts,
  ring?: LocalPrivacyKeyring,
): Promise<ScanResult> {
  if (scan.scope !== pool.scope) return scan;
  let cursor: string | undefined,
    pages = 0;
  const recovered = new Map<number, MyNote>();
  const keys = await localParticipantKeys(account),
    cache =
      terminalRecovery.get(account) ?? new Map<string, TransferEvidence>(),
    progress = pendingRecovery.get(account) ?? new Map<string, BatchProgress>();
  terminalRecovery.set(account, cache);
  pendingRecovery.set(account, progress);
  const retained = ring
    ? await Promise.all([...ring.accounts.values()].map(privacyAccountPubkeys))
    : [keys];
  const ownSender = (r: TransferRecord) =>
    retained.some((pair) => samePublicKeys(pair, r.sender));
  const cacheKey = (r: TransferRecord) =>
    `${r.pool}:${r.id}:${r.revision}:${r.status}`;
  do {
    const page = await ports.list(cursor);
    const targets = page.items.filter(
      (r) => r.pool === pool.scope && ownSender(r) && !cache.has(cacheKey(r)),
    );
    const batchKey = targets.map(cacheKey).sort().join("|");
    let batch = progress.get(batchKey);
    if (targets.length) {
      batch ??= {
        cursor: undefined,
        evidence: new Map(
          targets.map((r) => [r.id, { submissions: [], steps: [] }]),
        ),
        done: false,
      };
      progress.set(batchKey, batch);
      for (let count = 0; !batch.done && count < 1000; count++) {
        const result = await ports.batch({
          ids: targets.map((r) => r.id),
          cursor: batch.cursor,
        });
        for (const item of result.items) {
          const owned = batch.evidence.get(item.transferId);
          if (!owned) continue;
          owned.submissions.push(item.submission);
          if (item.evidence) owned.steps.push(item.evidence);
        }
        batch.cursor = result.nextCursor ?? undefined;
        batch.done = !result.nextCursor;
      }
      if (!batch.done)
        throw new Error(
          "Transfer recovery is still loading. Try again shortly.",
        );
      for (const r of targets) {
        const value = batch.evidence.get(r.id);
        if (r.status !== "pending" && value) cache.set(cacheKey(r), value);
      }
    }
    for (const record of page.items) {
      const receipt = record.receipt;
      if (record.pool !== pool.scope) continue;
      const sender = ownSender(record);
      if (
        !sender &&
        receipt &&
        scan.notes.some(
          (n) => n.scope === record.pool && n.leafIndex === receipt.leafIndex,
        )
      )
        continue;
      const evidence = sender
        ? (cache.get(cacheKey(record)) ??
          batch?.evidence.get(record.id) ?? { submissions: [], steps: [] })
        : { submissions: [], steps: [] };
      let owned: LocalAccount;
      try {
        owned = await accountForParticipants(
          account,
          sender ? [record.sender] : [record.recipient],
          ring ?? null,
        );
      } catch {
        continue;
      }
      const generation = ring
        ? [...ring.accounts].find(([, candidate]) => candidate === owned)?.[0]
        : undefined;
      for (const note of await recoverTransferNotes({
        record,
        submissions: evidence.submissions,
        evidence: evidence.steps,
        account: owned,
        keyring: ring,
        scan,
        pool,
      }))
        recovered.set(
          note.leafIndex,
          note.keyGeneration !== undefined || generation === undefined
            ? note
            : { ...note, keyGeneration: generation },
        );
    }
    if (batch?.done) progress.delete(batchKey);
    cursor = page.nextCursor ?? undefined;
    if (++pages >= 120 && cursor)
      throw new Error(
        "Transfer history is still restoring. Try again shortly.",
      );
  } while (cursor);
  const notes = [
    ...new Map(
      [...scan.notes, ...recovered.values()].map((n) => [n.leafIndex, n]),
    ).values(),
  ].sort((a, b) => a.leafIndex - b.leafIndex);
  return {
    ...scan,
    notes,
    claimable: notes.filter((n) => !n.spent).reduce((a, n) => a + n.amount, 0n),
  };
}
export type TransferRecoveryPorts = {
  list: (cursor: string | undefined) => Promise<TransferPage>;
  batch: (input: {
    ids: string[];
    cursor?: string;
  }) => Promise<TransferRecoveryPage>;
};
type BatchProgress = {
  cursor: string | undefined;
  evidence: Map<string, TransferEvidence>;
  done: boolean;
};
const terminalRecovery = new WeakMap<
  LocalAccount,
  Map<string, TransferEvidence>
>();
const pendingRecovery = new WeakMap<LocalAccount, Map<string, BatchProgress>>();
const defaultRecoveryPorts: TransferRecoveryPorts = {
  list: (cursor) => api.transfers.list.query({ direction: "all", cursor }),
  batch: (input) => api.transfers.recoveryBatch.query(input),
};
