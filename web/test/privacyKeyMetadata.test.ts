import { verifyTypedData } from "viem";
import { describe, expect, it } from "vitest";
import { rotationTypedData } from "../src/features/privacyKeys/rotationTypedData";
import {
  privacyKeyStateSchema,
  rotationIntentSchema,
} from "../src/server/modules/privacyKeys/privacyKeys.schema";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";

describe("authenticated public generation metadata", () => {
  it("binds public pairs, identity, scope, revision and deadline to the wallet approval", async () => {
    const f = await makePrivacyFixture(),
      signed = await f.signApproval();
    expect(
      await verifyTypedData({
        ...rotationTypedData(signed),
        address: f.owner,
        signature: signed.signature,
      }),
    ).toBe(true);
    for (const changes of [
      { id: "different" },
      { expectedRevision: 2 },
      { to: 2 },
      { username: "bob" },
      { owner: `0x${"2".repeat(40)}` as const },
      { registry: `31338:${f.registry.split(":")[1]}` as const },
      { newKeys: f.keys[0] },
      { deadline: "4102444801" },
    ]) {
      expect(
        await verifyTypedData({
          ...rotationTypedData({ ...signed, ...changes }),
          address: f.owner,
          signature: signed.signature,
        }),
      ).toBe(false);
    }
  });
  it("rejects secrets, duplicate/truncated history and out-of-range generations", async () => {
    const f = await makePrivacyFixture();
    expect(privacyKeyStateSchema.safeParse(f.rotatedState).success).toBe(true);
    for (const extra of [
      { root: "secret" },
      { viewSk: "secret" },
      { ownerSecret: "secret" },
    ]) {
      expect(
        privacyKeyStateSchema.safeParse({ ...f.state, ...extra }).success,
      ).toBe(false);
      expect(
        rotationIntentSchema.safeParse({
          ...(await f.signApproval()),
          ...extra,
        }).success,
      ).toBe(false);
    }
    expect(
      privacyKeyStateSchema.safeParse({
        ...f.rotatedState,
        generations: [f.state.generations[0], f.state.generations[0]],
      }).success,
    ).toBe(false);
    expect(
      privacyKeyStateSchema.safeParse({
        ...f.rotatedState,
        generations: f.rotatedState.generations.slice(1),
      }).success,
    ).toBe(false);
    expect(
      privacyKeyStateSchema.safeParse({
        ...f.rotatedState,
        activeGeneration: 64,
      }).success,
    ).toBe(false);
  });
});
