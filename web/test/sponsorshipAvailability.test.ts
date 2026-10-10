import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSponsorFixture } from "./helpers/sponsorshipFixtures";

const state = vi.hoisted(() => ({ db: null as unknown, balance: vi.fn() }));
vi.mock("../src/server/db/mongo", () => ({ getDb: async () => state.db }));
vi.mock("../src/env.server", () => ({
  getServerEnv: () => ({
    RELAYER_PRIVATE_KEY: `0x${"01".repeat(32)}`,
    RELAYER_DAILY_BUDGET_MON: "5",
    RELAYER_ANONYMOUS_BUDGET_MON: "1",
    RELAYER_ACTION_BUDGET_MON: "0.5",
    RELAYER_MAX_FEE_GWEI: "200",
  }),
}));
vi.mock("../src/lib/chain", () => ({
  chain: { id: 143 },
  rpcUrl: "http://127.0.0.1:8545",
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({ getBalance: state.balance }),
}));

import { sponsorshipStatus } from "../src/server/modules/sponsorship/sponsorship.service";

const ctx = {
  ip: null,
  authToken: null,
  privyUserId: null,
  privyClaim: null,
  authError: null,
};
let f: Awaited<ReturnType<typeof createSponsorFixture>> | undefined;
beforeEach(async () => {
  f = await createSponsorFixture();
  state.db = f.db;
  state.balance.mockReset();
});
afterEach(async () => {
  await f?.close();
  f = undefined;
});
it("reports low relayer funds as unavailable without exposing its balance", async () => {
  state.balance.mockResolvedValueOnce(50_000_000_000_000_000n);
  expect(await sponsorshipStatus(ctx)).toMatchObject({
    available: false,
    reason: "balance",
  });
});
it("keeps RPC failures unavailable rather than treating them as wallet-paid permission", async () => {
  state.balance.mockRejectedValueOnce(
    Error("private RPC URL must not be returned"),
  );
  const status = await sponsorshipStatus(ctx);
  expect(status).toMatchObject({ available: false, reason: "rpc" });
  expect(JSON.stringify(status)).not.toContain("private RPC");
});
