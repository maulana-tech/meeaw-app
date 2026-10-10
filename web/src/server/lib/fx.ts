import "server-only";
import { FX_CURRENCIES, snapshotFromRates } from "../../lib/fx";
import { createFxCache } from "../../lib/fxCache";

const endpoint = `https://api.frankfurter.dev/v2/rates?base=USD&quotes=${FX_CURRENCIES.filter((code) => code !== "USD").join(",")}`;
async function loadRates() {
  const response = await fetch(endpoint, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok || !response.body)
    throw new Error("Reference rates unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 64000) throw new Error("Reference response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return snapshotFromRates(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
export const referenceRates = createFxCache(loadRates);
