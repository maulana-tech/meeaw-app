import { describe, expect, it } from "vitest";
import {
  createLinkInput,
  updateLinkInput,
} from "../src/server/modules/paymentLinks/paymentLinks.schema";

describe("managed link currency", () => {
  it("rejects amounts outside the note uint64 range", () => {
    expect(() =>
      createLinkInput.parse({
        username: "alice",
        slug: "too-large",
        amount: "18446744073709.551616",
        description: null,
        asset: "AUSD",
      }),
    ).toThrow();
  });
  it("keeps AUSD metadata while converting human units once", () => {
    const link = createLinkInput.parse({
      username: "alice",
      slug: "lunch",
      amount: "20.000001",
      description: "Lunch",
      asset: "AUSD",
    });
    expect(link.asset).toBe("AUSD");
    expect(link.amount).toBe("20000001");
    expect(
      createLinkInput.parse({
        username: "alice",
        slug: "old-link",
        amount: "20",
        description: null,
      }).asset,
    ).toBe("USDC");
  });
  it("refuses a currency mutation on edit", () => {
    expect(() =>
      updateLinkInput.parse({
        id: "test",
        manageToken: "test",
        amount: "10",
        description: null,
        asset: "AUSD",
      }),
    ).toThrow();
  });
});
