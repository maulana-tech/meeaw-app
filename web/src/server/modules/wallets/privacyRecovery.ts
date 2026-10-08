import "server-only";
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { Hex } from "viem";
import type {
  AccountTicket,
  RegistryScope,
} from "../../../features/privacyKeys/types";
import { getDb, type UserDoc } from "../../db/mongo";
import {
  PrivacyKeyConflictError,
  PrivacyKeysRepository,
} from "../privacyKeys/privacyKeys.repository";
import { configuredRegistryScope } from "../privacyKeys/registryEvidence";
import { WalletConflictError } from "./wallets.errors";
import type {
  RotateEscrowInput,
  RotateEscrowOutput,
  SaveEscrowInput,
} from "./wallets.schema";

type ChangeDoc = {
  _id: string;
  owner: Hex;
  registry: RegistryScope;
  privyUserId: string;
  operationId: string;
  expectedRevision: number;
  digest: string;
  escrow?: SaveEscrowInput;
  ticket?: AccountTicket;
  phase: "prepared" | "applied" | "conflict";
  released: boolean;
  createdAt: Date;
};
type EscrowWriter = (
  user: string,
  input: RotateEscrowInput,
) => Promise<RotateEscrowOutput>;
function escrowDigest(escrow: SaveEscrowInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        escrow.encryptedMasterHex.toLowerCase(),
        escrow.masterSaltHex.toLowerCase(),
        escrow.kdfParams.m,
        escrow.kdfParams.t,
        escrow.kdfParams.p,
      ]),
    )
    .digest("hex");
}
function documentDigest(doc: UserDoc): string | null {
  return doc.encryptedMaster && doc.masterSalt && doc.kdfParams
    ? escrowDigest({
        encryptedMasterHex: Buffer.from(doc.encryptedMaster.buffer).toString(
          "hex",
        ),
        masterSaltHex: Buffer.from(doc.masterSalt.buffer).toString("hex"),
        kdfParams: doc.kdfParams,
      })
    : null;
}
async function assertSetupAllowed(
  db: Db,
  registry: RegistryScope,
  user: string,
): Promise<void> {
  const current = await db
    .collection<UserDoc>("users")
    .findOne({ privyUserId: user });
  if (
    current &&
    (await new PrivacyKeysRepository(db).get(current._id, registry))
  )
    throw new WalletConflictError(
      "Retained privacy keys cannot be replaced during recovery setup. Unlock with your existing recovery.",
    );
}

