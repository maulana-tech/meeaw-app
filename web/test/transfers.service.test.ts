import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { openIsolatedRequestDb } from "./helpers/requestDb";
import { testParticipant, testPool } from "./helpers/requestFixtures";
import { makeTransferFixture } from "./helpers/transferFixtures";

const deps = vi.hoisted(() => ({
  db: null as unknown,
  wallet: "",
  registry: new Map<string, unknown>(),
}));
vi.mock("../src/server/db/mongo", () => ({ getDb: async () => deps.db }));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: async () => ({ address: deps.wallet }),
}));
vi.mock("../src/server/modules/usernames/usernames.service", () => ({
  resolveUsername: async (u: string) => deps.registry.get(u) ?? null,
}));
vi.mock("../src/lib/pools", async (original) => ({
  ...(await original<typeof import("../src/lib/pools")>()),
  requestPool: () => testPool,
  resolvePool: () => testPool,
}));

import { createSignedTransfer } from "../src/features/transfers/transferCrypto";
import {
  createTransfer,
  getTransfer,
  listTransfers,
} from "../src/server/modules/transfers/transfers.service";

describe("transfer participant authorization", () => {
  let db: Awaited<ReturnType<typeof openIsolatedRequestDb>>;
  beforeAll(async () => {
    db = await openIsolatedRequestDb();
    deps.db = db.db;
  }, 15000);
  beforeEach(async () => {
    await db.db.collection("private_transfers").deleteMany({});
    deps.registry.clear();
  });
  afterAll(async () => {
    await db?.close();
  });
  async function fresh() {
    const f = await makeTransferFixture();
    deps.wallet = f.record.sender.wallet;
    for (const p of [f.record.sender, f.record.recipient])
      deps.registry.set(p.username, {
        owner: p.wallet,
        notePubkeyHex: p.notePubkey,
        viewPubkeyHex: p.viewPubkey,
      });
    return {
      ...f,
      record: await createSignedTransfer({
        id: f.record.id,
        pool: f.pool,
        sender: f.record.sender,
        recipient: f.record.recipient,
        account: f.sender,
        signer: f.signer,
        amount: 20_000_000n,
        note: "Private lunch",
        createdAt: new Date().toISOString(),
      }),
    };
  }
  it("stores opaque participant metadata and rejects outsider reads", async () => {
    const f = await fresh();
    await createTransfer("sender", f.record);
    deps.wallet = f.record.recipient.wallet;
    expect((await getTransfer("recipient", f.record.id)).status).toBe(
      "pending",
    );
    deps.wallet = (await testParticipant("outsider", 3)).wallet;
    await expect(getTransfer("outsider", f.record.id)).rejects.toThrow(
      "Not found",
    );
    expect(
      (await listTransfers("outsider", { direction: "all" })).items,
    ).toHaveLength(0);
    expect(
      JSON.stringify(await db.db.collection("private_transfers").findOne({})),
    ).not.toContain("Private lunch");
  });
  it("rejects changed registry keys before accepting an intent", async () => {
    const f = await fresh(),
      p = await testParticipant("bob", 3);
    deps.registry.set("bob", {
      owner: p.wallet,
      notePubkeyHex: p.notePubkey,
      viewPubkeyHex: p.viewPubkey,
    });
    await expect(createTransfer("sender", f.record)).rejects.toThrow(
      /keys changed/,
    );
    expect(await db.db.collection("private_transfers").countDocuments()).toBe(
      0,
    );
  });
});
