import "server-only";
import {
  type Chain,
  createPublicClient,
  createWalletClient,
  decodeFunctionData,
  encodeAbiParameters,
  type Hex,
  http,
  keccak256,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getServerEnv } from "../../env.server";
import type {
  ChildTicket,
  FrozenTx,
  SponsorBinding,
} from "../../features/sponsorship/types";
import { maweePoolAbi } from "../../lib/abi";
import { chain, rpcUrl } from "../../lib/chain";
import { getDb } from "../db/mongo";
import { validateSignedTx } from "../modules/sponsorship/fees";
import { SponsorLedger } from "../modules/sponsorship/ledger.service";
import { loadSponsorPolicy } from "../modules/sponsorship/policy";
import { sponsorFeeEvidence } from "../modules/sponsorship/reconcile";
import type { SponsorBudgetPort } from "../modules/sponsorship/senderBudget";
import { SponsorshipError } from "../modules/sponsorship/sponsorship.errors";
import {
  RelayBusyError,
  RelayConflictError,
  RelayJournal,
  type RelaySend,
} from "./relayJournal";
import { type SpendOwner, SpendReservations } from "./spendReservations";

export type RelayIntent = {
  operationKey: string;
  chainId: number;
  wallet: Hex;
  to: Hex;
  data: Hex;
  confirmations: number;
  sponsorship?: SponsorBinding;
};
export type RelayPort = {
  pendingNonce(): Promise<number>;
  blockNumber(): Promise<bigint>;
  receipt(hash: Hex): Promise<TransactionReceipt | null>;
  prepareAndSign?(intent: RelayIntent, nonce: number): Promise<Hex>;
  prepare?(intent: RelayIntent, nonce: number): Promise<FrozenTx>;
  sign?(tx: FrozenTx): Promise<Hex>;
  block?(number: bigint): Promise<{ hash: Hex | null; timestamp: bigint }>;
  balance?(wallet: Hex): Promise<bigint>;
  broadcast(bytes: Hex): Promise<Hex>;
};
export type RelayResult = {
  state: "confirmed" | "reverted" | "unknown";
  txHash: Hex;
  receipt: TransactionReceipt | null;
};
const walletKey = (i: RelayIntent) => `${i.chainId}:${i.wallet.toLowerCase()}`;
function digest(i: RelayIntent) {
  const original = keccak256(
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
  return i.sponsorship
    ? keccak256(
        encodeAbiParameters(
          [
            { type: "bytes32" },
            { type: "string" },
            { type: "uint256" },
            { type: "uint256" },
            { type: "string" },
          ],
          [
            original,
            i.sponsorship.action.actionId,
            BigInt(i.sponsorship.action.chainId),
            BigInt(i.sponsorship.action.fence),
            i.sponsorship.childId,
          ],
        ),
      )
    : original;
}

/** RPC is an injected boundary; the real journal owns cross-process atomicity. */
export function makeDurableSender(
  journal: RelayJournal,
  port: RelayPort,
  reservations?: SpendReservations,
  budget?: SponsorBudgetPort,
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
    if (
      budget &&
      send.budgetChild &&
      send.phase !== "confirmed" &&
      send.phase !== "reverted"
    ) {
      if (!port.block) throw new SponsorshipError("rpc");
      await budget.ledger.settleChild(
        send.budgetChild,
        await sponsorFeeEvidence(send, receipt, port.block),
      );
    }
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
    let budgetChild: ChildTicket | undefined;
    try {
      if (spending && reservations) {
        spendClaim = await reservations.claim(
          spending.owner,
          spending.nullifiers,
        );
        await reservations.enterDispatch(spendClaim);
      }
      let serializedTransaction: Hex;
      if (budget) {
        if (!i.sponsorship || !port.prepare || !port.sign || !port.balance)
          throw new SponsorshipError("configuration");
        const policy = budget.policy();
        if (!policy.ready) throw new SponsorshipError("configuration");
        const prepared = await port.prepare(i, claim.nonce);
        if (
          prepared.chainId !== i.chainId ||
          prepared.from.toLowerCase() !== i.wallet.toLowerCase() ||
          prepared.to.toLowerCase() !== i.to.toLowerCase() ||
          prepared.data.toLowerCase() !== i.data.toLowerCase() ||
          prepared.nonce !== claim.nonce
        )
          throw new SponsorshipError("cost");
        budgetChild = await budget.ledger.allocate(
          i.sponsorship.action,
          i.sponsorship.childId,
          digest(i),
          prepared,
        );
        const state = await budget.ledger.repo.snapshot(i.chainId);
        let liability = 0n;
        for (const action of Object.values(state.actions))
          for (const child of Object.values(action.children)) {
            if (
              child.tx.from.toLowerCase() === i.wallet.toLowerCase() &&
              !["settled", "abandoned"].includes(child.phase)
            )
              liability += BigInt(child.maximumWei);
          }
        if (
          (await port.balance(i.wallet)) <
          liability + policy.policy.balanceFloorWei
        )
          throw new SponsorshipError("balance");
        await budget.ledger.enterSigning(budgetChild, claim.fence);
        serializedTransaction = await port.sign(prepared);
        await validateSignedTx(serializedTransaction, prepared);
        await budget.ledger.pinSigned(
          budgetChild,
          keccak256(serializedTransaction),
        );
      } else {
        if (!port.prepareAndSign) throw new RelayConflictError();
        serializedTransaction = await port.prepareAndSign(i, claim.nonce);
      }
      if (spendClaim && reservations)
        await reservations.assertOwned(spendClaim);
      const signed = await journal.persistSigned({
        ...claim,
        serializedTransaction,
        txHash: keccak256(serializedTransaction),
        ...(budgetChild ? { budgetChild } : {}),
      });
      if (spendClaim && reservations)
        await reservations.pinSigned(spendClaim, i.operationKey);
      return signed as RelaySend & { serializedTransaction: Hex; txHash: Hex };
    } catch (e) {
      const saved = await journal.read(walletKey(i), i.operationKey);
      const abandoned = await journal.abandonUnsigned(claim);
      if (abandoned && !saved?.serializedTransaction && budgetChild && budget) {
        await budget.ledger.releaseUnsigned(budgetChild, claim.fence);
      }
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
    if (budget) {
      if (!send.budgetChild) throw new SponsorshipError("initializing");
      await budget.ledger.assertBroadcast(send.budgetChild, send.txHash);
    }
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
  const sponsorshipPolicy = () => loadSponsorPolicy(getServerEnv());
  const budget: SponsorBudgetPort = {
    ledger: new SponsorLedger({
      db,
      policy: sponsorshipPolicy,
      chainId: chain.id,
    }),
    policy: sponsorshipPolicy,
  };
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
    prepare: async (i, nonce) => {
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
      if (prepared.gas === undefined || (prepared.value ?? 0n) !== 0n)
        throw new SponsorshipError("cost");
      let fee: FrozenTx["fee"];
      if (prepared.type === "legacy") {
        if (prepared.gasPrice === undefined) throw new SponsorshipError("cost");
        fee = { type: 0, gasPrice: prepared.gasPrice };
      } else {
        if (
          prepared.maxFeePerGas === undefined ||
          prepared.maxPriorityFeePerGas === undefined
        )
          throw new SponsorshipError("cost");
        fee = {
          type: 2,
          maxFeePerGas: prepared.maxFeePerGas,
          maxPriorityFeePerGas: prepared.maxPriorityFeePerGas,
        };
      }
      return {
        chainId: i.chainId,
        from: account.address,
        to: i.to,
        data: i.data,
        nonce,
        gas: prepared.gas,
        value: 0n,
        fee,
      };
    },
    sign: (tx) =>
      wallet.signTransaction({
        account,
        chain: configuredChain,
        chainId: tx.chainId,
        to: tx.to,
        data: tx.data,
        nonce: tx.nonce,
        gas: tx.gas,
        value: 0n,
        ...(tx.fee.type === 0
          ? { type: "legacy", gasPrice: tx.fee.gasPrice }
          : {
              type: "eip1559",
              maxFeePerGas: tx.fee.maxFeePerGas,
              maxPriorityFeePerGas: tx.fee.maxPriorityFeePerGas,
            }),
      }),
    block: (number) => reader.getBlock({ blockNumber: number }),
    balance: (address) => reader.getBalance({ address, blockTag: "latest" }),
    broadcast: (bytes) =>
      wallet.sendRawTransaction({ serializedTransaction: bytes }),
  };
  return {
    sender: makeDurableSender(journal, port, new SpendReservations(db), budget),
    journal,
    account,
    reader,
    budget,
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
    .find({
      _id: { $regex: `^${chain.id}:` },
      "active.serializedTransaction": { $type: "string" },
    })
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
