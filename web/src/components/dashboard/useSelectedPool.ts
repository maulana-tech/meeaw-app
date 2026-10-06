"use client";

import { useSyncExternalStore } from "react";
import { ASSETS } from "../../lib/assets";
import {
  activePool,
  activePoolFor,
  type PoolDescriptor,
} from "../../lib/pools";

// Which asset's pool the dashboard shows. Only the symbol is remembered (a
// per-device preference, nothing secret); a symbol with no active pool falls
// back to the primary pool.
const KEY = "mawee:dashboard-asset";
const listeners = new Set<() => void>();

function read(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && activePoolFor(stored)) return stored;
  } catch {}
  return activePool().asset;
}

export function selectAsset(asset: string): void {
  try {
    localStorage.setItem(KEY, asset);
  } catch {}
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSelectedPool(): PoolDescriptor {
  const asset = useSyncExternalStore(subscribe, read, () => activePool().asset);
  return activePoolFor(asset) ?? activePool();
}

export const assetLabel = (pool: PoolDescriptor) => ASSETS[pool.asset].label;
