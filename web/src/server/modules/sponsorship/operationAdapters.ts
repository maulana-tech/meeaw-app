import "server-only";
import type {
  ActionTicket,
  UnavailableReason,
} from "../../../features/sponsorship/types";
import { resolvePool } from "../../../lib/pools";
import type { PaymentRequestDoc } from "../../db/mongo";
import type { TransferDoc } from "../transfers/transfers.repository";
import type { SponsorLedger } from "./ledger.service";
import { SponsorshipError } from "./sponsorship.errors";
import { sponsorshipLedger } from "./sponsorship.service";
export type OperationKind = "request" | "transfer";
export class OperationSponsorship {
  constructor(readonly ledger: SponsorLedger) {}
  async target(kind: OperationKind, id: string) {
    const db = this.ledger.options.db;
    if (kind === "transfer") {
      const doc = await db
        .collection<TransferDoc>("private_transfers")
        .findOne({ "operation.id": id });
      if (!doc || doc.operationId !== id)
        throw new SponsorshipError("initializing");
      return {
        collection: db.collection<{ _id: string }>("private_transfers"),
        where: { _id: doc._id, operationId: id },
        path: "operation",
        operation: doc.operation,
        owner: doc.sender.wallet,
        spendId: `transfer:${doc.id}`,
        submission: doc.currentSubmission,
        chainId: resolvePool(doc.pool).chainId,
        actionId: `send:${doc.id}`,
        digest: doc.digest as `0x${string}`,
        kind: "send" as const,
      };
    }
    const doc = await db
      .collection<PaymentRequestDoc>("payment_requests")
      .findOne({ operationId: id });
    if (!doc?.reservation || doc.reservation.attemptId !== id)
      throw new SponsorshipError("initializing");
    return {
      collection: db.collection<{ _id: string }>("payment_requests"),
      where: { _id: doc._id, operationId: id },
      path: "reservation",
      operation: doc.reservation,
      owner: doc.addresseeWallet as `0x${string}`,
      spendId: `request:${id}`,
      submission: doc.reservation.currentSubmission,
      chainId: resolvePool(doc.scope).chainId,
      actionId: `request-pay:${id}`,
      digest: doc.digest as `0x${string}`,
      kind: "request-pay" as const,
    };
  }
  async ensure(
    kind: OperationKind,
    operationId: string,
    user?: string,
  ): Promise<ActionTicket> {
    const t = await this.target(kind, operationId);
    const existing = await this.ledger.readAction(t.chainId, t.actionId);
    let ticket: ActionTicket;
    if (existing) {
      if (
        existing.intent.kind !== t.kind ||
        existing.intent.businessDigest !== t.digest ||
        existing.intent.principal.kind !== "user" ||
        (user && existing.intent.principal.key !== user) ||
        existing.phase === "cancelled" ||
        (existing.phase === "closed" &&
          !["confirmed", "failed"].includes(t.operation.phase))
      )
        throw new SponsorshipError("budget");
      ticket = {
        chainId: t.chainId,
        actionId: t.actionId,
        fence: existing.fence,
      };
    } else {
      if (!user || ["confirmed", "failed"].includes(t.operation.phase))
        throw new SponsorshipError("initializing");
      const policy = this.ledger.options.policy();
      ticket = await this.ledger.admit({
        chainId: t.chainId,
        actionId: t.actionId,
        kind: t.kind,
        principal: { kind: "user", key: user },
        businessDigest: t.digest,
        maximumChildren: policy.ready ? policy.policy.maxChildren : 16,
      });
    }
    const admitted = await this.ledger.readAction(t.chainId, ticket.actionId);
    const sponsorshipStepLimit = admitted?.intent.maximumChildren;
    if (!sponsorshipStepLimit) throw new SponsorshipError("rpc");
    await t.collection.updateOne(t.where, {
      $set: { [`${t.path}.sponsorshipStepLimit`]: sponsorshipStepLimit },
    });
    if (t.operation.sponsorshipAction) {
      const prior = t.operation.sponsorshipAction;
      if (
        prior.actionId !== ticket.actionId ||
        prior.chainId !== ticket.chainId ||
        prior.fence !== ticket.fence
      )
        throw new SponsorshipError("budget");
      return ticket;
    }
    await t.collection.updateOne(
      { ...t.where, [`${t.path}.sponsorshipAction`]: { $exists: false } },
      {
        $set: {
          [`${t.path}.sponsorshipAction`]: ticket,
          [`${t.path}.sponsorshipStepLimit`]: sponsorshipStepLimit,
        },
      },
    );
    const latest = await this.target(kind, operationId);
    const saved = latest.operation.sponsorshipAction;
    if (
      !saved ||
      saved.fence !== ticket.fence ||
      saved.actionId !== ticket.actionId
    )
      throw new SponsorshipError("rpc");
    return ticket;
  }
  async abandon(
    kind: OperationKind,
    id: string,
    user: string,
    releaseCapture: (
      owner: `0x${string}`,
      spendId: string,
      capture: import("../../../features/privacyKeys/types").FundingCapture,
    ) => Promise<void>,
  ) {
    const t = await this.target(kind, id),
      ticket = t.operation.sponsorshipAction;
    if (
      !ticket ||
      t.submission ||
      t.operation.nextStep !== 0 ||
      !["preparing", "failed"].includes(t.operation.phase)
    )
      throw new SponsorshipError("budget");
    const action = await this.ledger.readAction(
      ticket.chainId,
      ticket.actionId,
    );
    if (
      action?.intent.principal.kind !== "user" ||
      action.intent.principal.key !== user ||
      action.charged ||
      Object.values(action.children).some(
        (c) => !["allocated", "abandoned"].includes(c.phase),
      )
    )
      throw new SponsorshipError("budget");
    const changed = await t.collection.updateOne(
      {
        ...t.where,
        [`${t.path}.phase`]: t.operation.phase,
        [`${t.path}.nextStep`]: 0,
        [kind === "transfer"
          ? "currentSubmission"
          : "reservation.currentSubmission"]: null,
      },
      {
        $set: {
          [`${t.path}.phase`]: "failed",
          ...(kind === "transfer" ? { status: "failed" } : {}),
        },
      },
    );
    if (!changed.matchedCount) throw new SponsorshipError("budget");
    if (action.phase !== "closed" && action.phase !== "cancelled")
      await this.ledger.cancelUnsigned(ticket);
    await releaseCapture(t.owner, t.spendId, t.operation);
    if (kind === "request") {
      await this.ledger.options.db
        .collection<{ _id: string; phase: string }>("request_operations")
        .updateOne({ _id: id }, { $set: { phase: "failed" } });
      await t.collection.updateOne(
        { ...t.where, "reservation.phase": "failed" },
        {
          $set: { operationId: null, reservation: null },
          $inc: { revision: 1 },
        },
      );
    }
  }
  async pause(
    kind: OperationKind,
    operationId: string,
    reason: UnavailableReason,
  ) {
    const t = await this.target(kind, operationId);
    if (["confirmed", "failed"].includes(t.operation.phase)) return;
    await t.collection.updateOne(
      {
        ...t.where,
        [`${t.path}.nextStep`]: t.operation.nextStep,
        [`${t.path}.phase`]: t.operation.phase,
      },
      { $set: { [`${t.path}.sponsorshipPause`]: reason } },
    );
  }
  async resume(kind: OperationKind, operationId: string) {
    const t = await this.target(kind, operationId),
      ticket = t.operation.sponsorshipAction;
    if (!ticket) throw new SponsorshipError("initializing");
    const policy = this.ledger.options.policy();
    if (!policy.ready) throw new SponsorshipError("configuration");
    const action = await this.ledger.readAction(
      ticket.chainId,
      ticket.actionId,
    );
    if (
      !action ||
      action.fence !== ticket.fence ||
      action.phase === "cancelled" ||
      BigInt(action.remainingWei) <= 0n
    )
      throw new SponsorshipError("budget");
    await this.ledger.resumeAction(ticket);
    await t.collection.updateOne(
      { ...t.where, [`${t.path}.sponsorshipAction.fence`]: ticket.fence },
      { $unset: { [`${t.path}.sponsorshipPause`]: "" } },
    );
  }
  async finish(kind: OperationKind, operationId: string) {
    const t = await this.target(kind, operationId);
    if (
      t.operation.sponsorshipAction &&
      ["confirmed", "failed"].includes(t.operation.phase)
    )
      await this.ledger.closeAction(t.operation.sponsorshipAction);
  }
}
export async function operationSponsorship() {
  return new OperationSponsorship(await sponsorshipLedger());
}
export async function pauseOperationSponsorship(
  kind: OperationKind,
  id: string,
  reason: UnavailableReason,
) {
  await (await operationSponsorship()).pause(kind, id, reason);
}
export async function resumeOperationSponsorship(
  kind: OperationKind,
  id: string,
) {
  await (await operationSponsorship()).resume(kind, id);
}
