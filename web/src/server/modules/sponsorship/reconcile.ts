import "server-only";
import type { Hex, TransactionReceipt } from "viem";
import {
  createPublicClient,
  http,
  TransactionReceiptNotFoundError,
} from "viem";
import { getServerEnv } from "../../../env.server";
import type { FeeEvidence } from "../../../features/sponsorship/types";
import { chain, rpcUrl } from "../../../lib/chain";
import { getDb } from "../../db/mongo";
import type { RelaySend } from "../../lib/relayJournal";
import { RelayJournal } from "../../lib/relayJournal";
import { readFrozenSignedTx } from "./fees";
import { SponsorshipError } from "./sponsorship.errors";
import { sponsorshipLedger } from "./sponsorship.service";

export async function runtimeSponsorship() {
  const db = await getDb(),
    ledger = await sponsorshipLedger(),
    journal = new RelayJournal(db);
  const reader = createPublicClient({
    chain,
    transport: http(getServerEnv().RELAYER_RPC_URL ?? rpcUrl),
  });
  const rpc = {
    receipt: async (hash: Hex) => {
      try {
        return await reader.getTransactionReceipt({ hash });
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw new SponsorshipError("rpc");
      }
    },
    blockNumber: () => reader.getBlockNumber(),
    block: (blockNumber: bigint) => reader.getBlock({ blockNumber }),
  };
  return { ledger, journal, rpc };
}
export async function advanceSponsorshipBaseline({
  limit = 20,
}: {
  limit?: number;
} = {}) {
  const { SponsorshipBaseline } = await import("./bootstrap"),
    runtime = await runtimeSponsorship();
  return new SponsorshipBaseline(
    runtime.ledger,
    runtime.journal,
    runtime.rpc,
    chain.id,
  ).advance(limit);
}
export async function reconcileSponsorship({
  limit = 20,
}: {
  limit?: number;
} = {}) {
  const { SponsorshipRecovery } = await import("./recovery"),
    runtime = await runtimeSponsorship();
  const baseline = await advanceSponsorshipBaseline({ limit });
  const recovery = await new SponsorshipRecovery(
    runtime.ledger,
    runtime.journal,
    runtime.rpc,
    chain.id,
  ).reconcile(limit);
  return { ...recovery, baseline: baseline.state };
}
export async function sponsorFeeEvidence(
  send: RelaySend,
  receipt: TransactionReceipt,
  block: (n: bigint) => Promise<{ hash: Hex | null; timestamp: bigint }>,
): Promise<FeeEvidence> {
  if (
    !send.serializedTransaction ||
    !send.txHash ||
    receipt.transactionHash.toLowerCase() !== send.txHash.toLowerCase()
  )
    throw new SponsorshipError("rpc");
  const before = await block(receipt.blockNumber),
    transaction = await readFrozenSignedTx(send.serializedTransaction),
    after = await block(receipt.blockNumber);
  if (
    !before.hash ||
    before.hash !== after.hash ||
    before.hash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    transaction.chainId !== send.intent?.chainId ||
    transaction.from.toLowerCase() !== send.intent.wallet.toLowerCase() ||
    transaction.to.toLowerCase() !== send.intent.to.toLowerCase() ||
    transaction.data.toLowerCase() !== send.intent.data.toLowerCase()
  )
    throw new SponsorshipError("rpc");
  return {
    hash: send.txHash,
    block: receipt.blockNumber,
    blockHash: before.hash,
    blockTime: new Date(Number(before.timestamp) * 1000),
    outcome: receipt.status === "success" ? "confirmed" : "reverted",
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
    transaction,
  };
}
