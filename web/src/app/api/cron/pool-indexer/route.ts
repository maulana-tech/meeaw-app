import { getServerEnv } from "../../../../env.server";
import { syncAllPoolIndexes } from "../../../../server/modules/deposits/deposits.service";
import { reconcileInvoices } from "../../../../server/modules/invoices/invoices.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await syncAllPoolIndexes();
  const invoices = await reconcileInvoices().catch(() => ({
    checked: 0,
    paid: 0,
    unavailable: 1,
  }));
  const response = { ...result, invoices };
  console.info("[pool-indexer]", JSON.stringify(response));
  return Response.json(response, {
    status:
      result.status === "degraded" || invoices.unavailable > 0 ? 503 : 200,
  });
}
