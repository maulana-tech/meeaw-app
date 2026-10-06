import "server-only";
import { parseEventLogs, verifyTypedData } from "viem";
import {
  transferSubmissionDigest,
  transferSubmissionTypedData,
} from "../../../features/transfers/transferTypedData";
import type { SignedTransferSubmission } from "../../../features/transfers/types";
import { transferSubmissionSchema } from "../../../features/transfers/validation";
import { maweePoolAbi } from "../../../lib/abi";
import { resolvePool } from "../../../lib/pools";
import { type RelayIntent, runtimeSender } from "../../lib/durableRelayer";
import { relayerConfigured } from "../../lib/relayer";
import {
  encodeTransferSubmission,
  verifyTransferReceipt,
} from "./transferSettlement";
import {
  TransferConflictError,
  TransferNotFoundError,
  TransferRejectedError,
  TransferUnavailableError,
} from "./transfers.errors";
import type { TransferDoc } from "./transfers.repository";
import {
  enforceTransferLimit,
  transferCaller,
  transferRepo,
} from "./transfers.service";

async function advance(doc: TransferDoc, rebroadcast = true) {
  const body = doc.currentSubmission;
  if (!body) return doc.operation;
  const pool = resolvePool(doc.pool),
    repo = await transferRepo(),
    runtime = await runtimeSender();
  const intent: RelayIntent = {
    operationKey: `transfer:${doc.id}:${body.step}`,
    chainId: pool.chainId,
    wallet: runtime.account.address,
    to: pool.address,
    data: encodeTransferSubmission(body),
    confirmations: pool.confirmations,
  };
  const where = {
    _id: doc._id,
    status: "pending" as const,
    "operation.id": body.operationId,
    "operation.nextStep": body.step,
  };
  try {
    const prior = await runtime.journal.read(
      `${intent.chainId}:${intent.wallet.toLowerCase()}`,
      intent.operationKey,
    );
    if (!prior?.serializedTransaction)
      await runtime.reader.call({
        account: runtime.account.address,
        to: intent.to,
        data: intent.data,
      });
    const prepared = await runtime.sender.prepare(intent);
    await repo.collection.updateOne(where, {
      $set: {
        "operation.phase": "submitted",
        "operation.txHash": prepared.txHash,
        "operation.updatedAt": new Date().toISOString(),
      },
    });
    let result = await runtime.sender.reconcile(intent);
    if (result.state === "unknown" && rebroadcast) {
      try {
        await runtime.sender.broadcast(intent);
      } catch {
        /* Keep the accepted intent and identical journal bytes. */
      }
      result = await runtime.sender.reconcile(intent);
    }
    if (result.state === "unknown") {
      await repo.collection.updateOne(where, {
        $set: { "operation.phase": "needsReconciliation" },
      });
    } else if (result.state === "reverted") {
      await repo.collection.updateOne(where, {
        $set: {
          status: "failed",
          "operation.phase": "failed",
          currentSubmission: null,
          updatedAt: new Date().toISOString(),
        },
        $inc: { revision: 1 },
      });
    } else if (result.receipt) {
      const tx = await runtime.reader.getTransaction({ hash: prepared.txHash }),
        confirmations = Number(
          (await runtime.reader.getBlockNumber()) -
            result.receipt.blockNumber +
            1n,
        );
      const verified = verifyTransferReceipt({
        pool,
        submission: body,
        transaction: { hash: tx.hash, to: tx.to, input: tx.input },
        receipt: result.receipt,
        confirmations,
        recipientCommitment: doc.recipientCommitment,
      });
      if (!verified.valid || verified.leafIndex === null)
        throw new TransferConflictError(
          "The transaction evidence is still being checked.",
        );
      const block = await runtime.reader.getBlock({
        blockNumber: result.receipt.blockNumber,
      });
      const confirmedAt = new Date(
        Number(block.timestamp) * 1000,
      ).toISOString();
      const deposits = parseEventLogs({
        abi: maweePoolAbi,
        eventName: "Deposit",
        logs: result.receipt.logs.filter(
          (l) =>
            l.address.toLowerCase() === pool.address.toLowerCase() &&
            !l.removed,
        ),
      });
      const step = {
        step: body.step,
        txHash: prepared.txHash,
        block: Number(result.receipt.blockNumber),
        confirmedAt,
        outputs: deposits.map((d, position) => ({
          position,
          leafIndex: Number(d.args.leafIndex),
          commitment: d.args.commitment,
        })),
      };
      const final = body.kind === "payment",
        now = new Date().toISOString();
      await repo.steps.updateOne(
        { _id: `${body.operationId}:${String(body.step).padStart(4, "0")}` },
        { $set: { evidence: step } },
      );
      await repo.collection.updateOne(where, {
        $set: {
          status: final ? "confirmed" : "pending",
          receipt: final
            ? {
                txHash: prepared.txHash,
                leafIndex: verified.leafIndex,
                block: step.block,
                confirmedAt,
              }
            : null,
          "operation.phase": final ? "confirmed" : "preparing",
          "operation.txHash": final ? prepared.txHash : null,
          "operation.updatedAt": now,
          updatedAt: now,
          currentSubmission: null,
        },
        $inc: { "operation.nextStep": 1, revision: 1 },
      });
    }
  } catch (e) {
    const prior = await runtime.journal.read(
      `${intent.chainId}:${intent.wallet.toLowerCase()}`,
      intent.operationKey,
    );
    let cause: unknown = e,
      reverted = false;
    for (let depth = 0; cause instanceof Error && depth < 10; depth++) {
      if (
        cause.name === "ContractFunctionRevertedError" ||
        cause.name === "ExecutionRevertedError"
      )
        reverted = true;
      cause = cause.cause;
    }
    const now = new Date().toISOString();
    if (!prior?.serializedTransaction && reverted)
      await repo.collection.updateOne(where, {
        $set: {
          status: "failed",
          "operation.phase": "failed",
          currentSubmission: null,
          updatedAt: now,
        },
        $inc: { revision: 1 },
      });
    else
      await repo.collection.updateOne(where, {
        $set: {
          "operation.phase": "needsReconciliation",
          "operation.updatedAt": now,
        },
      });
  }
  const latest = await repo.collection.findOne({ _id: doc._id });
  if (!latest) throw new TransferNotFoundError();
  return latest.operation;
}
export async function submitTransfer(
  user: string,
  input: SignedTransferSubmission,
) {
  enforceTransferLimit(user, "submit");
  if (!relayerConfigured()) throw new TransferUnavailableError();
  const body = transferSubmissionSchema.parse(input),
    wallet = await transferCaller(user),
    repo = await transferRepo(),
    doc = await repo.getDoc(wallet, body.transferId);
  if (wallet !== doc.sender.wallet.toLowerCase())
    throw new TransferRejectedError(
      "Only the sender can continue this transfer.",
    );
  if (
    body.operationId !== doc.operationId ||
    body.pool !== doc.pool ||
    !(await verifyTypedData({
      address: doc.sender.wallet,
      ...transferSubmissionTypedData(body),
      signature: body.signature,
    }))
  )
    throw new TransferRejectedError();
  if (
    body.kind === "payment" &&
    body.outputs[0].commitment.toLowerCase() !==
      doc.recipientCommitment.toLowerCase()
  )
    throw new TransferRejectedError(
      "The recipient output does not match this transfer.",
    );
  const stepId = `${body.operationId}:${String(body.step).padStart(4, "0")}`;
  const accepted = (await repo.steps.findOne({ _id: stepId }))?.submission;
  if (accepted) {
    if (transferSubmissionDigest(accepted) !== transferSubmissionDigest(body))
      throw new TransferConflictError(
        "A submitted transfer step cannot be changed.",
      );
    if (doc.operation.nextStep > body.step || doc.status !== "pending")
      return doc.operation;
    if (doc.currentSubmission) return advance(doc);
  }
  const pool = resolvePool(doc.pool);
  if (pool.role !== "active" || !(pool.transferCapable ?? pool.requestCapable))
    throw new TransferUnavailableError(
      "This pool no longer accepts private sends.",
    );
  if (
    doc.status !== "pending" ||
    body.step !== doc.operation.nextStep ||
    doc.operation.phase !== "preparing" ||
    doc.currentSubmission
  )
    throw new TransferConflictError();
  const now = new Date().toISOString();
  await repo.steps.updateOne(
    { _id: stepId },
    {
      $setOnInsert: {
        transferId: body.transferId,
        operationId: body.operationId,
        step: body.step,
        submission: body,
        evidence: null,
      },
    },
    { upsert: true },
  );
  const stored = await repo.steps.findOne({ _id: stepId });
  if (
    !stored ||
    transferSubmissionDigest(stored.submission) !==
      transferSubmissionDigest(body)
  )
    throw new TransferConflictError(
      "A submitted transfer step cannot be changed.",
    );
  const changed = await repo.collection.findOneAndUpdate(
    {
      _id: doc._id,
      revision: doc.revision,
      status: "pending",
      currentSubmission: null,
      "operation.phase": "preparing",
      "operation.nextStep": body.step,
    },
    {
      $set: {
        currentSubmission: body,
        "operation.phase": "submitting",
        "operation.updatedAt": now,
        updatedAt: now,
      },
      $inc: { revision: 1 },
    },
    { returnDocument: "after", includeResultMetadata: false },
  );
  if (!changed) throw new TransferConflictError();
  return advance(changed);
}
export async function transferStatus(user: string, id: string) {
  enforceTransferLimit(user, "query");
  return (await (await transferRepo()).getDoc(await transferCaller(user), id))
    .operation;
}
export async function transferEvidence(
  user: string,
  id: string,
  afterStep = -1,
) {
  enforceTransferLimit(user, "query");
  const repo = await transferRepo(),
    d = await repo.getDoc(await transferCaller(user), id);
  const docs = await repo.steps
      .find({
        transferId: id,
        operationId: d.operationId,
        step: { $gt: afterStep },
      })
      .sort({ step: 1 })
      .limit(101)
      .toArray(),
    page = docs.slice(0, 100);
  return {
    submissions: page.map((d) => d.submission),
    steps: page.flatMap((d) => (d.evidence ? [d.evidence] : [])),
    nextStep: docs.length > 100 ? page[99].step : null,
  };
}
export async function resumeTransfer(user: string, id: string) {
  enforceTransferLimit(user, "submit");
  const d = await (await transferRepo()).getDoc(await transferCaller(user), id);
  if (d.sender.wallet.toLowerCase() !== (await transferCaller(user)))
    throw new TransferRejectedError();
  if (d.currentSubmission) return advance(d);
  return d.operation;
}
export async function recoveryBatch(
  user: string,
  input: { ids: string[]; cursor?: string },
) {
  enforceTransferLimit(user, "query");
  const repo = await transferRepo(),
    wallet = await transferCaller(user);
  const ids = [...new Set(input.ids)];
  if (!ids.length || ids.length !== input.ids.length || ids.length > 20)
    throw new TransferRejectedError();
  const records = await repo.collection
    .find({ _id: { $in: ids }, "sender.wallet": wallet })
    .toArray();
  if (records.length !== ids.length) throw new TransferNotFoundError();
  if (input.cursor && !/^[a-f0-9-]{36}:\d{4}$/.test(input.cursor))
    throw new TransferRejectedError();
  const docs = await repo.steps
      .find({
        $or: records.map((r) => ({
          transferId: r.id,
          operationId: r.operationId,
        })),
        ...(input.cursor ? { _id: { $gt: input.cursor } } : {}),
      })
      .sort({ _id: 1 })
      .limit(101)
      .toArray(),
    page = docs.slice(0, 100);
  return {
    items: page.map((s) => ({
      transferId: s.transferId,
      submission: s.submission,
      evidence: s.evidence,
    })),
    nextCursor: docs.length > 100 ? page[99]._id : null,
  };
}
export async function reconcilePendingTransfers({ limit }: { limit: number }) {
  const repo = await transferRepo(),
    docs = await repo.collection
      .find({ status: "pending", currentSubmission: { $ne: null } })
      .limit(Math.min(Math.max(limit, 1), 100))
      .toArray();
  let confirmed = 0,
    unresolved = 0;
  for (const d of docs) {
    try {
      const result = await advance(d);
      if (result.phase === "confirmed" || result.phase === "failed")
        confirmed++;
      else unresolved++;
    } catch {
      unresolved++;
    }
  }
  // Only idle preparation without an accepted submission can be safely ended.
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  await repo.collection.updateMany(
    {
      status: "pending",
      currentSubmission: null,
      "operation.phase": "preparing",
      updatedAt: { $lt: cutoff },
    },
    {
      $set: {
        status: "failed",
        "operation.phase": "failed",
        updatedAt: new Date().toISOString(),
      },
      $inc: { revision: 1 },
    },
  );
  return { examined: docs.length, confirmed, unresolved };
}
