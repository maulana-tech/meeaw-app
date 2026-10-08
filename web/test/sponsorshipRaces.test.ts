import { afterEach, expect, it } from "vitest";
import { up } from "../migrations/20261008200000-sponsorship-ledger.js";
import { SponsorLedger } from "../src/server/modules/sponsorship/ledger.service";
import { ledgerKey } from "../src/server/modules/sponsorship/ledgerModel";
import { createSponsorFixture } from "./helpers/sponsorshipFixtures";

let f: Awaited<ReturnType<typeof createSponsorFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
it("admits one contender for the last user quota across independent service instances", async () => {
  f = await createSponsorFixture({ userLimit: 1 });
  const result = await Promise.allSettled([
    f.a.admit(f.intent("one")),
    f.b.admit(f.intent("two")),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("admits one contender for the last global envelope even with different users", async () => {
  f = await createSponsorFixture({
    globalWei: 500_000_000_000_000_000n,
    anonymousWei: 100_000_000_000_000_000n,
  });
  const result = await Promise.allSettled([
    f.a.admit(f.intent("one")),
    f.b.admit(f.intent("two", { kind: "user", key: "bob" })),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("binds principal and business digest to an admitted action", async () => {
  f = await createSponsorFixture();
  const original = f.intent("one");
  await f.a.admit(original);
  await expect(
    f.b.admit({ ...original, principal: { kind: "user", key: "bob" } }),
  ).rejects.toThrow();
  await expect(
    f.b.admit({ ...original, businessDigest: `0x${"f".repeat(64)}` }),
  ).rejects.toThrow();
});
it("fences a cancellation racing the transition into signing", async () => {
  f = await createSponsorFixture();
  const a = await f.a.admit(f.intent("race"));
  const tx = {
    chainId: 143,
    from: "0x1111111111111111111111111111111111111111" as const,
    to: "0x2222222222222222222222222222222222222222" as const,
    data: "0x" as const,
    nonce: 0,
    gas: 100n,
    value: 0n as const,
    fee: { type: 0 as const, gasPrice: 1n },
  };
  const c = await f.a.allocate(a, "one", `0x${"c".repeat(64)}`, tx);
  const result = await Promise.allSettled([
    f.a.enterSigning(c, 7),
    f.b.cancelUnsigned(a),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("enforces the anonymous sub-budget atomically without resetting user budget", async () => {
  f = await createSponsorFixture({ anonymousWei: 500_000_000_000_000_000n });
  const result = await Promise.allSettled([
    f.a.admit(f.intent("guest1", { kind: "guest-wallet", key: "first" })),
    f.b.admit(f.intent("guest2", { kind: "anonymous", key: "shared" })),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await f.a.admit(f.intent("user"))).toBeDefined();
});
it("refuses exhausted principal capacity and backward UTC rollover", async () => {
  f = await createSponsorFixture();
  const counters = Object.fromEntries(
    Array.from({ length: 4096 }, (_, i) => [ledgerKey(`counter${i}`), 0]),
  );
  await f.db
    .collection("sponsorship_ledgers")
    .updateOne({ _id: "chain:143" as never }, { $set: { counters } });
  await expect(f.a.admit(f.intent("capacity"))).rejects.toMatchObject({
    reason: "capacity",
  });
  f.clock.set(new Date("2026-10-07T00:00:00Z"));
  await expect(f.a.status(f.principal)).rejects.toMatchObject({
    reason: "rpc",
  });
});
it("reports configuration pause before any policy has been captured", async () => {
  f = await createSponsorFixture();
  const noPolicy = new SponsorLedger({
    db: f.db,
    clock: f.clock,
    policy: () => ({ ready: false, reason: "configuration" }),
  });
  expect(await noPolicy.status(f.principal)).toMatchObject({
    configured: false,
    available: false,
    reason: "configuration",
  });
});
it("installs additive indexes idempotently with no signed reservation TTL", async () => {
  f = await createSponsorFixture();
  await f.db.createCollection("sponsorship_actions");
  await up(f.db);
  await up(f.db);
  const indexes = await f.db
    .collection("sponsorship_actions")
    .listIndexes()
    .toArray();
  expect(indexes.some((i) => i.name === "sponsorship_action_history")).toBe(
    true,
  );
  expect(indexes.some((i) => i.expireAfterSeconds !== undefined)).toBe(false);
});
