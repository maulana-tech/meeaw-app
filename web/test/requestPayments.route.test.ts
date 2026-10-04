import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  secret: "test-cron-secret",
  configured: true,
  relays: { examined: 0, confirmed: 0, unresolved: 0 },
  requests: { examined: 0, confirmed: 0, unresolved: 0 },
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

import { GET } from "../src/app/api/cron/request-payments/route";
import { reconcileAllRelays } from "../src/server/lib/durableRelayer";
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
    const missing = await GET(new Request("http://localhost/api/cron/request-payments"));
    const wrong = await GET(
      new Request("http://localhost/api/cron/request-payments", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(reconcileAllRelays).not.toHaveBeenCalled();
    expect(reconcilePendingRequests).not.toHaveBeenCalled();
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
    });
    expect(reconcileAllRelays).toHaveBeenCalledOnce();
    expect(reconcilePendingRequests).toHaveBeenCalledOnce();
  });

  it("does not touch reconciliation while the relayer is unavailable", async () => {
    deps.configured = false;
    const response = await GET(
      new Request("http://localhost/api/cron/request-payments", {
        headers: { authorization: "Bearer test-cron-secret" },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(reconcileAllRelays).not.toHaveBeenCalled();
    expect(reconcilePendingRequests).not.toHaveBeenCalled();
  });
});
