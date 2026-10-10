import { afterEach, describe, expect, it } from "vitest";
import type { Context } from "../src/server/context";
import { WithdrawBatches } from "../src/server/modules/sponsorship/withdrawBatches";
import { createSponsorFixture } from "./helpers/sponsorshipFixtures";

let f: Awaited<ReturnType<typeof createSponsorFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
const ctx: Context = {
  ip: null,
  authToken: "test",
  privyUserId: "alice",
  privyClaim: { user_id: "alice" } as Context["privyClaim"],
  authError: null,
};
const recipient = "0x1111111111111111111111111111111111111111";
const nullifier = `0x${"a".repeat(64)}`;
const input = {
  id: "11111111-1111-4111-8111-111111111111",
  pool: `143:${recipient}`,
  recipient,
  nullifiers: [nullifier],
};
describe("withdrawal sponsorship batches", () => {
  it("does not close a partially completed batch", async () => {
    f = await createSponsorFixture();
    const batches = new WithdrawBatches(f.a, 143);
    await batches.admit(ctx, input);
    await expect(batches.finish(ctx, input.id)).rejects.toThrow();
    expect(await f.a.status(f.principal)).toMatchObject({ reserved: 1 });
  });
  it("keeps one quota reservation and immutable membership across retries", async () => {
    f = await createSponsorFixture();
    const batches = new WithdrawBatches(f.a, 143);
    const ticket = await batches.admit(ctx, input);
    expect(await batches.admit(ctx, input)).toEqual(ticket);
    expect(await f.a.status(f.principal)).toMatchObject({ reserved: 1 });
    await expect(
      batches.admit(ctx, {
        ...input,
        recipient: "0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toThrow();
  });
  it("requires the original user, pool, destination and nullifier membership", async () => {
    f = await createSponsorFixture();
    const batches = new WithdrawBatches(f.a, 143);
    await batches.admit(ctx, input);
    expect(
      await batches.binding(ctx, input.id, {
        pool: input.pool,
        recipient,
        nullifier,
      }),
    ).toMatchObject({ closeParent: false, identity: { childId: nullifier } });
    await expect(
      batches.binding({ ...ctx, privyUserId: "bob" }, input.id, {
        pool: input.pool,
        recipient,
        nullifier,
      }),
    ).rejects.toThrow();
    await expect(
      batches.binding(ctx, input.id, {
        pool: input.pool,
        recipient,
        nullifier: `0x${"b".repeat(64)}`,
      }),
    ).rejects.toThrow();
  });
  it("rejects oversized batches without reserving quota or native budget", async () => {
    f = await createSponsorFixture();
    const batches = new WithdrawBatches(f.a, 143);
    await expect(
      batches.admit(ctx, {
        ...input,
        nullifiers: Array.from(
          { length: 17 },
          (_, i) => `0x${i.toString(16).padStart(64, "0")}`,
        ),
      }),
    ).rejects.toThrow();
    expect(await f.a.status(f.principal)).toMatchObject({
      used: 0,
      reserved: 0,
    });
  });
});
