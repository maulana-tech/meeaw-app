import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  secret: "test-cron-secret",
  configured: true,
  relays: { examined: 0, confirmed: 0, unresolved: 0 },
  requests: { examined: 0, confirmed: 0, unresolved: 0 },
  transfers: { examined: 0, confirmed: 0, unresolved: 0 },
  spends: { examined: 0, released: 0, unresolved: 0 },
  rotations: { examined: 0, confirmed: 0, pending: 0, failed: 0 },
}));

vi.mock("../src/env.server", () => ({
  getServerEnv: () => ({ CRON_SECRET: deps.secret }),
}));
vi.mock("../src/server/lib/relayer", () => ({
  relayerConfigured: () => deps.configured,
}));
vi.mock("../src/server/lib/durableRelayer", () => ({
  reconcileAllRelays: vi.fn(async (limit: number) => {
    expect(limit).toBe(20);
    return deps.relays;
  }),
}));
vi.mock("../src/server/modules/requests/requestOperations", () => ({
  reconcilePendingRequests: vi.fn(async ({ limit }: { limit: number }) => {
    expect(limit).toBe(20);
    return deps.requests;
  }),
}));
vi.mock("../src/server/modules/privacyKeys/rotationOperations", () => ({
  reconcilePendingPrivacyRotations: vi.fn(
    async ({ limit }: { limit: number }) => {
      expect(limit).toBe(20);
      return deps.rotations;
    },
  ),
}));

import { GET } from "../src/app/api/cron/request-payments/route";

vi.mock("../src/server/modules/transfers/transferOperations", () => ({
  reconcilePendingTransfers: vi.fn(async () => deps.transfers),
}));
vi.mock("../src/server/db/mongo", () => ({ getDb: async () => ({}) }));
vi.mock("../src/server/lib/spendReservations", () => ({
  SpendReservations: class {
    async reconcile() {
      return deps.spends;
    }
  },
}));

import { reconcileAllRelays } from "../src/server/lib/durableRelayer";
import { reconcilePendingPrivacyRotations } from "../src/server/modules/privacyKeys/rotationOperations";
import { reconcilePendingRequests } from "../src/server/modules/requests/requestOperations";

describe("request payment reconciliation route", () => {
  beforeEach(() => {
    deps.secret = "test-cron-secret";
    deps.configured = true;
    deps.relays = { examined: 0, confirmed: 0, unresolved: 0 };
    deps.requests = { examined: 0, confirmed: 0, unresolved: 0 };
    vi.clearAllMocks();
  });

  it("rejects missing or incorrect cron credentials without running reconciliation", async () => {
    const missing = await GET(
      new Request("http://localhost/api/cron/request-payments"),
    );
    const wrong = await GET(
      new Request("http://localhost/api/cron/request-payments", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(reconcileAllRelays).not.toHaveBeenCalled();
    expect(reconcilePendingRequests).not.toHaveBeenCalled();
    expect(reconcilePendingPrivacyRotations).not.toHaveBeenCalled();
  });

  it("checks relays and at most twenty request operations per run", async () => {
    deps.relays = { examined: 2, confirmed: 1, unresolved: 1 };
    deps.requests = { examined: 3, confirmed: 2, unresolved: 1 };
    const response = await GET(
      new Request("http://localhost/api/cron/request-payments", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "checked",
      relays: deps.relays,
      requests: deps.requests,
      transfers: deps.transfers,
      spends: deps.spends,
      rotations: deps.rotations,
    });
    expect(reconcileAllRelays).toHaveBeenCalledOnce();
    expect(reconcilePendingRequests).toHaveBeenCalledOnce();
  });

  it("checks wallet rotations while relayed payment reconciliation is unavailable", async () => {
    deps.configured = false;
    const response = await GET(
      new Request("http://localhost/api/cron/request-payments", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "unavailable",
      rotations: deps.rotations,
    });
    expect(reconcilePendingPrivacyRotations).toHaveBeenCalledOnce();
    expect(reconcileAllRelays).not.toHaveBeenCalled();
    expect(reconcilePendingRequests).not.toHaveBeenCalled();
  });

  it("shares one reconciliation when worker requests overlap", async () => {
    let finish!: (value: typeof deps.relays) => void;
    vi.mocked(reconcileAllRelays).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = () =>
      new Request("http://localhost/api/cron/request-payments", {
        headers: { authorization: "Bearer test-cron-secret" },
      });
    const first = GET(request()),
      second = GET(request());
    finish(deps.relays);
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(reconcileAllRelays).toHaveBeenCalledOnce();
    expect(reconcilePendingRequests).toHaveBeenCalledOnce();
  });
});
