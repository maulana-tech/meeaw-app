import { afterAll, beforeAll, expect, it } from "vitest";
import { CashoutOperations } from "../src/server/modules/privacyKeys/cashoutOperations";
import { AccountSpendGate } from "../src/server/modules/privacyKeys/spendGate";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { openIsolatedRequestDb } from "./helpers/requestDb";

let isolated: Awaited<ReturnType<typeof openIsolatedRequestDb>>;
beforeAll(async () => {
  isolated = await openIsolatedRequestDb();
});
afterAll(async () => {
  await isolated?.close();
});
it("releases only a proven reverted child capture before a fresh batch", async () => {
  const f = await makePrivacyFixture();
  f.state.registry = "31337:0x0000000000000000000000000000000000000003";
  const gate = new AccountSpendGate(
    isolated.db,
    f.state.registry,
    async () => ({ ...f.state.generations[0], owner: f.owner }),
  );
  await gate.repo.bootstrap(f.state);
  let reverted = false;
  const ops = new CashoutOperations(
    isolated.db,
    gate,
    async () => false,
    async () => reverted,
  );
  const input = {
    operationId: crypto.randomUUID(),
    fundingGeneration: 0,
    keyRevision: 1,
    pool: "31337:0x0000000000000000000000000000000000000001",
    nullifier: `0x${"c".repeat(64)}` as const,
    sponsorBatchId: crypto.randomUUID(),
  };
  const a = await ops.admit(f.owner, input);
  await ops.dispatch(f.owner, a.operationId, a);
  const next = {
    ...input,
    operationId: crypto.randomUUID(),
    sponsorBatchId: crypto.randomUUID(),
  };
  await expect(ops.admit(f.owner, next)).rejects.toThrow("original");
  reverted = true;
  const b = await ops.admit(f.owner, next);
  expect(b.operationId).not.toBe(a.operationId);
  await expect(ops.dispatch(f.owner, a.operationId, a)).rejects.toThrow();
});
it("resumes the same note after a lost admission response and releases confirmed cash-outs on reload", async () => {
  const f = await makePrivacyFixture();
  const gate = new AccountSpendGate(
    isolated.db,
    f.state.registry,
    async () => ({ ...f.state.generations[0], owner: f.owner }),
  );
  await gate.repo.bootstrap(f.state);
  let spent = false;
  const ops = new CashoutOperations(isolated.db, gate, async () => spent);
  const input = {
    operationId: crypto.randomUUID(),
    fundingGeneration: 0,
    keyRevision: 1,
    pool: "31337:0x0000000000000000000000000000000000000001",
    nullifier: `0x${"a".repeat(64)}` as const,
  };
  const a = await ops.admit(f.owner, input);
  const b = await ops.admit(f.owner, {
    ...input,
    operationId: crypto.randomUUID(),
  });
  expect(b).toEqual(a);
  const doc = await gate.repo.accounts.findOne({
    _id: `${f.owner}:${f.state.registry}`,
  });
  expect(doc?.tickets).toHaveLength(1);
  await ops.dispatch(f.owner, a.operationId, a);
  await expect(ops.cancel(f.owner, a.operationId)).rejects.toThrow();
  await ops.reconcile(f.owner);
  expect(
    (
      await gate.repo.accounts.findOne({
        _id: `${f.owner}:${f.state.registry}`,
      })
    )?.tickets,
  ).toHaveLength(1);
  spent = true;
  await ops.reconcile(f.owner);
  expect(
    (
      await gate.repo.accounts.findOne({
        _id: `${f.owner}:${f.state.registry}`,
      })
    )?.tickets,
  ).toHaveLength(0);
});
it("cancels only a prepared operation and fences later dispatch", async () => {
  const f = await makePrivacyFixture();
  f.state.registry = "31337:0x0000000000000000000000000000000000000002";
  const gate = new AccountSpendGate(
    isolated.db,
    f.state.registry,
    async () => ({ ...f.state.generations[0], owner: f.owner }),
  );
  await gate.repo.bootstrap(f.state);
  const ops = new CashoutOperations(isolated.db, gate, async () => false);
  const a = await ops.admit(f.owner, {
    operationId: crypto.randomUUID(),
    fundingGeneration: 0,
    keyRevision: 1,
    pool: "31337:0x0000000000000000000000000000000000000001",
    nullifier: `0x${"b".repeat(64)}`,
  });
  await ops.cancel(f.owner, a.operationId);
  const b = await ops.admit(f.owner, {
    operationId: crypto.randomUUID(),
    fundingGeneration: 0,
    keyRevision: 1,
    pool: "31337:0x0000000000000000000000000000000000000001",
    nullifier: `0x${"b".repeat(64)}`,
  });
  expect(b.operationId).not.toBe(a.operationId);
  await expect(ops.dispatch(f.owner, a.operationId, a)).rejects.toThrow();
  await ops.cancel(f.owner, b.operationId);
  await expect(ops.dispatch(f.owner, a.operationId, a)).rejects.toThrow();
  expect(
    (
      await gate.repo.accounts.findOne({
        _id: `${f.owner}:${f.state.registry}`,
      })
    )?.tickets,
  ).toHaveLength(0);
});
