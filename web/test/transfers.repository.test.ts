import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openIsolatedRequestDb } from "./helpers/requestDb";
import { TransferRepository } from "../src/server/modules/transfers/transfers.repository";
import { createSignedTransfer } from "../src/features/transfers/transferCrypto";
import {
  testAccount,
  testParticipant,
  testPool,
  testSigner,
} from "./helpers/requestFixtures";
describe("direct transfer persistence", () => {
  let db: Awaited<ReturnType<typeof openIsolatedRequestDb>>,
    repo: TransferRepository;
  beforeAll(async () => {
    db = await openIsolatedRequestDb();
    repo = new TransferRepository(db.db);
    await repo.ensureIndexes();
  }, 15000);
  beforeEach(async () => {
    await db.db.collection("private_transfers").deleteMany({});
  });
  afterAll(async () => {
    await db?.close();
  });
  async function record(id = "00000000-0000-4000-8000-0000000000a1") {
    return createSignedTransfer({
      id,
      pool: testPool,
      sender: await testParticipant("alice", 1),
      recipient: await testParticipant("bob", 2),
      account: testAccount(1),
      signer: testSigner(1),
      amount: 20n,
      note: "Lunch",
      createdAt: "2026-10-06T00:00:00.000Z",
    });
  }
  it("makes identical retries idempotent and hides records from outsiders", async () => {
    const r = await record();
    await repo.create(r);
    await repo.create(r);
    expect(
      (await repo.list(r.sender.wallet, { direction: "sent" })).items,
    ).toHaveLength(1);
    await expect(repo.get(testSigner(3).address, r.id)).rejects.toThrow(
      "Not found",
    );
    expect((await repo.get(r.recipient.wallet, r.id)).status).toBe("pending");
  });
  it("rejects a changed intent or a second pending send", async () => {
    const r = await record();
    await repo.create(r);
    await expect(
      repo.create({ ...r, createdAt: "2026-10-07T00:00:00.000Z" }),
    ).rejects.toThrow();
    await expect(
      repo.create(await record("00000000-0000-4000-8000-0000000000a2")),
    ).rejects.toThrow();
  });
});
