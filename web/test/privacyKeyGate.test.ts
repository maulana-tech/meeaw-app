import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrivacyKeysRepository } from "../src/server/modules/privacyKeys/privacyKeys.repository";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { openIsolatedRequestDb } from "./helpers/requestDb";

describe("cross-device generation gate", () => {
  let isolated: Awaited<ReturnType<typeof openIsolatedRequestDb>>;
  beforeAll(async () => {
    isolated = await openIsolatedRequestDb();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  const fixture = async (suffix: number) => {
    const f = await makePrivacyFixture();
    f.state.registry = `31337:0x${suffix.toString(16).padStart(40, "0")}`;
    f.approval.registry = f.state.registry;
    return f;
  };
  it("admits exactly one of a rotation and a concurrent spend", async () => {
    const f = await fixture(1),
      a = new PrivacyKeysRepository(isolated.db),
      b = new PrivacyKeysRepository(isolated.db);
    await a.bootstrap(f.state);
    const attempts = await Promise.allSettled([
      a.prepare(await f.signApproval()),
      b.acquireTicket({
        owner: f.owner,
        registry: f.state.registry,
        revision: 1,
        fundingGeneration: 0,
        operationId: "send-a",
        kind: "spend",
      }),
    ]);
    expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });
  it("allows independent spends, blocks recovery/rotation and safely releases only the captured ticket", async () => {
    const f = await fixture(2),
      repo = new PrivacyKeysRepository(isolated.db);
    await repo.bootstrap(f.state);
    const input = {
      owner: f.owner,
      registry: f.state.registry,
      revision: 1,
      fundingGeneration: 0,
      kind: "spend" as const,
    };
    const a = await repo.acquireTicket({ ...input, operationId: "a" });
    const b = await repo.acquireTicket({ ...input, operationId: "b" });
    expect(await repo.acquireTicket({ ...input, operationId: "a" })).toEqual(a);
    await expect(repo.prepare(await f.signApproval())).rejects.toThrow();
    await expect(
      repo.acquireTicket({
        ...input,
        operationId: "pin",
        kind: "recovery-change",
      }),
    ).rejects.toThrow();
    await expect(
      repo.acquireTicket({ ...input, operationId: "stale", revision: 2 }),
    ).rejects.toThrow();
    await expect(
      repo.assertTicket({ ...a, fundingGeneration: 1 }),
    ).rejects.toThrow();
    await expect(
      repo.releaseTicket(a, "unknown" as "terminal"),
    ).rejects.toThrow();
    await repo.releaseTicket(a, "unsigned-abandoned");
    await repo.assertTicket(b);
    await repo.releaseTicket(b, "terminal");
    const recovery = await repo.acquireTicket({
      ...input,
      operationId: "pin",
      kind: "recovery-change",
    });
    await expect(
      repo.acquireTicket({ ...input, operationId: "c" }),
    ).rejects.toThrow();
    await repo.releaseTicket(recovery, "terminal");
    const approval = await f.signApproval();
    await repo.prepare(approval);
    expect((await repo.prepare(approval)).intent).toEqual(approval);
    await expect(
      repo.prepare({ ...approval, id: "00000000-0000-4000-8000-000000000002" }),
    ).rejects.toThrow();
  });
  it("retains at most 128 concurrent spends without expiring uncertain work", async () => {
    const f = await fixture(3),
      repo = new PrivacyKeysRepository(isolated.db);
    await repo.bootstrap(f.state);
    const input = {
      owner: f.owner,
      registry: f.state.registry,
      revision: 1,
      fundingGeneration: 0,
      kind: "spend" as const,
    };
    await Promise.all(
      Array.from({ length: 128 }, (_, id) =>
        repo.acquireTicket({ ...input, operationId: `payment-${id}` }),
      ),
    );
    await expect(
      repo.acquireTicket({ ...input, operationId: "overflow" }),
    ).rejects.toThrow();
    await expect(repo.prepare(await f.signApproval())).rejects.toThrow();
  });
});
