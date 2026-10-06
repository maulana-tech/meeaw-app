import { describe, expect, it } from "vitest";
import { up } from "../migrations/20261006130000-payment-link-assets.js";
import { openIsolatedRequestDb } from "./helpers/requestDb";

describe("link asset backfill", () => {
  it("is repeatable without rescaling amounts or replacing management tokens", async () => {
    const db = await openIsolatedRequestDb();
    try {
      const links = db.db.collection<{
        _id: string;
        asset?: string;
        tokenDecimals?: number;
        amount: string;
        manageTokenHash: string;
      }>("payment_links");
      await links.insertOne({
        _id: "old",
        amount: "20000000",
        manageTokenHash: "opaque-existing-hash",
      });
      await up(db.db);
      await up(db.db);
      expect(await links.findOne({ _id: "old" })).toMatchObject({
        amount: "20000000",
        manageTokenHash: "opaque-existing-hash",
        asset: "USDC",
        tokenDecimals: 6,
      });
    } finally {
      await db.close();
    }
  });
});
