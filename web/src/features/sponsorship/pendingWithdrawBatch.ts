type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PendingBatch = { id: string; nullifiers: string[] };
export function pendingWithdrawBatch(
  storage: StoragePort,
  key: string,
  nullifiers: string[],
): PendingBatch {
  const raw = storage.getItem(key);
  if (raw) {
    const prior = JSON.parse(raw) as PendingBatch;
    if (
      typeof prior.id !== "string" ||
      !Array.isArray(prior.nullifiers) ||
      !nullifiers.every((n) => prior.nullifiers.includes(n))
    )
      throw new Error(
        "Finish the previous cash-out before adding more payments.",
      );
    return prior;
  }
  const next = { id: crypto.randomUUID(), nullifiers: [...nullifiers].sort() };
  storage.setItem(key, JSON.stringify(next));
  return next;
}
