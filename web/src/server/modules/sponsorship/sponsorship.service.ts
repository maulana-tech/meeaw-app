import "server-only";
import { getServerEnv } from "../../../env.server";
import { chain } from "../../../lib/chain";
import type { Context } from "../../context";
import { getDb } from "../../db/mongo";
import { relayerConfigured } from "../../lib/relayer";
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
  const status = await (await sponsorshipLedger()).status(
    principalFromContext(ctx),
  );
  return relayerConfigured()
    ? status
    : {
        ...status,
        configured: false,
        available: false,
        reason: "configuration" as const,
      };
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
  await ledger.cancelUnsigned({
    chainId: chain.id,
    actionId,
    fence: action.fence,
  });
}
