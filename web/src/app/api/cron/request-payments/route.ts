import { getServerEnv } from "../../../../env.server";
import { reconcileAllRelays } from "../../../../server/lib/durableRelayer";
import { relayerConfigured } from "../../../../server/lib/relayer";
import { reconcilePendingRequests } from "../../../../server/modules/requests/requestOperations";
import { reconcilePendingTransfers } from "../../../../server/modules/transfers/transferOperations";
import { SpendReservations } from "../../../../server/lib/spendReservations";
import { getDb } from "../../../../server/db/mongo";
export const dynamic = "force-dynamic";
let reconciliation: Promise<{
  status: string;
  relays: Awaited<ReturnType<typeof reconcileAllRelays>>;
  requests: Awaited<ReturnType<typeof reconcilePendingRequests>>;
  transfers: Awaited<ReturnType<typeof reconcilePendingTransfers>>;
  spends:Awaited<ReturnType<SpendReservations["reconcile"]>>;
}> | null = null;
export async function GET(request: Request) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!relayerConfigured()) return Response.json({ status: "unavailable" });
  try {
    reconciliation ??= (async () => {
      const relays = await reconcileAllRelays(20),
        requests = await reconcilePendingRequests({ limit: 20 }),
        transfers = await reconcilePendingTransfers({ limit: 20 }),
        spends=await new SpendReservations(await getDb()).reconcile(20);
      if (relays.examined || requests.examined)
        console.info(
          "[request-payments]",
          JSON.stringify({ relays, requests }),
        );
      return { status: "checked", relays, requests, transfers, spends };
    })().finally(() => {
      reconciliation = null;
    });
    return Response.json(await reconciliation);
  } catch {
    return Response.json(
      { error: "Reconciliation is temporarily unavailable." },
      { status: 503 },
    );
  }
}
