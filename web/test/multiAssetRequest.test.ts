import { describe, expect, it } from "vitest";
import {
  createSignedRequest,
  openRequest,
} from "../src/features/requests/requestCrypto";
import { assetPool } from "./helpers/multiAssetFixtures";
import {
  testAccount,
  testParticipant,
  testSigner,
} from "./helpers/requestFixtures";

describe("asset-bound requests", () => {
  it("keeps amount and encrypted note bound to AUSD", async () => {
    const pool = assetPool("AUSD", { request: true });
    const { record } = await createSignedRequest(
      {
        id: "00000000-0000-4000-8000-0000000000a1",
        pool,
        requester: await testParticipant("alice", 1),
        addressee: await testParticipant("bob", 2),
        amount: 20_000_000n,
        note: "Lunch",
        createdAt: new Date().toISOString(),
      },
      testSigner(1),
    );
    expect((await openRequest(record, testAccount(2), pool)).amount).toBe(
      "20000000",
    );
    await expect(
      openRequest(record, testAccount(2), assetPool("USDC")),
    ).rejects.toThrow();
  });
});
