import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { up } from "../migrations/20261008160000-privacy-key-generations.js";
import { PrivacyKeysRepository } from "../src/server/modules/privacyKeys/privacyKeys.repository";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { openIsolatedRequestDb } from "./helpers/requestDb";

describe("privacy generation metadata persistence", () => {
  let isolated: Awaited<ReturnType<typeof openIsolatedRequestDb>>;
  beforeAll(async () => {
    isolated = await openIsolatedRequestDb();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  it("keeps bootstrap idempotent and refuses replacing retained history", async () => {
    const f = await makePrivacyFixture(),
      repo = new PrivacyKeysRepository(isolated.db);
    await repo.bootstrap(f.state);
    expect(await repo.bootstrap(f.state)).toEqual(f.state);
    await expect(repo.bootstrap(f.rotatedState)).rejects.toThrow();
    expect(await repo.get(f.owner, f.registry)).toEqual(f.state);
    expect(await repo.get(`0x${"2".repeat(40)}`, f.registry)).toBeNull();
  });
  it("applies additive indexes idempotently without altering retained public history", async () => {
    const f = await makePrivacyFixture(),
      repo = new PrivacyKeysRepository(isolated.db);
    const before = await repo.get(f.owner, f.registry);
    await up(isolated.db);
    await up(isolated.db);
    expect(await repo.get(f.owner, f.registry)).toEqual(before);
    const indexes = await isolated.db
      .collection("privacy_key_rotations")
      .listIndexes()
      .toArray();
    expect(
      indexes.find((x) => x.name === "privacy_rotation_pending")
        ?.partialFilterExpression,
    ).toEqual({ pending: true });
  });
});
