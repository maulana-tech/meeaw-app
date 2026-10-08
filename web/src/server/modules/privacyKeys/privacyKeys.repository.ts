import "server-only";
import { randomUUID } from "node:crypto";
import type { Collection, Db } from "mongodb";
import { hashTypedData } from "viem";
import { rotationTypedData } from "../../../features/privacyKeys/rotationTypedData";
import type {
  AccountTicket,
  GenerationEvidence,
  PrivacyKeyState,
  RotationIntent,
  RotationOperation,
} from "../../../features/privacyKeys/types";
import {
  privacyKeyStateSchema,
  rotationIntentSchema,
} from "./privacyKeys.schema";

type AccountDoc = {
  _id: string;
  state: PrivacyKeyState;
  tickets: AccountTicket[];
};
const key = (owner: string, registry: string) =>
  `${owner.toLowerCase()}:${registry.toLowerCase()}`;
export class PrivacyKeyConflictError extends Error {}
const conflict = () =>
  new PrivacyKeyConflictError(
    "Privacy key state changed or another account operation is pending",
  );
const identicalTicket = (a: AccountTicket, b: AccountTicket) =>
  a.id === b.id &&
  a.operationId === b.operationId &&
  a.owner === b.owner &&
  a.registry === b.registry &&
  a.revision === b.revision &&
  a.fundingGeneration === b.fundingGeneration &&
  a.kind === b.kind;

