import "server-only";
import type { Hex, TransactionReceipt } from "viem";
import type { FeeEvidence } from "../../../features/sponsorship/types";
import type { RelaySend } from "../../lib/relayJournal";
import { readFrozenSignedTx } from "./fees";
import { SponsorshipError } from "./sponsorship.errors";
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
