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
    const url = new URL("/api/cron/request-payments", baseUrl);
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
            if (
              response.statusCode !== 200 ||
              !["checked", "unavailable"].includes(result.status)
            ) {
              throw new Error(
                `Payment reconciliation failed (HTTP ${response.statusCode}).`,
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

let lastResult = "";
while (!stopped) {
  const startedAt = Date.now();
  try {
    const result = await sync();
    const summary = JSON.stringify(result);
    if (summary !== lastResult) {
      console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
      lastResult = summary;
    }
  } catch (error) {
    if (stopped) break;
    console.error(
      error instanceof Error ? error.message : "Payment reconciliation failed.",
    );
  }
  try {
    await delay(Math.max(1000, 5000 - (Date.now() - startedAt)), undefined, {
      signal: shutdown.signal,
    });
  } catch {
    break;
  }
}
