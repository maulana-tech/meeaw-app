import "server-only";
import { type Db, MongoServerError } from "mongodb";
import type { Hex, PoolScope } from "../../features/transfers/types";
import { RelayJournal } from "./relayJournal";
export type SpendOwner = {
  kind: "transfer" | "request" | "withdraw" | "ordinary-transfer";
  id: string;
  sender: Hex;
  scope: PoolScope;
};
export type SpendClaim = {
  owner: SpendOwner;
  fence: number;
  nullifiers: readonly Hex[];
  phase: "reserved" | "dispatching" | "signed" | "uncertain" | "releasing";
};
type OwnerDoc = {
  _id: string;
  fence: number;
  active: (SpendClaim & { expiresAt: Date; operationKey?: string }) | null;
};
type NoteDoc = {
  _id: string;
  ownerKey: string;
  operationId: string;
  fence: number;
};
export class SpendConflictError extends Error {
  constructor() {
    super("These funds are already being used by another payment.");
    this.name = "SpendConflictError";
  }
}
const key = (o: SpendOwner) => `${o.scope}:${o.sender.toLowerCase()}`;
export class SpendReservations {
  readonly owners;
  readonly notes;
  constructor(private readonly db: Db) {
    this.owners = db.collection<OwnerDoc>("spend_claims");
    this.notes = db.collection<NoteDoc>("spend_nullifiers");
  }
  async read(owner: SpendOwner) {
    const active = (
      await this.owners.findOne({
        _id: key(owner),
        "active.owner.id": owner.id,
      })
    )?.active;
    return active ?? null;
  }
  async claim(
    owner: SpendOwner,
    nullifiers: readonly Hex[],
    now = new Date(),
  ): Promise<SpendClaim> {
    const nfs = nullifiers.map((n) => n.toLowerCase() as Hex).sort();
    if (!nfs.length || nfs.length > 2 || new Set(nfs).size !== nfs.length)
      throw new SpendConflictError();
    const ownerKey = key(owner);
    try {
      await this.owners.updateOne(
        { _id: ownerKey },
        { $setOnInsert: { fence: 0, active: null } },
        { upsert: true },
      );
    } catch (e) {
      if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
    }
    const prior = await this.owners.findOne({ _id: ownerKey });
    if (!prior) throw new SpendConflictError();
    if (prior.active) {
      if (
        prior.active.owner.id === owner.id &&
        prior.active.owner.kind === owner.kind &&
        prior.active.nullifiers.join() === nfs.join()
      )
        return prior.active;
      // Even unsigned claims are recovered explicitly; an old preparer cannot be
      // silently displaced while it is entering the signing boundary.
      throw new SpendConflictError();
    }
    const claim: SpendClaim = {
      owner,
      fence: prior.fence + 1,
      nullifiers: nfs,
      phase: "reserved",
    };
    const claimed = await this.owners.findOneAndUpdate(
      { _id: ownerKey, fence: prior.fence, active: null },
      {
        $set: {
          active: { ...claim, expiresAt: new Date(now.getTime() + 60_000) },
        },
        $inc: { fence: 1 },
      },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!claimed) throw new SpendConflictError();
    try {
      for (const nf of nfs) {
        const id = `${owner.scope}:${nf}`;
        const existing = await this.notes.findOne({ _id: id });
        if (
          existing &&
          (existing.ownerKey !== ownerKey ||
            existing.operationId !== owner.id ||
            existing.fence !== claim.fence)
        )
          throw new SpendConflictError();
        if (!existing)
          await this.notes.insertOne({
            _id: id,
            ownerKey,
            operationId: owner.id,
            fence: claim.fence,
          });
      }
      return claim;
    } catch (e) {
      await this.release(claim, "unsigned-abandoned");
      if (e instanceof MongoServerError && e.code === 11000)
        throw new SpendConflictError();
      throw e;
    }
  }
  async assertOwned(claim: SpendClaim) {
    const doc = await this.owners.findOne({
      _id: key(claim.owner),
      fence: claim.fence,
      "active.owner.id": claim.owner.id,
    });
    if (!doc?.active || doc.active.phase === "releasing")
      throw new SpendConflictError();
    for (const nf of claim.nullifiers)
      if (
        !(await this.notes.findOne({
          _id: `${claim.owner.scope}:${nf}`,
          ownerKey: key(claim.owner),
          operationId: claim.owner.id,
          fence: claim.fence,
        }))
      )
        throw new SpendConflictError();
    return doc.active;
  }
  async enterDispatch(claim: SpendClaim): Promise<SpendClaim> {
    await this.assertOwned(claim);
    const changed = await this.owners.findOneAndUpdate(
      {
        _id: key(claim.owner),
        fence: claim.fence,
        "active.owner.id": claim.owner.id,
        "active.phase": { $in: ["reserved", "dispatching"] },
      },
      { $set: { "active.phase": "dispatching" } },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!changed?.active) throw new SpendConflictError();
    return changed.active;
  }
  async pinSigned(claim: SpendClaim, operationKey: string) {
    const changed = await this.owners.updateOne(
      {
        _id: key(claim.owner),
        fence: claim.fence,
        "active.owner.id": claim.owner.id,
        "active.phase": { $in: ["dispatching", "signed"] },
      },
      {
        $set: { "active.phase": "signed", "active.operationKey": operationKey },
      },
    );
    if (!changed.matchedCount) throw new SpendConflictError();
  }
  async release(
    claim: SpendClaim,
    evidence: "unsigned-abandoned" | "confirmed" | "reverted",
  ) {
    const filter = {
      _id: key(claim.owner),
      fence: claim.fence,
      "active.owner.id": claim.owner.id,
      ...(evidence === "unsigned-abandoned"
        ? { "active.phase": { $in: ["reserved", "dispatching"] } }
        : {}),
    };
    const doc = await this.owners.findOneAndUpdate(
      filter,
      { $set: { "active.phase": "releasing" } },
      { returnDocument: "after", includeResultMetadata: false },
    );
    if (!doc) throw new SpendConflictError();
    // Delete only this fenced owner's notes before making its slot reusable.
    await this.notes.deleteMany({
      ownerKey: key(claim.owner),
      operationId: claim.owner.id,
      fence: claim.fence,
    });
    await this.owners.updateOne(
      {
        _id: key(claim.owner),
        fence: claim.fence,
        "active.owner.id": claim.owner.id,
        "active.phase": "releasing",
      },
      { $set: { active: null } },
    );
  }
  async reconcile(limit: number) {
    const docs = await this.owners
      .find({ active: { $ne: null }, "active.expiresAt": { $lte: new Date() } })
      .sort({ "active.expiresAt": 1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .toArray();
    const journal = new RelayJournal(this.db);
    let released = 0,
      unresolved = 0;
    for (const doc of docs) {
      const claim = doc.active;
      if (!claim) continue;
      try {
        const chainId = Number(claim.owner.scope.split(":")[0]),
          known = await journal.read(
            `${chainId}:${claim.owner.sender.toLowerCase()}`,
            claim.owner.id,
          );
        if (known?.serializedTransaction) {
          if (known.phase === "confirmed" || known.phase === "reverted") {
            await this.release(claim, known.phase);
            released++;
          } else {
            if (claim.phase === "dispatching")
              await this.pinSigned(claim, claim.owner.id);
            unresolved++;
          }
          continue;
        }
        if (claim.phase === "signed" || claim.phase === "uncertain") {
          unresolved++;
          continue;
        }
        if (
          known &&
          !(
            known.phase === "reserved" &&
            known.expiresAt <= new Date() &&
            (await journal.abandonUnsigned(known))
          )
        ) {
          unresolved++;
          continue;
        }
        if (claim.phase === "releasing") {
          await this.notes.deleteMany({
            ownerKey: key(claim.owner),
            operationId: claim.owner.id,
            fence: claim.fence,
          });
          await this.owners.updateOne(
            { _id: doc._id, fence: claim.fence, "active.phase": "releasing" },
            { $set: { active: null } },
          );
        } else await this.release(claim, "unsigned-abandoned");
        released++;
      } catch {
        unresolved++;
      }
    }
    return { examined: docs.length, released, unresolved };
  }
}
