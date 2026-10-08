import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrivacyKeysRepository } from "../src/server/modules/privacyKeys/privacyKeys.repository";
import { AccountSpendGate } from "../src/server/modules/privacyKeys/spendGate";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { openIsolatedRequestDb } from "./helpers/requestDb";

describe("captured app funding admission", () => {
  let isolated: Awaited<ReturnType<typeof openIsolatedRequestDb>>;
  beforeAll(async () => {
    isolated = await openIsolatedRequestDb();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  it("captures the confirmed funding key and excludes rotation until terminal evidence", async () => {
    const f = await makePrivacyFixture(),
      repo = new PrivacyKeysRepository(isolated.db);
    await repo.bootstrap(f.state);
    const gate = new AccountSpendGate(isolated.db, f.registry, async () => ({
      ...f.keys[0],
      owner: f.owner,
    }));
    const capture = await gate.admit(f.owner, "request:one", f.keys[0]);
    expect(capture).toMatchObject({ fundingGeneration: 0, keyRevision: 1 });
    expect(
      await gate.admit(f.owner, "request:one", f.keys[0], capture),
    ).toEqual(capture);
    await expect(repo.prepare(await f.signApproval())).rejects.toThrow();
    await gate.assert(f.owner, "request:one", capture);
    await gate.finish(f.owner, "request:one", capture, "terminal");
    await repo.prepare(await f.signApproval());
    await expect(
      gate.admit(f.owner, "request:late", f.keys[0]),
    ).rejects.toThrow();
  });
  it("does not accept a stale or unrelated captured ticket", async () => {
    const f = await makePrivacyFixture();
    f.state.registry = "31337:0x6666666666666666666666666666666666666666";
    const repo = new PrivacyKeysRepository(isolated.db);
    await repo.bootstrap(f.state);
    const gate = new AccountSpendGate(
      isolated.db,
      f.state.registry,
      async () => ({ ...f.keys[0], owner: f.owner }),
    );
    const capture = await gate.admit(f.owner, "transfer:one", f.keys[0]);
    await expect(
      gate.assert(f.owner, "transfer:other", capture),
    ).rejects.toThrow();
    await expect(
      gate.assert(f.owner, "transfer:one", { ...capture, keyRevision: 2 }),
    ).rejects.toThrow();
  });
});
