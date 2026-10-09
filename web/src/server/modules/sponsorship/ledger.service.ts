import "server-only";
import type { Db } from "mongodb";
import type { Hex } from "viem";
import type {
  ActionIntent,
  ActionTicket,
  ChildTicket,
  FeeEvidence,
  FrozenTx,
  PolicyState,
  Principal,
  QuotaStatus,
} from "../../../features/sponsorship/types";
import {
  type SponsorClock,
  SponsorLedgerRepository,
} from "./ledger.repository";
import type { SponsorCommand } from "./ledgerModel";
import { ledgerKey } from "./ledgerModel";

export type { SponsorClock };
export class SponsorLedger {
  readonly repo: SponsorLedgerRepository;
  constructor(
    readonly options: {
      db: Db;
      policy: () => PolicyState;
      clock?: SponsorClock;
      chainId?: number;
    },
  ) {
    this.repo = new SponsorLedgerRepository(
      options.db,
      options.policy,
      options.clock,
    );
  }
  async admit(intent: ActionIntent): Promise<ActionTicket> {
    return (await this.repo.mutate(intent.chainId, {
      kind: "admit",
      intent,
    })) as ActionTicket;
  }
  async importLegacy(
    command: Extract<SponsorCommand, { kind: "import" }>,
  ): Promise<ChildTicket> {
    return (await this.repo.mutate(
      command.intent.chainId,
      command,
    )) as ChildTicket;
  }
  async baseline(
    chainId: number,
    expectedCursor: string | null,
    cursor: string | null,
    complete: boolean,
  ) {
    await this.repo.mutate(chainId, {
      kind: "baseline",
      expectedCursor,
      cursor,
      complete,
    });
  }
  async recoveryCursor(chainId: number, cursor: string | null) {
    await this.repo.mutate(chainId, { kind: "recovery-cursor", cursor });
  }
  async readAction(chainId: number, actionId: string) {
    const doc = await this.repo.snapshot(chainId);
    return (
      doc.actions[ledgerKey(actionId)] ??
      (await this.repo.archives.findOne({ _id: `${chainId}:${actionId}` }))
        ?.action ??
      null
    );
  }
  async findOrdinaryAction(chainId: number, kind: string, businessDigest: Hex) {
    const doc = await this.repo.snapshot(chainId);
    return (
      Object.values(doc.actions).find(
        (a) =>
          !a.legacy &&
          (a.phase === "active" || a.phase === "paused") &&
          a.intent.kind === kind &&
          a.intent.businessDigest === businessDigest,
      ) ?? null
    );
  }
  async allocate(
    ticket: ActionTicket,
    childId: string,
    digest: Hex,
    tx: FrozenTx,
  ): Promise<ChildTicket> {
    return (await this.repo.mutate(ticket.chainId, {
      kind: "allocate",
      ticket,
      childId,
      digest,
      tx,
    })) as ChildTicket;
  }
  async enterSigning(ticket: ChildTicket, walletFence: number) {
    await this.repo.mutate(ticket.chainId, {
      kind: "signing",
      ticket,
      walletFence,
    });
  }
  async pinSigned(ticket: ChildTicket, hash: Hex) {
    await this.repo.mutate(ticket.chainId, { kind: "pin", ticket, hash });
  }
  async assertBroadcast(ticket: ChildTicket, hash: Hex) {
    await this.repo.mutate(ticket.chainId, { kind: "broadcast", ticket, hash });
  }
  async settleChild(ticket: ChildTicket, evidence: FeeEvidence) {
    await this.repo.mutate(ticket.chainId, {
      kind: "settle",
      ticket,
      evidence,
    });
  }
  async releaseUnsigned(ticket: ChildTicket, retiredWalletFence: number) {
    await this.repo.mutate(ticket.chainId, {
      kind: "release",
      ticket,
      retiredWalletFence,
    });
  }
  async retireUnpublished(
    ticket: ChildTicket,
    retiredWalletFence: number,
    hash: Hex,
  ) {
    await this.repo.mutate(ticket.chainId, {
      kind: "retire",
      ticket,
      retiredWalletFence,
      hash,
    });
  }
  async closeAction(ticket: ActionTicket) {
    await this.repo.mutate(ticket.chainId, { kind: "close", ticket });
  }
  async cancelUnsigned(ticket: ActionTicket) {
    await this.repo.mutate(ticket.chainId, { kind: "cancel", ticket });
  }
  async pauseAction(ticket: ActionTicket) {
    await this.repo.mutate(ticket.chainId, { kind: "pause", ticket });
  }
  async resumeAction(ticket: ActionTicket) {
    await this.repo.mutate(ticket.chainId, { kind: "resume", ticket });
  }
  async status(principal: Principal): Promise<QuotaStatus> {
    return (await this.repo.mutate(this.options.chainId ?? 143, {
      kind: "status",
      principal,
    })) as QuotaStatus;
  }
}
