import { FX_CACHE_TTL_MS, type FxSnapshot, parseFxSnapshot } from "./fx";

export function createFxCache(
  load: () => Promise<FxSnapshot>,
  clock = Date.now,
) {
  let cached: FxSnapshot | null = null;
  let retryAt = 0;
  let pending: Promise<FxSnapshot> | null = null;
  function fallback(): FxSnapshot {
    if (cached) {
      try {
        return { ...parseFxSnapshot(cached, clock()), stale: true };
      } catch {
        /* Expired references cannot be reused. */
      }
    }
    throw new Error("Reference rates unavailable");
  }
  return {
    async read(): Promise<FxSnapshot> {
      if (
        cached &&
        !cached.stale &&
        clock() - Date.parse(cached.fetchedAt) < FX_CACHE_TTL_MS
      ) {
        try {
          return parseFxSnapshot(cached, clock());
        } catch {
          cached = null;
        }
      }
      if (pending) return pending;
      if (clock() < retryAt) return fallback();
      pending = (async () => {
        try {
          const result = parseFxSnapshot(await load(), clock());
          const stale =
            result.stale ||
            clock() - Date.parse(result.fetchedAt) >= FX_CACHE_TTL_MS;
          cached = { ...result, stale };
          retryAt = stale ? clock() + 30000 : 0;
          return cached;
        } catch {
          retryAt = clock() + 30000;
          return fallback();
        } finally {
          pending = null;
        }
      })();
      return pending;
    },
  };
}