export function createEscrowRecoveryGate(
  db: Db,
  registry: RegistryScope,
  write: EscrowWriter,
) {
  const users = db.collection<UserDoc>("users"),
    changes = db.collection<ChangeDoc>("privacy_recovery_changes"),
    repo = new PrivacyKeysRepository(db);
  const finish = async (change: ChangeDoc, user: string) => {
    const current = await users.findOne({ privyUserId: user });
    if (
      !current ||
      current._id.toLowerCase() !== change.owner ||
      current.escrowRevision !== change.expectedRevision + 1 ||
      documentDigest(current) !== change.digest
    )
      return false;
    await changes.updateOne(
      { _id: change._id },
      { $set: { phase: "applied" }, $unset: { escrow: "" } },
    );
    if (change.ticket) {
      const account = await repo.accounts.findOne({
        _id: `${change.owner}:${registry}`,
      });
      if (account?.tickets.some((ticket) => ticket.id === change.ticket?.id))
        await repo.releaseTicket(change.ticket, "terminal");
    }
    await changes.updateOne({ _id: change._id }, { $set: { released: true } });
    return true;
  };
  const apply = async (
    change: ChangeDoc,
    user: string,
  ): Promise<RotateEscrowOutput> => {
    if (change.phase === "conflict")
      throw new WalletConflictError(
        "This recovery change was not admitted. Start again with your current PIN.",
      );
    if (
      (await finish(change, user)) ||
      (change.phase === "applied" && change.released)
    )
      return { revision: change.expectedRevision + 1 };
    const current = await users.findOne({ privyUserId: user });
    if (
      !current ||
      current._id.toLowerCase() !== change.owner ||
      !change.escrow
    )
      throw new WalletConflictError(
        "Recovery change belongs to another wallet.",
      );
    const state = await repo.get(change.owner, registry);
    if (!state)
      throw new WalletConflictError("Privacy key history is unavailable.");
    let ticket = change.ticket;
    try {
      ticket ??= await repo.acquireTicket({
        owner: change.owner,
        registry,
        revision: state.revision,
        fundingGeneration: state.activeGeneration,
        operationId: change.operationId,
        kind: "recovery-change",
      });
    } catch (error) {
      if (error instanceof PrivacyKeyConflictError) {
        await changes.updateOne(
          { _id: change._id },
          {
            $set: { phase: "conflict", released: true },
            $unset: { escrow: "" },
          },
        );
        throw new WalletConflictError(
          "Privacy key rotation or another account operation is pending.",
        );
      }
      throw error;
    }
    await changes.updateOne({ _id: change._id }, { $set: { ticket } });
    change = { ...change, ticket };
    await repo.assertTicket(ticket);
    try {
      await write(user, {
        expectedRevision: change.expectedRevision,
        escrow: change.escrow as SaveEscrowInput,
      });
    } catch (error) {
      if (!(await finish(change, user))) throw error;
      return { revision: change.expectedRevision + 1 };
    }
    if (!(await finish(change, user)))
      throw new WalletConflictError(
        "Recovery change is awaiting exact escrow confirmation.",
      );
    return { revision: change.expectedRevision + 1 };
  };
  return {
    assertSetupAllowed: (user: string) =>
      assertSetupAllowed(db, registry, user),
    async change(user: string, input: RotateEscrowInput) {
      const current = await users.findOne({ privyUserId: user });
      const owner = current?._id.toLowerCase() as Hex | undefined;
      const state = owner ? await repo.get(owner, registry) : null;
      if (!state || !owner) return write(user, input);
      if (state.pending)
        throw new WalletConflictError(
          "Privacy key rotation or another account operation is pending.",
        );
      const digest = escrowDigest(input.escrow),
        operationId = `pin:${input.expectedRevision}:${digest}`,
        _id = `${owner}:${registry}:${operationId}`;
      const existing = await changes.findOne({ _id });
      if (existing) return apply(existing, user);
      if ((current?.escrowRevision ?? 1) !== input.expectedRevision)
        return write(user, input);
      const change: ChangeDoc = {
        _id,
        owner,
        registry,
        privyUserId: user,
        operationId,
        expectedRevision: input.expectedRevision,
        digest,
        escrow: input.escrow,
        phase: "prepared",
        released: false,
        createdAt: new Date(),
      };
      await changes.updateOne(
        { _id },
        { $setOnInsert: change },
        { upsert: true },
      );
      return apply((await changes.findOne({ _id })) as ChangeDoc, user);
    },
    async recover(user: string) {
      const current = await users.findOne({ privyUserId: user });
      if (!current) return;
      const pending = await changes.findOne(
        { owner: current._id.toLowerCase() as Hex, registry, released: false },
        { sort: { createdAt: 1 } },
      );
      if (pending) {
        try {
          await apply(pending, user);
        } catch (error) {
          if (!(error instanceof WalletConflictError)) throw error;
        }
      }
    },
  };
}
export async function withFencedEscrowChange(
  user: string,
  input: RotateEscrowInput,
  write: EscrowWriter,
) {
  return createEscrowRecoveryGate(
    await getDb(),
    configuredRegistryScope,
    write,
  ).change(user, input);
}
export async function assertRecoverySetupAllowed(user: string): Promise<void> {
  return assertSetupAllowed(await getDb(), configuredRegistryScope, user);
}
export async function recoverFencedEscrowChange(
  user: string,
  write: EscrowWriter,
) {
  return createEscrowRecoveryGate(
    await getDb(),
    configuredRegistryScope,
    write,
  ).recover(user);
}
