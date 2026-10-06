import "server-only";
import {
  decodeFunctionData,
  type Hex,
  parseEventLogs,
  type TransactionReceipt,
} from "viem";
import type { PaymentActivityEvidence } from "../../../features/payments/activityTypes";
import type { PoolDescriptor } from "../../../features/transfers/types";
import { maweePoolAbi } from "../../../lib/abi";
import { publicClient } from "../../../lib/chain";
import { resolvePool } from "../../../lib/pools";
import { getDb, type IndexerStateDoc } from "../../db/mongo";
export function parseActivityEvidence(input: {
  pool: PoolDescriptor;
  transaction: { hash: Hex; to: Hex | null; input: Hex };
  receipt: TransactionReceipt;
  at: string;
}): PaymentActivityEvidence | null {
  try {
    const { pool, transaction: tx, receipt: r } = input;
    if (
      tx.to?.toLowerCase() !== pool.address.toLowerCase() ||
      r.to?.toLowerCase() !== pool.address.toLowerCase() ||
      r.status !== "success" ||
      r.transactionHash.toLowerCase() !== tx.hash.toLowerCase()
    )
      return null;
    const decoded = decodeFunctionData({ abi: maweePoolAbi, data: tx.input }),
      name = decoded.functionName,
      args = decoded.args as readonly unknown[];
    const kind =
      name === "merge"
        ? "merge"
        : name === "transfer"
          ? "transfer"
          : name === "withdraw"
            ? "withdraw"
            : name === "deposit" || name === "depositWithAuthorization"
              ? "deposit"
              : null;
    if (!kind) return null;
    const logs = r.logs.filter(
      (l) =>
        l.address.toLowerCase() === pool.address.toLowerCase() && !l.removed,
    );
    const deposits = parseEventLogs({
        abi: maweePoolAbi,
        eventName: "Deposit",
        logs,
      }),
      spends = parseEventLogs({ abi: maweePoolAbi, eventName: "Spend", logs });
    const expectedNfs = (
      kind === "merge"
        ? [args[1], args[2]]
        : kind === "transfer"
          ? [args[1]]
          : kind === "withdraw"
            ? [args[3]]
            : []
    ) as Hex[];
    if (
      expectedNfs.length !== spends.length ||
      expectedNfs.some(
        (n) =>
          !spends.some(
            (s) => s.args.nullifier.toLowerCase() === n.toLowerCase(),
          ),
      )
    )
      return null;
    let withdrawal: string | null = null;
    if (kind === "withdraw") {
      const events = parseEventLogs({
          abi: maweePoolAbi,
          eventName: "Withdrawal",
          logs,
        }),
        e = events[0];
      if (
        events.length !== 1 ||
        e.args.amount !== args[1] ||
        e.args.recipient.toLowerCase() !== (args[0] as string).toLowerCase() ||
        e.args.nullifier.toLowerCase() !== (args[3] as string).toLowerCase() ||
        deposits.length
      )
        return null;
      withdrawal = String(e.args.amount);
    } else {
      const expected = (
        kind === "merge"
          ? [args[4]]
          : kind === "transfer"
            ? [args[3], args[4]]
            : []
      ) as { commitment: Hex; ephemeralPk: Hex; ciphertext: Hex }[];
      if (kind === "deposit") {
        const comm = args[name === "deposit" ? 0 : 1] as string;
        if (
          deposits.length !== 1 ||
          deposits[0].args.commitment.toLowerCase() !== comm.toLowerCase()
        )
          return null;
      } else if (
        deposits.length !== expected.length ||
        expected.some(
          (o, i) =>
            o.commitment.toLowerCase() !==
              deposits[i].args.commitment.toLowerCase() ||
            o.ephemeralPk.toLowerCase() !==
              deposits[i].args.ephemeralPk.toLowerCase() ||
            o.ciphertext.toLowerCase() !==
              deposits[i].args.ciphertext.toLowerCase(),
        )
      )
        return null;
    }
    return {
      scope: pool.scope,
      txHash: tx.hash,
      block: Number(r.blockNumber),
      at: input.at,
      kind,
      inputs: expectedNfs,
      outputs: deposits.map((e) => ({
        leafIndex: Number(e.args.leafIndex),
        commitment: e.args.commitment,
      })),
      withdrawAmount: withdrawal,
    };
  } catch {
    return null;
  }
}
export async function publicPoolActivity(input: {
  pool: string;
  cursor?: string;
}) {
  const pool = resolvePool(input.pool),
    db = await getDb(),
    state = await db
      .collection<IndexerStateDoc>("indexer_state")
      .findOne({ _id: `pool:${pool.scope}` });
  const watermark = Number(state?.publishedBlock ?? 0);
  let after: { block: number; hash: string } | null = null;
  if (input.cursor) {
    const c = JSON.parse(
      Buffer.from(input.cursor, "base64url").toString(),
    ) as unknown;
    if (
      !Array.isArray(c) ||
      c.length !== 2 ||
      !Number.isSafeInteger(c[0]) ||
      c[0] < 0 ||
      typeof c[1] !== "string" ||
      !/^0x[a-fA-F0-9]{64}$/.test(c[1])
    )
      throw new Error("Invalid activity cursor.");
    after = { block: c[0], hash: c[1] };
  }
  const match = { scope: pool.scope, block: { $lte: watermark } };
  const candidates = await db
    .collection("deposits")
    .aggregate<{ _id: string; block: number }>([
      { $match: match },
      { $project: { txHash: 1, block: 1 } },
      {
        $unionWith: {
          coll: "spent_nullifiers",
          pipeline: [{ $match: match }, { $project: { txHash: 1, block: 1 } }],
        },
      },
      { $group: { _id: "$txHash", block: { $min: "$block" } } },
      ...(after
        ? [
            {
              $match: {
                $or: [
                  { block: { $gt: after.block } },
                  { block: after.block, _id: { $gt: after.hash } },
                ],
              },
            },
          ]
        : []),
      { $sort: { block: 1, _id: 1 } },
      { $limit: 26 },
    ])
    .toArray();
  const cache = db.collection<PaymentActivityEvidence & { _id: string }>(
      "pool_activity_evidence",
    ),
    items: PaymentActivityEvidence[] = [];
  let unavailable = false,
    last = after;
  for (const c of candidates.slice(0, 25)) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(c._id)) {
      unavailable = true;
      break;
    }
    const id = `${pool.scope}:${c._id.toLowerCase()}`;
    let evidence: PaymentActivityEvidence | null = await cache.findOne({
      _id: id,
    });
    if (!evidence) {
      try {
        const [receipt, tx] = await Promise.all([
          publicClient.getTransactionReceipt({ hash: c._id as Hex }),
          publicClient.getTransaction({ hash: c._id as Hex }),
        ]);
        if (
          Number(
            (await publicClient.getBlockNumber()) - receipt.blockNumber + 1n,
          ) < pool.confirmations
        ) {
          unavailable = true;
          break;
        }
        const block = await publicClient.getBlock({
          blockNumber: receipt.blockNumber,
        });
        evidence = parseActivityEvidence({
          pool,
          transaction: { hash: tx.hash, to: tx.to, input: tx.input },
          receipt,
          at: new Date(Number(block.timestamp) * 1000).toISOString(),
        });
        if (!evidence) {
          unavailable = true;
          break;
        }
        await cache.updateOne(
          { _id: id },
          { $set: evidence },
          { upsert: true },
        );
      } catch {
        unavailable = true;
        break;
      }
    }
    const { _id: ignored, ...clean } = evidence as PaymentActivityEvidence & {
      _id?: string;
    };
    items.push(clean);
    last = { block: c.block, hash: c._id };
  }
  const nextCursor =
    (candidates.length > 25 || unavailable) && last
      ? Buffer.from(JSON.stringify([last.block, last.hash])).toString(
          "base64url",
        )
      : null;
  return { items, nextCursor, unavailable };
}
