import { getServerEnv } from "../../../../env.server";
import { getDb } from "../../../../server/db/mongo";
import { reconcileAllRelays } from "../../../../server/lib/durableRelayer";
import { relayerConfigured } from "../../../../server/lib/relayer";
import { SpendReservations } from "../../../../server/lib/spendReservations";
import { reconcilePendingPrivacyRotations } from "../../../../server/modules/privacyKeys/rotationOperations";
import { reconcilePendingRequests } from "../../../../server/modules/requests/requestOperations";
import { reconcilePendingTransfers } from "../../../../server/modules/transfers/transferOperations";
export const dynamic = "force-dynamic";
let reconciliation: Promise<{
  status: string;
  relays: Awaited<ReturnType<typeof reconcileAllRelays>>;
  requests: Awaited<ReturnType<typeof reconcilePendingRequests>>;
  transfers: Awaited<ReturnType<typeof reconcilePendingTransfers>>;
  spends: Awaited<ReturnType<SpendReservations["reconcile"]>>;
  rotations: Awaited<ReturnType<typeof reconcilePendingPrivacyRotations>>;
}> | null = null;
export async function GET(request: Request) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    if (!relayerConfigured())
      return Response.json({
        status: "unavailable",
        rotations: await reconcilePendingPrivacyRotations({ limit: 20 }),
      });
    reconciliation ??= (async () => {
      const relays = await reconcileAllRelays(20),
        requests = await reconcilePendingRequests({ limit: 20 }),
        transfers = await reconcilePendingTransfers({ limit: 20 }),
        spends = await new SpendReservations(await getDb()).reconcile(20),
        rotations = await reconcilePendingPrivacyRotations({ limit: 20 });
      if (relays.examined || requests.examined)
        console.info(
          "[request-payments]",
          JSON.stringify({ relays, requests }),
        );
      return {
        status: "checked",
        relays,
        requests,
        transfers,
        spends,
        rotations,
      };
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
