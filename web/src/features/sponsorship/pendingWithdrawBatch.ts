type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PendingBatch = {
  id: string;
  nullifiers: string[];
  state?: "new" | "accepted" | "uncertain";
};
export function pendingWithdrawBatch(
  storage: StoragePort,
  key: string,
  nullifiers: string[],
): PendingBatch {
  if (
    !nullifiers.length ||
    nullifiers.length > 16 ||
    new Set(nullifiers).size !== nullifiers.length
  )
    throw new Error("Cash out at most 16 payments at a time.");
  let raw = storage.getItem(key);
  if (
    raw &&
    Array.isArray(JSON.parse(raw).nullifiers) &&
    JSON.parse(raw).nullifiers.length > 16
  ) {
    storage.removeItem(key);
    raw = null;
  }
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
  const next: PendingBatch = {
    id: crypto.randomUUID(),
    nullifiers: [...nullifiers].sort(),
    state: "new",
  };
  storage.setItem(key, JSON.stringify(next));
  return next;
}
export function recordBatchAdmission(
  storage: StoragePort,
  key: string,
  pending: PendingBatch,
  error?: unknown,
) {
  if (storage.getItem(key) !== JSON.stringify(pending)) return;
  const data = (
    error as
      | { data?: { code?: string; sponsorshipReason?: string } }
      | undefined
  )?.data;
  const rejected =
    data?.code === "BAD_REQUEST" ||
    (data?.sponsorshipReason && data.sponsorshipReason !== "rpc");
  if (error && pending.state === "new" && rejected) storage.removeItem(key);
  else
    storage.setItem(
      key,
      JSON.stringify({ ...pending, state: error ? "uncertain" : "accepted" }),
    );
}
