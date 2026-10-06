import "server-only";
import {
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeAbiParameters,
  http,
  keccak256,
  type Chain,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getServerEnv } from "../../env.server";
import { chain, rpcUrl } from "../../lib/chain";
import { getDb } from "../db/mongo";
import {
  RelayBusyError,
  RelayConflictError,
  RelayJournal,
  type RelaySend,
} from "./relayJournal";
import { maweePoolAbi } from "../../lib/abi";
import { SpendReservations, type SpendOwner } from "./spendReservations";

export type RelayIntent = {
  operationKey: string;
  chainId: number;
  wallet: Hex;
  to: Hex;
  data: Hex;
  confirmations: number;
};
export type RelayPort = {
  pendingNonce(): Promise<number>;
  blockNumber(): Promise<bigint>;
  receipt(hash: Hex): Promise<TransactionReceipt | null>;
  prepareAndSign(intent: RelayIntent, nonce: number): Promise<Hex>;
  broadcast(bytes: Hex): Promise<Hex>;
};
export type RelayResult = {
  state: "confirmed" | "reverted" | "unknown";
  txHash: Hex;
  receipt: TransactionReceipt | null;
};
const walletKey = (i: RelayIntent) => `${i.chainId}:${i.wallet.toLowerCase()}`;
function digest(i: RelayIntent) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "bytes" },
        { type: "uint256" },
      ],
      [BigInt(i.chainId), i.wallet, i.to, i.data, BigInt(i.confirmations)],
    ),
  );
}

/** RPC is an injected boundary; the real journal owns cross-process atomicity. */
export function makeDurableSender(
  journal: RelayJournal,
  port: RelayPort,
  reservations?: SpendReservations,
) {
  function spend(
    i: RelayIntent,
  ): { owner: SpendOwner; nullifiers: Hex[] } | null {
    try {
      const decoded = decodeFunctionData({ abi: maweePoolAbi, data: i.data });
      const args = decoded.args;
      if (!args) return null;
      const name = decoded.functionName;
      const nullifiers =
        name === "merge"
          ? [args[1], args[2]]
          : name === "transfer"
            ? [args[1]]
            : name === "withdraw"
              ? [args[3]]
              : [];
      if (!nullifiers.length) return null;
      return {
        owner: {
          kind: i.operationKey.startsWith("transfer:")
            ? "transfer"
            : i.operationKey.startsWith("request:")
              ? "request"
              : name === "withdraw"
                ? "withdraw"
                : "ordinary-transfer",
          id: i.operationKey,
          sender: i.wallet,
          scope: `${i.chainId}:${i.to.toLowerCase()}`,
        },
        nullifiers: nullifiers as Hex[],
      };
    } catch {
      return null;
    }
  }
  async function releaseSpend(
    i: RelayIntent,
    evidence: "confirmed" | "reverted",
  ) {
    const input = spend(i);
    if (!input || !reservations) return;
    const claim = await reservations.read(input.owner);
    if (claim) await reservations.release(claim, evidence);
  }
  async function lookup(i: RelayIntent) {
    const send = await journal.read(walletKey(i), i.operationKey);
    if (send && send.digest !== digest(i)) throw new RelayConflictError();
    return send;
  }
  async function checkReceipt(
    send: RelaySend,
    confirmations: number,
  ): Promise<RelayResult> {
    if (!send.txHash) throw new RelayBusyError();
    const receipt = await port.receipt(send.txHash);
    if (
      !receipt ||
      receipt.transactionHash.toLowerCase() !== send.txHash.toLowerCase() ||
      (await port.blockNumber()) - receipt.blockNumber + 1n <
        BigInt(confirmations)
    )
      return { state: "unknown", txHash: send.txHash, receipt: null };
    const state = receipt.status === "success" ? "confirmed" : "reverted";
    await journal.finish(send, state);
    if (send.intent) await releaseSpend(send.intent, state);
    return { state, txHash: send.txHash, receipt };
  }
  async function prepare(
    i: RelayIntent,
  ): Promise<RelaySend & { serializedTransaction: Hex; txHash: Hex }> {
    if (
      !Number.isSafeInteger(i.chainId) ||
      i.chainId < 1 ||
      !Number.isSafeInteger(i.confirmations) ||
      i.confirmations < 1 ||
      i.operationKey.length > 200
    )
      throw new RelayConflictError();
    const prior = await lookup(i);
    if (prior?.serializedTransaction && prior.txHash) {
      if (prior.phase === "confirmed" || prior.phase === "reverted")
        await releaseSpend(i, prior.phase);
      return prior as RelaySend & { serializedTransaction: Hex; txHash: Hex };
    }
    const active = await journal.active(walletKey(i));
    if (active?.serializedTransaction && active.intent) {
      const result = await checkReceipt(active, active.intent.confirmations);
      if (result.state === "unknown") throw new RelayBusyError();
    }
    const claim = await journal.claim(
      walletKey(i),
      i.operationKey,
      digest(i),
      await port.pendingNonce(),
      new Date(),
      i,
    );
    const spending = spend(i);
    let spendClaim: Awaited<ReturnType<SpendReservations["claim"]>> | null =
      null;
    try {
      if (spending && reservations) {
        spendClaim = await reservations.claim(
          spending.owner,
          spending.nullifiers,
        );
        await reservations.enterDispatch(spendClaim);
      }
      const serializedTransaction = await port.prepareAndSign(i, claim.nonce);
      if (spendClaim && reservations)
        await reservations.assertOwned(spendClaim);
      const signed = await journal.persistSigned({
        ...claim,
        serializedTransaction,
        txHash: keccak256(serializedTransaction),
      });
      if (spendClaim && reservations)
        await reservations.pinSigned(spendClaim, i.operationKey);
      return signed as RelaySend & { serializedTransaction: Hex; txHash: Hex };
    } catch (e) {
      const saved = await journal.read(walletKey(i), i.operationKey);
      const abandoned = await journal.abandonUnsigned(claim);
      if (
        abandoned &&
        !saved?.serializedTransaction &&
        spendClaim &&
        reservations
      )
        await reservations.release(spendClaim, "unsigned-abandoned");
      throw e;
    }
  }
  async function broadcast(i: RelayIntent) {
    const send = await lookup(i);
    if (!send?.serializedTransaction || !send.txHash)
      throw new RelayBusyError();
    if (send.phase === "confirmed" || send.phase === "reverted")
      return { txHash: send.txHash };
    // Refuse to send bytes no longer owned by this fenced wallet slot.
    const active = await journal.active(walletKey(i));
    if (active?.fence !== send.fence || active.operationKey !== i.operationKey)
      throw new RelayBusyError();
    await journal.uncertain(send);
    try {
      const hash = await port.broadcast(send.serializedTransaction);
      if (hash.toLowerCase() !== send.txHash.toLowerCase())
        throw new RelayConflictError();
      return { txHash: send.txHash };
    } catch {
      throw new Error(
        "Transaction submission is uncertain. Checking its status before retrying.",
      );
    }
  }
  async function reconcile(i: RelayIntent) {
    const send = await lookup(i);
    if (!send) throw new RelayBusyError();
    return checkReceipt(send, i.confirmations);
  }
  return { prepare, broadcast, reconcile };
}

