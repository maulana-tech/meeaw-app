import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  enabled: true,
  events: [] as string[],
  hold: null as Promise<void> | null,
}));
const result = { examined: 0, confirmed: 0, unresolved: 0 };
vi.mock("../src/env.server", () => ({
  getServerEnv: () => ({ CRON_SECRET: "test-secret" }),
}));
vi.mock("../src/server/db/mongo", () => ({ getDb: async () => ({}) }));
vi.mock("../src/server/lib/relayer", () => ({
  relayerConfigured: () => state.enabled,
}));
vi.mock("../src/server/modules/sponsorship/reconcile", () => ({
  reconcileSponsorship: async () => {
    state.events.push("budget-recovery");
    await state.hold;
    return { examined: 0, settled: 0, unresolved: 0, baseline: "complete" };
  },
}));
vi.mock("../src/server/lib/durableRelayer", () => ({
  reconcileAllRelays: async () => {
    state.events.push("relays");
    return result;
  },
}));
vi.mock("../src/server/modules/requests/requestOperations", () => ({
  reconcilePendingRequests: async () => {
    state.events.push("requests");
    return result;
  },
}));
vi.mock("../src/server/modules/transfers/transferOperations", () => ({
  reconcilePendingTransfers: async () => {
    state.events.push("transfers");
    return result;
  },
}));
vi.mock("../src/server/modules/privacyKeys/rotationOperations", () => ({
  reconcilePendingPrivacyRotations: async () => {
    state.events.push("rotations");
    return result;
  },
}));
vi.mock("../src/server/lib/spendReservations", () => ({
  SpendReservations: class {
    async reconcile() {
      return result;
    }
  },
}));

import { GET } from "../src/app/api/cron/request-payments/route";

beforeEach(() => {
  state.enabled = true;
  state.events = [];
  state.hold = null;
});
it("recovers budget and baseline before resuming business operations", async () => {
  const response = await GET(
    new Request("http://localhost/api/cron/request-payments", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  expect(response.status).toBe(200);
  expect(state.events[0]).toBe("budget-recovery");
  expect(state.events).toContain("requests");
});
it("still recovers existing fees when the relayer key is missing", async () => {
  state.enabled = false;
  const response = await GET(
    new Request("http://localhost/api/cron/request-payments", {
      headers: { authorization: "Bearer test-secret" },
    }),
  );
  expect(response.status).toBe(200);
  expect(state.events).toEqual(["budget-recovery", "rotations"]);
});
it("requires cron authentication before touching accounting", async () => {
  expect(
    (await GET(new Request("http://localhost/api/cron/request-payments")))
      .status,
  ).toBe(401);
  expect(state.events).toHaveLength(0);
});
it("coalesces concurrent cron requests including their baseline work", async () => {
  let release: () => void = () => {};
  state.hold = new Promise((resolve) => {
    release = resolve;
  });
  const request = () =>
    new Request("http://localhost/api/cron/request-payments", {
      headers: { authorization: "Bearer test-secret" },
    });
  const first = GET(request()),
    second = GET(request());
  release();
  await Promise.all([first, second]);
  expect(state.events.filter((e) => e === "budget-recovery")).toHaveLength(1);
});
