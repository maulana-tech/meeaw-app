type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function pendingActionId(storage: StoragePort, key: string) {
  const existing = storage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  storage.setItem(key, id);
  return id;
}
export function completePendingAction(
  storage: StoragePort,
  key: string,
  id: string,
) {
  if (storage.getItem(key) === id) storage.removeItem(key);
}
export function canonicalRelayRevert(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("data" in error)) return false;
  const data = error.data;
  if (!data || typeof data !== "object" || !("relayOutcome" in data))
    return false;
  const result = data.relayOutcome;
  return Boolean(
    result &&
      typeof result === "object" &&
      "state" in result &&
      result.state === "reverted" &&
      "txHash" in result &&
      typeof result.txHash === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(result.txHash),
  );
}
