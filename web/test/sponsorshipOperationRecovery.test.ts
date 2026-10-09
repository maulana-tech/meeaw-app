import { afterEach, expect, it, vi } from "vitest";
import { testPool } from "./helpers/requestFixtures";

vi.mock("../src/lib/pools", async (original) => ({
  ...(await original<typeof import("../src/lib/pools")>()),
  resolvePool: () => testPool,
}));

import { OperationSponsorship } from "../src/server/modules/sponsorship/operationAdapters";
import { TransferRepository } from "../src/server/modules/transfers/transfers.repository";
import { createSponsorFixture } from "./helpers/sponsorshipFixtures";
import { makeTransferFixture } from "./helpers/transferFixtures";

let f: Awaited<ReturnType<typeof createSponsorFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
async function setup() {
  f = await createSponsorFixture({}, 31337);
  const fixture = await makeTransferFixture(),
    repo = new TransferRepository(f.db);
  const record = await repo.create(fixture.record);
  return { f, repo, record, adapter: new OperationSponsorship(f.a) };
}
it("recovers the same parent after a lost linking response without another quota", async () => {
  const { f, repo, record, adapter } = await setup();
  const ticket = await adapter.ensure("transfer", record.operationId, "alice");
  await repo.collection.updateOne(
    { _id: record.id },
    { $unset: { "operation.sponsorshipAction": "" } },
  );
  expect(await adapter.ensure("transfer", record.operationId, "alice")).toEqual(
    ticket,
  );
  expect(
    (await repo.collection.findOne({ _id: record.id }))?.operation,
  ).toMatchObject({ sponsorshipAction: ticket });
  expect(await f.a.status(f.principal)).toMatchObject({ reserved: 1, used: 0 });
});
it("preserves accepted submissions and capture when pausing, then resumes the same parent", async () => {
  const { repo, record, adapter } = await setup();
  const ticket = await adapter.ensure("transfer", record.operationId, "alice");
  await repo.collection.updateOne(
    { _id: record.id },
    {
      $set: {
        "operation.accountTicketId": "capture",
        "operation.nextStep": 2,
        "operation.txHash": "0x1234",
        currentSubmission: { step: 2 } as never,
      },
    },
  );
  await adapter.pause("transfer", record.operationId, "cost");
  const paused = await repo.collection.findOne({ _id: record.id });
  expect(paused).toMatchObject({
    currentSubmission: { step: 2 },
    operation: {
      sponsorshipAction: ticket,
      sponsorshipPause: "cost",
      accountTicketId: "capture",
      nextStep: 2,
      txHash: "0x1234",
    },
  });
  await adapter.resume("transfer", record.operationId);
  expect(
    (await repo.collection.findOne({ _id: record.id }))?.operation,
  ).toMatchObject({ sponsorshipAction: ticket, nextStep: 2 });
  expect(
    (await repo.collection.findOne({ _id: record.id }))?.operation,
  ).not.toHaveProperty("sponsorshipPause");
});
it("rejects a cancelled parent instead of charging a replacement for the old operation", async () => {
  const { f, record, adapter } = await setup();
  const ticket = await adapter.ensure("transfer", record.operationId, "alice");
  await f.a.cancelUnsigned(ticket);
  await expect(
    adapter.ensure("transfer", record.operationId, "alice"),
  ).rejects.toMatchObject({ reason: "budget" });
  expect(await f.a.status(f.principal)).toMatchObject({ used: 0, reserved: 0 });
});
it("admits concurrent legacy resumes with one parent and one reserved unit", async () => {
  const { f, record, adapter } = await setup();
  const other = new OperationSponsorship(f.b);
  const tickets = await Promise.all([
    adapter.ensure("transfer", record.operationId, "alice"),
    other.ensure("transfer", record.operationId, "alice"),
  ]);
  expect(tickets[0]).toEqual(tickets[1]);
  expect(await f.a.status(f.principal)).toMatchObject({ reserved: 1, used: 0 });
});
