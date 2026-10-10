import "server-only";
import { keccak256 } from "viem";
import type { RelayPort } from "../../lib/durableRelayer";
import type { RelayJournal, RelaySend } from "../../lib/relayJournal";
import { readFrozenSignedTx } from "./fees";
import type { SponsorLedger } from "./ledger.service";
import { sponsorFeeEvidence } from "./reconcile";
import { SponsorshipError } from "./sponsorship.errors";

type Cursor = { phase: "wallets" | "history"; after: string | null };
export class SponsorshipBaseline {
  constructor(
    readonly ledger: SponsorLedger,
    readonly journal: RelayJournal,
    readonly rpc: Pick<RelayPort, "receipt" | "blockNumber" | "block">,
    readonly chainId: number,
  ) {}
  async importSend(send: RelaySend) {
    if (!send.serializedTransaction || !send.txHash || !send.intent)
      throw new SponsorshipError("initializing");
    const tx = await readFrozenSignedTx(send.serializedTransaction);
    if (
      tx.chainId !== this.chainId ||
      tx.from.toLowerCase() !== send.intent.wallet.toLowerCase() ||
      tx.to.toLowerCase() !== send.intent.to.toLowerCase() ||
      tx.data.toLowerCase() !== send.intent.data.toLowerCase() ||
      keccak256(send.serializedTransaction) !== send.txHash ||
      send.walletKey !== `${this.chainId}:${tx.from.toLowerCase()}`
    )
      throw new SponsorshipError("cost");
    const actionId = `legacy:${send.txHash}`;
    const ticket =
      send.budgetChild ??
      (await this.ledger.importLegacy({
        kind: "import",
        intent: {
          chainId: this.chainId,
          actionId,
          kind: "legacy-transfer",
          principal: { kind: "anonymous", key: "shared" },
          businessDigest: send.txHash,
          maximumChildren: 1,
        },
        tx,
        digest: send.txHash,
        hash: send.txHash,
        walletFence: send.fence,
      }));
    if (!send.budgetChild) {
      await this.journal.wallets.updateOne(
        {
          _id: send.walletKey,
          fence: send.fence,
          "active.operationKey": send.operationKey,
          "active.txHash": send.txHash,
        },
        { $set: { "active.budgetChild": ticket } },
      );
      await this.journal.sends.updateOne(
        { _id: `${send.walletKey}:${send.operationKey}`, txHash: send.txHash },
        { $set: { budgetChild: ticket } },
      );
    }
    const action = await this.ledger.readAction(this.chainId, ticket.actionId);
    if (!action) throw new SponsorshipError("rpc");
    if (action.phase === "closed") return;
    const receipt = await this.rpc.receipt(send.txHash);
    if (
      !receipt ||
      receipt.transactionHash !== send.txHash ||
      (await this.rpc.blockNumber()) - receipt.blockNumber + 1n <
        BigInt(send.intent.confirmations)
    )
      return;
    if (!this.rpc.block) throw new SponsorshipError("rpc");
    await this.ledger.settleChild(
      ticket,
      await sponsorFeeEvidence(send, receipt, this.rpc.block),
    );
    if (action.legacy) await this.ledger.closeAction(ticket);
  }
  async advance(limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new SponsorshipError("capacity");
    const state = await this.ledger.repo.snapshot(this.chainId);
    if (state.bootstrap.state === "complete")
      return {
        state: "complete" as const,
        examined: 0,
        cursor: state.bootstrap.cursor,
      };
    const cursor: Cursor = state.bootstrap.cursor
      ? JSON.parse(state.bootstrap.cursor)
      : { phase: "wallets", after: null };
    const prefix = `${this.chainId}:`,
      scope = { $regex: `^${prefix}` };
    let examined = 0,
      next: Cursor = cursor;
    if (cursor.phase === "wallets") {
      const wallets = await this.journal.wallets
        .find({
          _id: { ...scope, ...(cursor.after ? { $gt: cursor.after } : {}) },
          active: { $ne: null },
        })
        .sort({ _id: 1 })
        .limit(limit)
        .toArray();
      for (const wallet of wallets) {
        const send = wallet.active;
        if (send?.serializedTransaction) await this.importSend(send);
        else if (send && !(await this.journal.abandonUnsigned(send)))
          throw new SponsorshipError("initializing");
        examined++;
        next = { phase: "wallets", after: wallet._id };
      }
      if (wallets.length < limit) next = { phase: "history", after: null };
    } else {
      const sends = await this.journal.sends
        .find({
          walletKey: scope,
          _id: cursor.after ? { $gt: `${cursor.after}` } : { $exists: true },
          serializedTransaction: { $type: "string" },
        })
        .sort({ _id: 1 })
        .limit(limit)
        .toArray();
      for (const send of sends) {
        await this.importSend(send);
        examined++;
        next = { phase: "history", after: send._id };
      }
      const complete = sends.length < limit;
      const encoded = JSON.stringify(next);
      await this.ledger.baseline(
        this.chainId,
        state.bootstrap.cursor,
        encoded,
        complete,
      );
      return {
        state: complete ? ("complete" as const) : ("initializing" as const),
        examined,
        cursor: encoded,
      };
    }
    const encoded = JSON.stringify(next);
    await this.ledger.baseline(
      this.chainId,
      state.bootstrap.cursor,
      encoded,
      false,
    );
    return { state: "initializing" as const, examined, cursor: encoded };
  }
}
