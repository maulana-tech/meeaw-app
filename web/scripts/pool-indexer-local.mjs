import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { setTimeout as delay } from "node:timers/promises";

const baseUrl = process.env.LOCAL_APP_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) throw new Error("CRON_SECRET must be set in .env.local.");

let stopped = false;
const shutdown = new AbortController();
function sync() {
  return new Promise((resolve, reject) => {
    const url = new URL("/api/cron/pool-indexer", baseUrl);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request(
      url,
      {
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.any([
          shutdown.signal,
          AbortSignal.timeout(10 * 60_000),
        ]),
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("error", reject);
        response.on("end", () => {
          try {
            const result = JSON.parse(body);
            if (response.statusCode !== 200 || !Array.isArray(result.pools)) {
              throw new Error(
                `Pool sync failed (HTTP ${response.statusCode}).`,
              );
            }
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopped = true;
    shutdown.abort();
  });
}

while (!stopped) {
  const startedAt = Date.now();
  let catchUp = false;
  try {
    const result = await sync();
    catchUp = result.pools.some(
      (pool) => pool.status === "synced" && pool.toBlock < pool.latestBlock,
    );
    console.log(
      JSON.stringify({
        at: new Date().toISOString(),
        status: result.status,
        pools: result.pools.map((pool) => ({
          pool: pool.pool,
          status: pool.status,
          fromBlock: pool.fromBlock,
          toBlock: pool.toBlock,
          latestBlock: pool.latestBlock,
          remainingBlocks:
            pool.status === "synced"
              ? Math.max(0, pool.latestBlock - pool.toBlock)
              : null,
          durationMs: pool.durationMs,
        })),
      }),
    );
  } catch (error) {
    if (stopped) break;
    console.error(error instanceof Error ? error.message : "Pool sync failed.");
  }
  const waitMs = catchUp
    ? 1_000
    : Math.max(1_000, 60_000 - (Date.now() - startedAt));
  try {
    await delay(waitMs, undefined, { signal: shutdown.signal });
  } catch {
    break;
  }
}
