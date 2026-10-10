import "server-only";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getServerEnv } from "../../../env.server";
import { chain, rpcUrl } from "../../../lib/chain";
import type { Context } from "../../context";
import { getDb } from "../../db/mongo";
import { RelayConflictError } from "../../lib/relayJournal";
import { SponsorLedger } from "./ledger.service";
import { loadSponsorPolicy } from "./policy";
import { principalFromContext } from "./principals";
import { WithdrawBatches } from "./withdrawBatches";
export async function sponsorshipLedger() {
  return new SponsorLedger({
    db: await getDb(),
    policy: () => loadSponsorPolicy(getServerEnv()),
    chainId: chain.id,
  });
}
export async function sponsorshipStatus(ctx: Context) {
  const ledger = await sponsorshipLedger(),
    status = await ledger.status(principalFromContext(ctx)),
    env = getServerEnv();
  if (!env.RELAYER_PRIVATE_KEY)
    return {
      ...status,
      configured: false,
      available: false,
      reason: "configuration" as const,
    };
  if (!status.available) return status;
  try {
    const policy = loadSponsorPolicy(env);
    if (!policy.ready)
      return { ...status, available: false, reason: "configuration" as const };
    const account = privateKeyToAccount(
        env.RELAYER_PRIVATE_KEY as `0x${string}`,
      ),
      snapshot = await ledger.repo.snapshot(chain.id);
    const held = Object.values(snapshot.actions)
      .flatMap((a) => Object.values(a.children))
      .filter(
        (c) =>
          c.tx.from.toLowerCase() === account.address.toLowerCase() &&
          !["settled", "abandoned"].includes(c.phase),
      )
      .reduce((sum, c) => sum + BigInt(c.maximumWei), 0n);
    const balance = await createPublicClient({
      chain,
      transport: http(env.RELAYER_RPC_URL ?? rpcUrl),
    }).getBalance({ address: account.address });
    return balance <= policy.policy.balanceFloorWei + held
      ? { ...status, available: false, reason: "balance" as const }
      : status;
  } catch {
    return { ...status, available: false, reason: "rpc" as const };
  }
}
export async function withdrawBatches() {
  return new WithdrawBatches(await sponsorshipLedger(), chain.id);
}
export async function cancelSponsorship(ctx: Context, actionId: string) {
  const ledger = await sponsorshipLedger(),
    principal = principalFromContext(ctx),
    action = await ledger.readAction(chain.id, actionId);
  if (
    principal.kind !== "user" ||
    action?.intent.principal.kind !== principal.kind ||
    action.intent.principal.key !== principal.key
  )
    throw new RelayConflictError();
  if (action.intent.kind === "send" || action.intent.kind === "request-pay") {
    const { OperationSponsorship } = await import("./operationAdapters");
    const { accountSpendGate } = await import("../privacyKeys/spendGate");
    const kind = action.intent.kind === "send" ? "transfer" : "request";
    const db = ledger.options.db;
    const doc =
      kind === "transfer"
        ? await db
            .collection("private_transfers")
            .findOne({ "operation.sponsorshipAction.actionId": actionId })
        : await db
            .collection("payment_requests")
            .findOne({ "reservation.sponsorshipAction.actionId": actionId });
    if (!doc?.operationId) throw new RelayConflictError();
    await new OperationSponsorship(ledger).abandon(
      kind,
      doc.operationId,
      principal.key,
      async (owner, spendId, capture) => {
        await (await accountSpendGate()).finish(
          owner,
          spendId,
          capture,
          "unsigned-abandoned",
        );
      },
    );
    return;
  }
  await ledger.cancelUnsigned({
    chainId: chain.id,
    actionId,
    fence: action.fence,
  });
}
