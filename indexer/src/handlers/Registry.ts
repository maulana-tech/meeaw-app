import { indexer } from "envio";
import type { RegistryDailyStats, RegistryStats } from "envio";
import { dayKey, dayStart } from "./Pool";
import { poolScope, scopedId } from "./poolScope";

// Registry entities are scoped by chain and registry address, separately from
// the per-pool transaction histories.

const registryScope = (event: { chainId: number; srcAddress: string }) =>
  poolScope(event.chainId, event.srcAddress);

function emptyRegistryStats(id: string, timestamp: number): RegistryStats {
  return { id, accounts: 0, updatedAt: timestamp };
}

function emptyRegistryDay(registry: string, timestamp: number): RegistryDailyStats {
  return {
    id: scopedId(registry, dayKey(timestamp)),
    registry,
    dayStart: dayStart(timestamp),
    newAccounts: 0,
  };
}

indexer.onEvent(
  { contract: "Registry", event: "Registered" },
  async ({ event, context }) => {
    const registry = registryScope(event);
    const timestamp = event.block.timestamp;
    const username = event.params.username;
    context.Account.set({
      id: scopedId(registry, username),
      registry,
      username,
      owner: event.params.owner.toLowerCase(),
      notePubkey: event.params.notePubkey,
      viewPubkey: event.params.viewPubkey,
      registeredAt: timestamp,
      keyRotations: 0,
    });

    const stats =
      (await context.RegistryStats.get(registry)) ??
      emptyRegistryStats(registry, timestamp);
    context.RegistryStats.set({
      ...stats,
      accounts: stats.accounts + 1,
      updatedAt: timestamp,
    });
    const day = emptyRegistryDay(registry, timestamp);
    const today = (await context.RegistryDailyStats.get(day.id)) ?? day;
    context.RegistryDailyStats.set({ ...today, newAccounts: today.newAccounts + 1 });
  },
);

indexer.onEvent(
  { contract: "Registry", event: "PubkeysRotated" },
  async ({ event, context }) => {
    // The event only carries keccak256(username); find the account through
    // its owner, which the registry keeps one-to-one with a username.
    const registry = registryScope(event);
    const owner = event.params.owner.toLowerCase();
    const accounts = await context.Account.getWhere({ owner: { _eq: owner } });
    const account = accounts.find((a) => a.registry === registry);
    if (!account) {
      context.log.warn(`PubkeysRotated for unknown owner ${owner}`);
      return;
    }
    context.Account.set({
      ...account,
      notePubkey: event.params.notePubkey,
      viewPubkey: event.params.viewPubkey,
      keyRotations: account.keyRotations + 1,
    });
    context.KeyRotation.set({
      id: `${event.chainId}_${event.block.number}_${event.logIndex}`,
      account_id: account.id,
      notePubkey: event.params.notePubkey,
      viewPubkey: event.params.viewPubkey,
      blockNumber: event.block.number,
      timestamp: event.block.timestamp,
    });
  },
);
