import { describe, expect, it } from "vitest";
import { openTransfer } from "../src/features/transfers/transferCrypto";
import { assetPool, makeAssetTransfer } from "./helpers/multiAssetFixtures";

describe("asset-bound transfer", { timeout: 30000 }, () => {
  it("supports AUSD without enabling payment requests", async () => {
    const f = await makeAssetTransfer("AUSD");
    expect(f.pool.requestCapable).toBe(false);
    expect((await openTransfer(f.record, f.recipient, f.pool)).amount).toBe(
      "20000000",
    );
    await expect(
      openTransfer(f.record, f.recipient, assetPool("USDC")),
    ).rejects.toThrow();
  });
});
