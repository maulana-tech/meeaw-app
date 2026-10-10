"use client";
import { parseFxSnapshot } from "./fx";
import { createFxCache } from "./fxCache";

const cache = createFxCache(async () => {
  const response = await fetch("/api/fx", {
    credentials: "omit",
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error("Reference rates unavailable");
  return parseFxSnapshot(await response.json());
});
export const readReferenceRates = () => cache.read();
