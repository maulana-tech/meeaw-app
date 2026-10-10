import "server-only";
import type { Db } from "mongodb";
import type {
  PolicyState,
  SponsorPolicy,
} from "../../../features/sponsorship/types";
import {
  emptyLedger,
  type LedgerSnapshot,
  ledgerKey,
  reduceSponsorCommand,
  restorePolicy,
  type SponsorCommand,
  sameActionIntent,
} from "./ledgerModel";
import { SponsorshipError } from "./sponsorship.errors";
export type SponsorClock = { now(): Promise<Date> };
export class SponsorLedgerRepository {
  readonly ledgers;
  readonly archives;
  constructor(
    readonly db: Db,
    readonly policy: () => PolicyState,
    readonly clock?: SponsorClock,
  ) {
    this.ledgers = db.collection<LedgerSnapshot>("sponsorship_ledgers");
    this.archives = db.collection<{
      _id: string;
      action: LedgerSnapshot["actions"][string];
    }>("sponsorship_actions");
  }
  async snapshot(chainId: number) {
    const initial = emptyLedger(chainId, new Date(0), "initializing");
    const { serverNow: ignored, ...insert } = initial;
    void ignored;
    const doc = await this.ledgers.findOneAndUpdate(
      { _id: initial._id },
      { $setOnInsert: insert, $currentDate: { serverNow: true } },
      { upsert: true, returnDocument: "after", includeResultMetadata: false },
    );
    if (!doc) throw new SponsorshipError("rpc");
    return doc;
  }
  async mutate(chainId: number, cmd: SponsorCommand) {
    for (let attempts = 0; attempts < 8; attempts++) {
      const doc = await this.snapshot(chainId),
        state = this.policy();
      let policy: SponsorPolicy;
      if (state.ready) policy = state.policy;
      else {
        if (cmd.kind === "status" && !doc.policy) {
          const now = this.clock ? await this.clock.now() : doc.serverNow;
          return {
            configured: false,
            available: false,
            reason: "configuration" as const,
            limit: null,
            used: null,
            reserved: null,
            remaining: null,
            resetAt: new Date(
              Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate() + 1,
              ),
            ).toISOString(),
          };
        }
        if (["admit", "allocate", "signing"].includes(cmd.kind) || !doc.policy)
          if (
            cmd.kind !== "import" &&
            cmd.kind !== "baseline" &&
            cmd.kind !== "recovery-cursor"
          )
            throw new SponsorshipError("configuration");
        policy = doc.policy
          ? restorePolicy(doc.policy)
          : {
              revision: "legacy-baseline",
              userLimit: 0,
              guestWalletLimit: 0,
              anonymousLimit: 0,
              globalWei: 0n,
              anonymousWei: 0n,
              actionWei: 0n,
              balanceFloorWei: 0n,
              feeCeilingWei: (1n << 256n) - 1n,
              maxChildren: 16,
            };
      }
      if (
        cmd.kind === "import" &&
        !doc.actions[ledgerKey(cmd.intent.actionId)]
      ) {
        const archived = await this.archives.findOne({
            _id: `${chainId}:${cmd.intent.actionId}`,
          }),
          a = archived?.action,
          c = a?.children[ledgerKey("legacy")];
        if (a) {
          if (
            !a.legacy ||
            !sameActionIntent(a.intent, cmd.intent) ||
            c?.hash !== cmd.hash ||
            c.digest !== cmd.digest
          )
            throw new SponsorshipError("cost");
          return {
            chainId,
            actionId: cmd.intent.actionId,
            fence: a.fence,
            childId: "legacy",
            childFence: c.fence,
          };
        }
      }
      if (
        cmd.kind === "admit" &&
        !doc.actions[ledgerKey(cmd.intent.actionId)]
      ) {
        const archived = await this.archives.findOne({
          _id: `${chainId}:${cmd.intent.actionId}`,
        });
        if (archived) {
          if (
            !sameActionIntent(archived.action.intent, cmd.intent) ||
            archived.action.phase !== "closed"
          )
            throw new SponsorshipError("budget");
          return {
            chainId,
            actionId: cmd.intent.actionId,
            fence: archived.action.fence,
          };
        }
      }
      if (
        cmd.kind === "settle" &&
        !doc.actions[ledgerKey(cmd.ticket.actionId)]
      ) {
        const archived = await this.archives.findOne({
          _id: `${chainId}:${cmd.ticket.actionId}`,
        });
        const a = archived?.action;
        const c = a?.children[ledgerKey(cmd.ticket.childId)];
        if (a) {
          if (
            a.intent.chainId !== chainId ||
            a.phase !== "closed" ||
            c?.phase !== "settled" ||
            !c.paid
          )
            throw new SponsorshipError("budget");
          const now = this.clock ? await this.clock.now() : doc.serverNow;
          // Reuse settlement validation without restoring archived costs into the live budget.
          const validation = emptyLedger(chainId, now, "complete");
          validation.actions[ledgerKey(cmd.ticket.actionId)] = a;
          reduceSponsorCommand(validation, cmd, policy, now);
          return;
        }
      }
      if (
        (cmd.kind === "close" || cmd.kind === "cancel") &&
        !doc.actions[ledgerKey(cmd.ticket.actionId)]
      ) {
        const archived = await this.archives.findOne({
          _id: `${chainId}:${cmd.ticket.actionId}`,
        });
        if (
          archived?.action.fence === cmd.ticket.fence &&
          archived.action.phase ===
            (cmd.kind === "close" ? "closed" : "cancelled")
        )
          return;
      }
      const now = this.clock ? await this.clock.now() : doc.serverNow;
      const reduced = reduceSponsorCommand(doc, cmd, policy, now);
      const { _id, revision, serverNow, ...fields } = reduced.state;
      void serverNow;
      const saved = await this.ledgers.findOneAndUpdate(
        { _id, revision },
        { $set: fields, $inc: { revision: 1 } },
        { returnDocument: "after", includeResultMetadata: false },
      );
      if (saved) {
        if (cmd.kind === "close" || cmd.kind === "cancel")
          await this.archive(chainId, cmd.ticket.actionId);
        return !state.ready && cmd.kind === "status"
          ? {
              ...reduced.result,
              available: false,
              configured: false,
              reason: "configuration" as const,
            }
          : reduced.result;
      }
    }
    throw new SponsorshipError("rpc");
  }
  async archive(chainId: number, actionId: string) {
    const key = ledgerKey(actionId);
    for (let n = 0; n < 8; n++) {
      const doc = await this.ledgers.findOne({ _id: `chain:${chainId}` }),
        a = doc?.actions[key];
      if (!doc || !a) return;
      if (a.phase !== "closed" && a.phase !== "cancelled") return;
      await this.archives.updateOne(
        { _id: `${chainId}:${actionId}` },
        { $setOnInsert: { action: a } },
        { upsert: true },
      );
      const removed = await this.ledgers.updateOne(
        {
          _id: doc._id,
          revision: doc.revision,
          [`actions.${key}.fence`]: a.fence,
        },
        { $unset: { [`actions.${key}`]: "" }, $inc: { revision: 1 } },
      );
      if (removed.modifiedCount) return;
    }
    throw new SponsorshipError("rpc");
  }
}
