import { FX_CACHE_TTL_MS } from "../../../lib/fx";
import { referenceRates } from "../../../server/lib/fx";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (new URL(request.url).search)
    return Response.json(
      { error: "This endpoint does not accept parameters." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const snapshot = await referenceRates.read();
    const remaining = Math.max(
      0,
      Math.floor(
        (Date.parse(snapshot.fetchedAt) + FX_CACHE_TTL_MS - Date.now()) / 1000,
      ),
    );
    return Response.json(snapshot, {
      headers: {
        "Cache-Control":
          snapshot.stale || remaining === 0
            ? "no-store"
            : `public, max-age=${Math.min(300, remaining)}, s-maxage=${remaining}`,
      },
    });
  } catch {
    return Response.json(
      { error: "Reference rates unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
