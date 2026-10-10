import "server-only";
import { createHash } from "node:crypto";
import type { Hex } from "viem";
import type { Context } from "../../context";
import type { OrdinarySponsor } from "../../lib/relayer";
import { RelayConflictError } from "../../lib/relayJournal";
import type { SponsorLedger } from "./ledger.service";
import { ledgerKey } from "./ledgerModel";
import { principalFromContext } from "./principals";
import {
  type WithdrawBatchInput,
  withdrawBatchInput,
} from "./sponsorship.schema";

type Batch = WithdrawBatchInput & { _id: string; user: string; digest: Hex };
export class WithdrawBatches {
  constructor(
    readonly ledger: SponsorLedger,
    readonly chainId: number,
  ) {}
  get records() {
    return this.ledger.options.db.collection<Batch>(
      "sponsorship_withdraw_batches",
    );
  }
  async admit(ctx: Context, value: unknown) {
    const input = withdrawBatchInput.parse(value),
      principal = principalFromContext(ctx);
    if (
      principal.kind !== "user" ||
      Number(input.pool.split(":")[0]) !== this.chainId
    )
      throw new RelayConflictError();
    const normalized = {
      ...input,
      recipient: input.recipient.toLowerCase() as Hex,
      nullifiers: [...input.nullifiers].sort(),
    };
    const digest =
      `0x${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}` as Hex;
    const _id = `${this.chainId}:${input.id}`;
    await this.records.updateOne(
      { _id },
      { $setOnInsert: { ...normalized, _id, user: principal.key, digest } },
      { upsert: true },
    );
    const record = await this.records.findOne({ _id });
    if (record?.user !== principal.key || record.digest !== digest)
      throw new RelayConflictError();
    return this.ledger.admit({
      chainId: this.chainId,
      actionId: `withdraw-batch:${input.id}`,
      kind: "withdraw-batch",
      principal,
      businessDigest: digest,
      maximumChildren: input.nullifiers.length,
    });
  }
  async binding(
    ctx: Context,
    id: string,
    input: { pool: string; recipient: string; nullifier: string },
  ): Promise<OrdinarySponsor> {
    const principal = principalFromContext(ctx),
      record = await this.records.findOne({ _id: `${this.chainId}:${id}` });
    if (
      principal.kind !== "user" ||
      record?.user !== principal.key ||
      record.pool !== input.pool ||
      record.recipient !== input.recipient.toLowerCase() ||
      !record.nullifiers.includes(input.nullifier.toLowerCase())
    )
      throw new RelayConflictError();
    return {
      kind: "withdraw-batch",
      principal,
      identity: {
        actionId: `withdraw-batch:${id}`,
        businessDigest: record.digest,
        childId: input.nullifier.toLowerCase(),
      },
      maximumChildren: record.nullifiers.length,
      closeParent: false,
    };
  }
  async finish(ctx: Context, id: string) {
    const principal = principalFromContext(ctx),
      record = await this.records.findOne({ _id: `${this.chainId}:${id}` });
    if (principal.kind !== "user" || record?.user !== principal.key)
      throw new RelayConflictError();
    const action = await this.ledger.readAction(
      this.chainId,
      `withdraw-batch:${id}`,
    );
    if (
      !action ||
      record.nullifiers.some(
        (n) => action.children[ledgerKey(n)]?.phase !== "settled",
      )
    )
      throw new RelayConflictError();
    await this.ledger.closeAction({
      chainId: this.chainId,
      actionId: action.intent.actionId,
      fence: action.fence,
    });
  }
}
