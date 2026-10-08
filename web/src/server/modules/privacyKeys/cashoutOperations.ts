import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { Hex } from "viem";
import type { FundingCapture } from "../../../features/privacyKeys/types";
import { PrivacyKeyConflictError } from "./privacyKeys.repository";
import type { AccountSpendGate } from "./spendGate";

type CashoutInput = {
  operationId: string;
  fundingGeneration: number;
  keyRevision: number;
  pool: string;
  nullifier: Hex;
};
type Cashout = {
  _id: string;
  operationId: string;
  owner: Hex;
  registry: string;
  pool: string;
  nullifier: Hex;
  fundingGeneration: number;
  keyRevision: number;
  capture?: FundingCapture;
  phase: "prepared" | "dispatching" | "cancelled" | "confirmed";
  released: boolean;
};
export class CashoutOperations {
  readonly records;
  constructor(
    db: Db,
    readonly gate: AccountSpendGate,
    readonly spent: (record: Cashout) => Promise<boolean>,
  ) {
    this.records = db.collection<Cashout>("privacy_cashouts");
  }
  async admit(owner: Hex, input: CashoutInput) {
    owner = owner.toLowerCase() as Hex;
    const digest = createHash("sha256")
      .update(`${owner}:${this.gate.registry}:${input.pool}:${input.nullifier}`)
      .digest("hex");
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    await this.records.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          operationId: input.operationId,
          owner,
          registry: this.gate.registry,
          pool: input.pool,
          nullifier: input.nullifier,
          fundingGeneration: input.fundingGeneration,
          keyRevision: input.keyRevision,
          phase: "prepared",
          released: false,
        },
      },
      { upsert: true },
    );
    let record = await this.records.findOne({ _id: id, owner });
    if (!record || record.phase === "confirmed")
      throw new PrivacyKeyConflictError(
        "This cash-out is already confirmed. Refresh your balance.",
      );
    if (record.phase === "cancelled") {
      if (!record.released) await this.release(record, "unsigned-abandoned");
      await this.records.updateOne(
        { _id: id, phase: "cancelled", released: true },
        {
          $set: {
            operationId: input.operationId,
            phase: "prepared",
            released: false,
            keyRevision: input.keyRevision,
          },
          $unset: { capture: "" },
        },
      );
      record = await this.records.findOne({ _id: id, owner });
      if (!record)
        throw new PrivacyKeyConflictError("Cash-out state is unavailable.");
    }
    const state = await this.gate.repo.get(owner, this.gate.registry);
    if (!state)
      throw new PrivacyKeyConflictError("Privacy key history is unavailable.");
    const capture = await this.gate.admit(
      owner,
      `cashout:${record.operationId}`,
      state.generations[state.activeGeneration],
      {
        fundingGeneration: record.fundingGeneration,
        keyRevision: input.keyRevision,
      },
    );
    const saved = await this.records.updateOne(
      {
        _id: id,
        owner,
        operationId: record.operationId,
        phase: { $in: ["prepared", "dispatching"] },
      },
      { $set: { capture, keyRevision: input.keyRevision } },
    );
    if (!saved.matchedCount) {
      await this.gate.finish(
        owner,
        `cashout:${record.operationId}`,
        capture,
        "unsigned-abandoned",
      );
      throw new PrivacyKeyConflictError(
        "Cash-out admission was cancelled. Try again.",
      );
    }
    return { ...capture, operationId: record.operationId };
  }
  async captured(record: Cashout) {
    if (record.capture?.accountTicketId) return record.capture;
    const account = await this.gate.repo.accounts.findOne({
      _id: `${record.owner}:${record.registry}`,
    });
    const ticket = account?.tickets.find(
      (t) => t.operationId === `cashout:${record.operationId}`,
    );
    return ticket
      ? {
          accountTicketId: ticket.id,
          keyRevision: ticket.revision,
          fundingGeneration: ticket.fundingGeneration,
        }
      : {};
  }
  async dispatch(owner: Hex, id: string, capture: FundingCapture) {
    const record = await this.records.findOne({
      operationId: id,
      owner: owner.toLowerCase() as Hex,
    });
    if (!record || !["prepared", "dispatching"].includes(record.phase))
      throw new PrivacyKeyConflictError(
        "Cash-out admission was cancelled. Try again.",
      );
    await this.gate.assert(record.owner, `cashout:${id}`, capture);
    const changed = await this.records.findOneAndUpdate(
      {
        operationId: id,
        owner: record.owner,
        phase: { $in: ["prepared", "dispatching"] },
        "capture.accountTicketId": capture.accountTicketId,
      },
      { $set: { phase: "dispatching" } },
      { returnDocument: "after" },
    );
    if (!changed)
      throw new PrivacyKeyConflictError(
        "Cash-out admission was cancelled. Try again.",
      );
    return { dispatched: true };
  }
  async release(record: Cashout, evidence: "terminal" | "unsigned-abandoned") {
    await this.gate.finish(
      record.owner,
      `cashout:${record.operationId}`,
      await this.captured(record),
      evidence,
    );
    await this.records.updateOne(
      { _id: record._id, operationId: record.operationId, phase: record.phase },
      { $set: { released: true } },
    );
  }
  async cancel(owner: Hex, id: string) {
    const record = await this.records.findOneAndUpdate(
      { operationId: id, owner: owner.toLowerCase() as Hex, phase: "prepared" },
      { $set: { phase: "cancelled" } },
      { returnDocument: "after" },
    );
    if (!record)
      throw new PrivacyKeyConflictError(
        "Submitted cash-out must be reconciled or retried.",
      );
    await this.release(record, "unsigned-abandoned");
    return { released: true };
  }
  async finish(owner: Hex, id: string) {
    const record = await this.records.findOne({
      operationId: id,
      owner: owner.toLowerCase() as Hex,
    });
    if (!record || !(await this.spent(record)))
      throw new PrivacyKeyConflictError(
        "Cash-out is still awaiting confirmed spend evidence. Retry this payment or check again.",
      );
    await this.records.updateOne(
      { operationId: id, owner: record.owner },
      { $set: { phase: "confirmed" } },
    );
    await this.release({ ...record, phase: "confirmed" }, "terminal");
    return { released: true };
  }
  async reconcile(owner: Hex, abandonPrepared = false) {
    const records = await this.records
      .find({
        owner: owner.toLowerCase() as Hex,
        registry: this.gate.registry,
        released: false,
      })
      .limit(128)
      .toArray();
    for (const record of records) {
      if (record.phase === "cancelled" || record.phase === "confirmed")
        await this.release(
          record,
          record.phase === "cancelled" ? "unsigned-abandoned" : "terminal",
        );
      else if (await this.spent(record))
        await this.finish(record.owner, record.operationId);
      else if (abandonPrepared && record.phase === "prepared") {
        try {
          await this.cancel(record.owner, record.operationId);
        } catch (error) {
          if (!(error instanceof PrivacyKeyConflictError)) throw error;
        }
      }
    }
  }
}
