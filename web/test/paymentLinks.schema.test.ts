import { describe, expect, it } from "vitest";
import { fromBaseUnits } from "../src/lib/crypto";
import {
  createLinkInput,
  updateLinkInput,
} from "../src/server/modules/paymentLinks/paymentLinks.schema";

const base = { username: "alice", slug: "invoice-12", description: null };

describe("payment link amounts", () => {
  it("stores a fixed amount in the same base units the app reads back", () => {
    const parsed = createLinkInput.parse({ ...base, amount: "5" });
    expect(parsed.amount).toBe("5000000");
    // The pay page shows exactly what the owner typed, not 10x.
    expect(fromBaseUnits(BigInt(parsed.amount ?? "0"))).toBe("5");
  });

  it("keeps cents and rejects more decimals than the token has", () => {
    expect(createLinkInput.parse({ ...base, amount: "12.34" }).amount).toBe(
      "12340000",
    );
    expect(
      createLinkInput.safeParse({ ...base, amount: "1.0000001" }).success,
    ).toBe(false);
  });

  it("converts updated amounts the same way", () => {
    const parsed = updateLinkInput.parse({
      id: "link-1",
      manageToken: "token",
      amount: "2.5",
      description: null,
    });
    expect(parsed.amount).toBe("2500000");
  });
});
