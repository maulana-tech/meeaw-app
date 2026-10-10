import { expect, it } from "vitest";
import {
  completeFaucet,
  pendingFaucetId,
} from "../src/features/sponsorship/pendingFaucet";

it("keeps the faucet request id across reload-style calls and isolates wallets", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
  const first = pendingFaucetId(storage, "alice", "pool");
  expect(pendingFaucetId(storage, "alice", "pool")).toBe(first);
  expect(pendingFaucetId(storage, "bob", "pool")).not.toBe(first);
  completeFaucet(storage, "alice", "pool", "stale-completion");
  expect(pendingFaucetId(storage, "alice", "pool")).toBe(first);
  completeFaucet(storage, "alice", "pool", first);
  expect(pendingFaucetId(storage, "alice", "pool")).not.toBe(first);
});