export async function runtimeSender() {
  const env = getServerEnv();
  if (!env.RELAYER_PRIVATE_KEY)
    throw new Error("The gasless relayer is not configured.");
  const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex);
  const transport = http(env.RELAYER_RPC_URL ?? rpcUrl);
  const configuredChain: Chain = chain;
  const reader = createPublicClient({ chain: configuredChain, transport });
  const wallet = createWalletClient({
    account,
    chain: configuredChain,
    transport,
  });
  const db = await getDb(),
    journal = new RelayJournal(db);
  const port: RelayPort = {
    pendingNonce: () =>
      reader.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      }),
    blockNumber: () => reader.getBlockNumber(),
    receipt: async (hash) => {
      try {
        return await reader.getTransactionReceipt({ hash });
      } catch (e) {
        if (e instanceof Error && e.name === "TransactionReceiptNotFoundError")
          return null;
        throw e;
      }
    },
    prepareAndSign: async (i, nonce) => {
      if (
        i.chainId !== chain.id ||
        i.wallet.toLowerCase() !== account.address.toLowerCase()
      )
        throw new RelayConflictError();
      const prepared = await wallet.prepareTransactionRequest({
        account,
        to: i.to,
        data: i.data,
        nonce,
      });
      return wallet.signTransaction(prepared);
    },
    broadcast: (bytes) =>
      wallet.sendRawTransaction({ serializedTransaction: bytes }),
  };
  return {
    sender: makeDurableSender(journal, port, new SpendReservations(db)),
    journal,
    account,
    reader,
  };
}
export async function prepareRelay(i: RelayIntent) {
  return (await runtimeSender()).sender.prepare(i);
}
export async function broadcastRelay(i: RelayIntent) {
  return (await runtimeSender()).sender.broadcast(i);
}
export async function reconcileRelay(i: RelayIntent) {
  return (await runtimeSender()).sender.reconcile(i);
}

/** Also repairs ordinary sends after restart, not only request payments. */
export async function reconcileAllRelays(limit = 20) {
  const { sender, journal } = await runtimeSender();
  const wallets = await journal.wallets
    .find({ "active.serializedTransaction": { $type: "string" } })
    .limit(limit)
    .toArray();
  let confirmed = 0,
    unresolved = 0;
  for (const w of wallets) {
    if (!w.active?.intent) continue;
    try {
      const result = await sender.reconcile(w.active.intent);
      if (result.state === "unknown") unresolved++;
      else confirmed++;
    } catch {
      unresolved++;
    }
  }
  return { examined: wallets.length, confirmed, unresolved };
}
