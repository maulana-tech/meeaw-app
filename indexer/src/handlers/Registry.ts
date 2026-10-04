import { indexer } from "envio";
import type { PoolStats } from "envio";
import { emptyDay, emptyStats } from "./Pool";

indexer.onEvent(
  { contract: "Registry", event: "Registered" },
  async ({ event, context }) => {
    const timestamp = event.block.timestamp;
    const username = event.params.username;
    context.Account.set({
      id: username,
      username,
      owner: event.params.owner.toLowerCase(),
      notePubkey: event.params.notePubkey,
      viewPubkey: event.params.viewPubkey,
      registeredAt: timestamp,
      keyRotations: 0,
    });

    const stats: PoolStats =
      (await context.PoolStats.get("global")) ?? emptyStats(timestamp);
    context.PoolStats.set({
      ...stats,
      accounts: stats.accounts + 1,
      updatedAt: timestamp,
    });
    const day = emptyDay(timestamp);
    const today = (await context.DailyStats.get(day.id)) ?? day;
    context.DailyStats.set({ ...today, newAccounts: today.newAccounts + 1 });
  },
);

indexer.onEvent(
  { contract: "Registry", event: "PubkeysRotated" },
  async ({ event, context }) => {
    // The event only carries keccak256(username); find the account through
    // its owner, which the registry keeps one-to-one with a username.
    const owner = event.params.owner.toLowerCase();
    const [account] = await context.Account.getWhere({ owner: { _eq: owner } });
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
