import "server-only";
import type { Db } from "mongodb";
import type { Hex } from "viem";
import { env } from "../../../env";
import { samePublicKeys } from "../../../features/privacyKeys/keyRing";
import type {
  AccountTicket,
  FundingCapture,
  PublicKeyPair,
  RegistryScope,
} from "../../../features/privacyKeys/types";
import { getDb } from "../../db/mongo";
import {
  PrivacyKeyConflictError,
  PrivacyKeysRepository,
} from "./privacyKeys.repository";

export class AccountSpendGate {
  readonly repo: PrivacyKeysRepository;
  constructor(
    db: Db,
    readonly registry: RegistryScope,
    readonly reader: (
      owner: Hex,
      username: string,
    ) => Promise<PublicKeyPair & { owner: Hex }>,
  ) {
    this.repo = new PrivacyKeysRepository(db);
  }
  private async ticket(
    owner: Hex,
    operationId: string,
    capture: FundingCapture,
  ): Promise<AccountTicket> {
    const doc = await this.repo.accounts.findOne({
      _id: `${owner.toLowerCase()}:${this.registry}`,
    });
    const ticket = doc?.tickets.find(
      (ticket) =>
        ticket.id === capture.accountTicketId &&
        ticket.operationId === operationId,
    );
    if (
      !ticket ||
      ticket.revision !== capture.keyRevision ||
      ticket.fundingGeneration !== capture.fundingGeneration
    )
      throw new PrivacyKeyConflictError(
        "The captured account operation changed.",
      );
    return ticket;
  }
  async admit(
    owner: Hex,
    operationId: string,
    participant: PublicKeyPair,
    capture: FundingCapture = {},
    newIntent = false,
  ): Promise<FundingCapture> {
    const state = await this.repo.get(owner, this.registry);
    if (!state) {
      if (capture.accountTicketId || (capture.fundingGeneration ?? 0) !== 0)
        throw new PrivacyKeyConflictError(
          "Captured key history is unavailable.",
        );
      return {};
    }
    if (state.pending || state.owner.toLowerCase() !== owner.toLowerCase())
      throw new PrivacyKeyConflictError("Privacy key rotation is pending.");
    const current = await this.reader(owner, state.username);
    if (
      current.owner.toLowerCase() !== owner.toLowerCase() ||
      !samePublicKeys(current, state.generations[state.activeGeneration])
    )
      throw new PrivacyKeyConflictError("Privacy keys need reconciliation.");
    if (
      !state.generations.some((generation) =>
        samePublicKeys(generation, participant),
      ) ||
      (newIntent &&
        !samePublicKeys(state.generations[state.activeGeneration], participant))
    )
      throw new PrivacyKeyConflictError(
        "The captured participant keys are unavailable.",
      );
    if (capture.accountTicketId) {
      await this.assert(owner, operationId, capture);
      return capture;
    }
    const fundingGeneration =
        capture.fundingGeneration ?? state.activeGeneration,
      revision = capture.keyRevision ?? state.revision;
    const ticket = await this.repo.acquireTicket({
      owner,
      registry: this.registry,
      revision,
      fundingGeneration,
      operationId,
      kind: "spend",
    });
    return {
      fundingGeneration,
      keyRevision: ticket.revision,
      accountTicketId: ticket.id,
    };
  }
  async assert(
    owner: Hex,
    operationId: string,
    capture: FundingCapture,
  ): Promise<void> {
    if (!capture.accountTicketId) {
      if (await this.repo.get(owner, this.registry))
        throw new PrivacyKeyConflictError(
          "Account operation admission is missing.",
        );
      return;
    }
    await this.repo.assertTicket(
      await this.ticket(owner, operationId, capture),
    );
  }
  async legacyCapture(
    owner: Hex,
    participant: PublicKeyPair,
  ): Promise<FundingCapture> {
    const state = await this.repo.get(owner, this.registry);
    if (!state) return {};
    const generation = state.generations.find((generation) =>
      samePublicKeys(generation, participant),
    );
    if (!generation)
      throw new PrivacyKeyConflictError(
        "The legacy operation keys are unavailable.",
      );
    return { fundingGeneration: generation.id };
  }
  async finish(
    owner: Hex,
    operationId: string,
    capture: FundingCapture,
    evidence: "terminal" | "unsigned-abandoned",
  ): Promise<void> {
    if (!capture.accountTicketId) return;
    const doc = await this.repo.accounts.findOne({
      _id: `${owner.toLowerCase()}:${this.registry}`,
    });
    if (!doc?.tickets.some((ticket) => ticket.id === capture.accountTicketId))
      return;
    await this.repo.releaseTicket(
      await this.ticket(owner, operationId, capture),
      evidence,
    );
  }
}
export async function accountSpendGate() {
  const registry =
    `${env.NEXT_PUBLIC_MONAD_CHAIN_ID}:${(env.NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS ?? "0x0000000000000000000000000000000000000000").toLowerCase()}` as RegistryScope;
  return new AccountSpendGate(
    await getDb(),
    registry,
    async (owner, username) => {
      const observed = await (await import("./registryEvidence")).readRegistry(
        owner,
        username,
      );
      return { ...observed.keys, owner: observed.owner };
    },
  );
}
