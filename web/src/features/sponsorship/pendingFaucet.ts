type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const keyFor = (wallet: string, pool: string) =>
  `mawee:faucet:${wallet.toLowerCase()}:${pool}`;
export function pendingFaucetId(
  storage: StoragePort,
  wallet: string,
  pool: string,
) {
  const key = keyFor(wallet, pool),
    prior = storage.getItem(key);
  if (prior) return prior;
  const id = crypto.randomUUID();
  storage.setItem(key, id);
  return id;
}
export function completeFaucet(
  storage: StoragePort,
  wallet: string,
  pool: string,
  id: string,
) {
  const key = keyFor(wallet, pool);
  if (storage.getItem(key) === id) storage.removeItem(key);
}