export class PrivacyKeysRepository {
  readonly accounts: Collection<AccountDoc>;
  readonly rotations: Collection<{
    _id: string;
    id: string;
    owner: string;
    registry: string;
    pending: boolean;
    operation: RotationOperation;
  }>;
  constructor(db: Db) {
    this.accounts = db.collection<AccountDoc>("privacy_key_accounts");
    this.rotations = db.collection("privacy_key_rotations");
  }
  async bootstrap(input: PrivacyKeyState): Promise<PrivacyKeyState> {
    const state = privacyKeyStateSchema.parse(input);
    if (state.activeGeneration !== 0 || state.revision !== 1 || state.pending)
      throw conflict();
    const _id = key(state.owner, state.registry);
    await this.accounts.updateOne(
      { _id },
      { $setOnInsert: { state, tickets: [] } },
      { upsert: true },
    );
    const stored = await this.get(state.owner, state.registry);
    if (!stored || JSON.stringify(stored) !== JSON.stringify(state))
      throw conflict();
    return stored;
  }
  async get(owner: string, registry: string): Promise<PrivacyKeyState | null> {
    const doc = await this.accounts.findOne({ _id: key(owner, registry) });
    return doc ? privacyKeyStateSchema.parse(doc.state) : null;
  }
  async prepare(input: RotationIntent): Promise<RotationOperation> {
    const intent = rotationIntentSchema.parse(input),
      _id = key(intent.owner, intent.registry);
    const pending: RotationOperation = {
      intent,
      phase: "prepared",
      txHash: null,
      updatedAt: new Date().toISOString(),
    };
    const changed = await this.accounts.findOneAndUpdate(
      {
        _id,
        "state.revision": intent.expectedRevision,
        "state.activeGeneration": intent.from,
        "state.username": intent.username,
        "state.pending": null,
        "state.generations.notePubkey": { $ne: intent.newKeys.notePubkey },
        "state.generations.viewPubkey": { $ne: intent.newKeys.viewPubkey },
        tickets: { $size: 0 },
        [`state.generations.${intent.from}.notePubkey`]:
          intent.oldKeys.notePubkey,
        [`state.generations.${intent.from}.viewPubkey`]:
          intent.oldKeys.viewPubkey,
      },
      { $set: { "state.pending": pending } },
      { returnDocument: "after" },
    );
    if (changed) return changed.state.pending as RotationOperation;
    const current = await this.get(intent.owner, intent.registry);
    if (
      current?.pending?.intent.id === intent.id &&
      hashTypedData(rotationTypedData(current.pending.intent)) ===
        hashTypedData(rotationTypedData(intent))
    )
      return current.pending;
    throw conflict();
  }
  async acquireTicket(
    input: Omit<AccountTicket, "id">,
  ): Promise<AccountTicket> {
    if (
      !input.operationId ||
      input.operationId.length > 128 ||
      !Number.isInteger(input.fundingGeneration) ||
      input.fundingGeneration < 0 ||
      input.fundingGeneration > 63 ||
      !["spend", "recovery-change"].includes(input.kind)
    )
      throw conflict();
    const ticket: AccountTicket = {
      ...input,
      owner: input.owner.toLowerCase() as AccountTicket["owner"],
      registry: input.registry.toLowerCase() as AccountTicket["registry"],
      id: randomUUID(),
    };
    const _id = key(ticket.owner, ticket.registry);
    const filter = {
      _id,
      "state.revision": ticket.revision,
      "state.pending": null,
      [`state.generations.${ticket.fundingGeneration}.id`]:
        ticket.fundingGeneration,
      "tickets.operationId": { $ne: ticket.operationId },
      ...(ticket.kind === "recovery-change"
        ? { tickets: { $size: 0 } }
        : {
            "tickets.kind": { $ne: "recovery-change" },
            "tickets.127": { $exists: false },
          }),
    };
    const changed = await this.accounts.findOneAndUpdate(
      filter,
      { $push: { tickets: ticket } },
      { returnDocument: "after" },
    );
    if (changed) return ticket;
    const doc = await this.accounts.findOne({ _id });
    const existing = doc?.tickets.find(
      (t) => t.operationId === ticket.operationId,
    );
    if (existing && identicalTicket(existing, { ...ticket, id: existing.id }))
      return existing;
    throw conflict();
  }
  async assertTicket(ticket: AccountTicket): Promise<void> {
    const doc = await this.accounts.findOne({
      _id: key(ticket.owner, ticket.registry),
      "state.revision": ticket.revision,
    });
    if (!doc?.tickets.some((t) => identicalTicket(t, ticket))) throw conflict();
  }
  async releaseTicket(
    ticket: AccountTicket,
    evidence: "terminal" | "unsigned-abandoned",
  ): Promise<void> {
    if (evidence !== "terminal" && evidence !== "unsigned-abandoned")
      throw conflict();
    await this.assertTicket(ticket);
    await this.accounts.updateOne(
      {
        _id: key(ticket.owner, ticket.registry),
        "state.revision": ticket.revision,
      },
      { $pull: { tickets: { id: ticket.id } } },
    );
  }
  async operation(
    owner: string,
    registry: string,
    id: string,
  ): Promise<RotationOperation> {
    const state = await this.get(owner, registry);
    if (state?.pending?.intent.id === id) return state.pending;
    const stored = await this.rotations.findOne({
      _id: `${key(owner, registry)}:${id}`,
    });
    if (!stored) throw conflict();
    return stored.operation;
  }
  async saveOperation(
    owner: string,
    registry: string,
    operation: RotationOperation,
  ): Promise<RotationOperation> {
    const doc = await this.accounts.findOneAndUpdate(
      {
        _id: key(owner, registry),
        "state.pending.intent.id": operation.intent.id,
        $or: [
          { "state.pending.txHash": null },
          { "state.pending.txHash": operation.txHash },
        ],
      },
      {
        $set: {
          "state.pending.phase": operation.phase,
          "state.pending.txHash": operation.txHash,
          "state.pending.updatedAt": operation.updatedAt,
          ...(operation.searchEvidence
            ? { "state.pending.searchEvidence": operation.searchEvidence }
            : {}),
        },
      },
      { returnDocument: "after" },
    );
    if (!doc?.state.pending) throw conflict();
    return doc.state.pending;
  }
  async authorize(
    owner: string,
    registry: string,
    id: string,
    authorization: NonNullable<RotationOperation["registryAuthorization"]>,
    evidence?: GenerationEvidence,
  ): Promise<RotationOperation> {
    const changed = await this.accounts.findOneAndUpdate(
      {
        _id: key(owner, registry),
        "state.pending.intent.id": id,
        "state.pending.registryAuthorization": { $exists: false },
      },
      {
        $set: {
          "state.pending.registryAuthorization": authorization,
          ...(evidence
            ? { "state.pending.authorizationEvidence": evidence }
            : {}),
        },
      },
      { returnDocument: "after" },
    );
    if (changed?.state.pending) return changed.state.pending;
    const op = await this.operation(owner, registry, id);
    if (
      JSON.stringify(op.registryAuthorization) !== JSON.stringify(authorization)
    )
      throw conflict();
    return op;
  }
  async appendConfirmed(
    owner: string,
    registry: string,
    operation: RotationOperation,
    evidence: GenerationEvidence,
  ): Promise<PrivacyKeyState> {
    const intent = operation.intent;
    const changed = await this.accounts.findOneAndUpdate(
      {
        _id: key(owner, registry),
        "state.pending.intent.id": intent.id,
        "state.revision": intent.expectedRevision,
        "state.activeGeneration": intent.from,
      },
      {
        $push: {
          "state.generations": { id: intent.to, ...intent.newKeys, evidence },
        },
        $inc: { "state.revision": 1 },
        $set: {
          "state.activeGeneration": intent.to,
          "state.pending.phase": "confirming",
        },
      },
      { returnDocument: "after" },
    );
    if (changed) return privacyKeyStateSchema.parse(changed.state);
    const state = await this.get(owner, registry);
    const entry = state?.generations[intent.to];
    if (
      !state ||
      state.activeGeneration !== intent.to ||
      state.revision !== intent.expectedRevision + 1 ||
      entry?.evidence.txHash !== evidence.txHash ||
      entry.notePubkey !== intent.newKeys.notePubkey ||
      entry.viewPubkey !== intent.newKeys.viewPubkey
    )
      throw conflict();
    return state;
  }
  async completeProjection(
    owner: string,
    registry: string,
    operation: RotationOperation,
  ): Promise<RotationOperation> {
    const completed: RotationOperation = {
      ...operation,
      phase: "confirmed",
      updatedAt: new Date().toISOString(),
    };
    const intent = operation.intent,
      _id = `${key(owner, registry)}:${intent.id}`;
    await this.rotations.updateOne(
      { _id },
      {
        $set: {
          id: intent.id,
          owner: owner.toLowerCase(),
          registry: registry.toLowerCase(),
          pending: false,
          operation: completed,
        },
      },
      { upsert: true },
    );
    await this.accounts.updateOne(
      {
        _id: key(owner, registry),
        "state.pending.intent.id": intent.id,
        "state.activeGeneration": intent.to,
        "state.revision": intent.expectedRevision + 1,
      },
      {
        $set: {
          "state.pending": null,
          [`state.generations.${intent.to}.rotatedAt`]: completed.updatedAt,
        },
      },
    );
    return completed;
  }
  async terminateRotation(
    owner: string,
    registry: string,
    op: RotationOperation,
    unsigned = false,
  ): Promise<RotationOperation> {
    const operation: RotationOperation = {
      ...op,
      phase: "failed",
      updatedAt: new Date().toISOString(),
    };
    const intent = op.intent;
    const filter = {
      _id: key(owner, registry),
      "state.pending.intent.id": intent.id,
      "state.revision": intent.expectedRevision,
      "state.activeGeneration": intent.from,
      ...(unsigned
        ? {
            "state.pending.registryAuthorization": { $exists: false },
            "state.pending.txHash": null,
          }
        : {}),
    };
    const current = await this.accounts.findOne(filter);
    if (!current) throw conflict();
    await this.rotations.updateOne(
      { _id: `${key(owner, registry)}:${intent.id}` },
      {
        $set: {
          id: intent.id,
          owner: owner.toLowerCase(),
          registry: registry.toLowerCase(),
          pending: false,
          operation,
        },
      },
      { upsert: true },
    );
    const result = await this.accounts.updateOne(filter, {
      $set: { "state.pending": null },
    });
    if (!result.matchedCount) throw conflict();
    return operation;
  }
}
