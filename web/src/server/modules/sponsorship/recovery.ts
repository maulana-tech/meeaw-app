import "server-only";
import { keccak256 } from "viem";
import type { ChildTicket } from "../../../features/sponsorship/types";
import type { RelayPort } from "../../lib/durableRelayer";
import type { RelayJournal } from "../../lib/relayJournal";
import { SponsorshipBaseline } from "./bootstrap";
import { readFrozenSignedTx } from "./fees";
import type { SponsorLedger } from "./ledger.service";
import { type LedgerAction, type LedgerChild, ledgerKey } from "./ledgerModel";
import { SponsorshipError } from "./sponsorship.errors";
export class SponsorshipRecovery {
  constructor(
    readonly ledger: SponsorLedger,
    readonly journal: RelayJournal,
    readonly rpc: Pick<RelayPort, "receipt" | "blockNumber" | "block">,
    readonly chainId: number,
  ) {}
  async businessTerminal(action: LedgerAction) {
    if (action.legacy) return true;
    const db = this.ledger.options.db,
      i = action.intent;
    if (i.kind === "send")
      return Boolean(
        await db.collection("private_transfers").findOne({
          id: i.actionId.slice("send:".length),
          status: { $in: ["confirmed", "failed"] },
        }),
      );
    if (i.kind === "request-pay")
      return Boolean(
        await db.collection("request_operations").findOne({
          id: i.actionId.slice("request-pay:".length),
          phase: { $in: ["confirmed", "failed"] },
        }),
      );
    if (i.kind === "rotation")
      return Boolean(
        await db.collection("privacy_key_rotations").findOne({
          id: i.actionId.slice("rotation:".length),
          pending: false,
          "operation.phase": { $in: ["confirmed", "failed"] },
        }),
      );
    if (i.kind === "withdraw-batch") {
      const record = await db
        .collection<{ _id: string; nullifiers: string[] }>(
          "sponsorship_withdraw_batches",
        )
        .findOne({
          _id: `${this.chainId}:${i.actionId.slice("withdraw-batch:".length)}`,
        });
      return Boolean(
        record?.nullifiers.every(
          (n) => action.children[ledgerKey(n)]?.phase === "settled",
        ),
      );
    }
    const children = Object.values(action.children);
    return (
      children.some((c) => c.phase === "settled") ||
      children.every((c) => c.phase === "abandoned" || c.phase === "allocated")
    );
  }
  async matches(child: LedgerChild, bytes: `0x${string}`) {
    const tx = await readFrozenSignedTx(bytes),
      stored = child.tx;
    return (
      tx.chainId === this.chainId &&
      tx.from.toLowerCase() === stored.from.toLowerCase() &&
      tx.to.toLowerCase() === stored.to.toLowerCase() &&
      tx.nonce === stored.nonce &&
      tx.gas.toString() === stored.gas &&
      keccak256(tx.data) === stored.dataDigest &&
      JSON.stringify(tx.fee, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ) === JSON.stringify(stored.fee)
    );
  }
  async reconcile(limit = 20) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
      throw new SponsorshipError("capacity");
    const snapshot = await this.ledger.repo.snapshot(this.chainId),
      baseline = new SponsorshipBaseline(
        this.ledger,
        this.journal,
        this.rpc,
        this.chainId,
      );
    let examined = 0,
      settled = 0,
      unresolved = 0;
    const work: Array<{
      key: string;
      action: LedgerAction;
      child: LedgerChild | null;
    }> = [];
    for (const [key, action] of Object.entries(snapshot.actions)) {
      const pending = Object.entries(action.children).filter(([, c]) =>
        ["signing", "signed", "unknown"].includes(c.phase),
      );
      if (!pending.length || ["closed", "cancelled"].includes(action.phase))
        work.push({ key, action, child: null });
      else
        for (const [childKey, child] of pending)
          work.push({ key: `${key}:${childKey}`, action, child });
    }
    work.sort((a, b) => a.key.localeCompare(b.key));
    const cursor = snapshot.recoveryCursor ?? "",
      batch = [
        ...work.filter((w) => w.key > cursor),
        ...work.filter((w) => w.key <= cursor),
      ].slice(0, limit);
    for (const unit of batch) {
      const { action, child } = unit;
      examined++;
      try {
        if (action.phase === "closed" || action.phase === "cancelled") {
          await this.ledger.repo.archive(this.chainId, action.intent.actionId);
          continue;
        }
        if (child) {
          const ticket: ChildTicket = {
            chainId: this.chainId,
            actionId: action.intent.actionId,
            fence: action.fence,
            childId: child.id,
            childFence: child.fence,
          };
          const walletKey = `${this.chainId}:${child.tx.from.toLowerCase()}`,
            active = await this.journal.active(walletKey);
          const history = child.walletFence
            ? await this.journal.sends.findOne({
                walletKey,
                fence: child.walletFence,
              })
            : null;
          const raw =
            active?.fence === child.walletFence && active.serializedTransaction
              ? active
              : history?.serializedTransaction
                ? history
                : null;
          if (raw?.serializedTransaction && raw.txHash) {
            if (
              !(await this.matches(child, raw.serializedTransaction)) ||
              (child.hash && child.hash !== raw.txHash)
            )
              throw new SponsorshipError("cost");
            if (child.phase === "signing")
              await this.ledger.pinSigned(ticket, raw.txHash);
            await this.journal.wallets.updateOne(
              { _id: walletKey, fence: raw.fence, "active.txHash": raw.txHash },
              { $set: { "active.budgetChild": ticket } },
            );
            await this.journal.sends.updateOne(
              { _id: `${walletKey}:${raw.operationKey}`, txHash: raw.txHash },
              { $set: { budgetChild: ticket } },
            );
            await baseline.importSend({ ...raw, budgetChild: ticket });
            const updated = await this.ledger.readAction(
              this.chainId,
              ticket.actionId,
            );
            if (
              updated?.children[ledgerKey(ticket.childId)]?.phase === "settled"
            )
              settled++;
            else unresolved++;
          } else if (
            child.walletFence &&
            active?.fence !== child.walletFence &&
            child.phase !== "unknown"
          ) {
            if (child.phase === "signed" && child.hash)
              await this.ledger.retireUnpublished(
                ticket,
                child.walletFence,
                child.hash,
              );
            else await this.ledger.releaseUnsigned(ticket, child.walletFence);
          } else unresolved++;
        }
        const latest = await this.ledger.readAction(
          this.chainId,
          action.intent.actionId,
        );
        if (
          latest &&
          latest.phase !== "closed" &&
          Object.values(latest.children).every((c) =>
            ["settled", "abandoned", "allocated"].includes(c.phase),
          ) &&
          (await this.businessTerminal(latest))
        )
          await this.ledger.closeAction({
            chainId: this.chainId,
            actionId: latest.intent.actionId,
            fence: latest.fence,
          });
      } catch {
        unresolved++;
      }
    }
    await this.ledger.recoveryCursor(this.chainId, batch.at(-1)?.key ?? null);
    return { examined, settled, unresolved };
  }
}
