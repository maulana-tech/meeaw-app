import { describe, expect, it } from "vitest";
import {
  parseRequestAmount,
  signedRequestSchema,
  validateRequestNote,
} from "../src/features/requests/validation";
import { wireRequestFixture } from "./helpers/requestFixtures";

describe("private request validation", () => {
  it("parses exact token units and rejects unsupported amounts", () => {
    expect(parseRequestAmount("20.000001", 6)).toBe(20_000_001n);
    expect(parseRequestAmount("18446744073709.551615", 6)).toBe(
      (1n << 64n) - 1n,
    );
    for (const value of [
      "0",
      "-1",
      "1e3",
      "NaN",
      "20.0000001",
      "18446744073709.551616",
    ]) {
      expect(() => parseRequestAmount(value, 6)).toThrow();
    }
  });
  it("accepts 200 Unicode code points and rejects longer notes", () => {
    expect(validateRequestNote("🙂".repeat(200))).toBe("🙂".repeat(200));
    expect(() => validateRequestNote("🙂".repeat(201))).toThrow();
  });
  it("rejects self requests, malformed keys, unbounded envelopes and unknown fields", () => {
    const good = wireRequestFixture();
    expect(signedRequestSchema.safeParse(good).success).toBe(true);
    expect(
      signedRequestSchema.safeParse({ ...good, addressee: good.requester })
        .success,
    ).toBe(false);
    expect(
      signedRequestSchema.safeParse({
        ...good,
        requester: { ...good.requester, viewPubkey: "0x12" },
      }).success,
    ).toBe(false);
    expect(
      signedRequestSchema.safeParse({ ...good, amount: "20" }).success,
    ).toBe(false);
    expect(
      signedRequestSchema.safeParse({ ...good, pool: "31337:invalid" }).success,
    ).toBe(false);
  });
  it("rejects non-canonical usernames and wrongly sized envelopes", () => {
    const good = wireRequestFixture();
    for (const username of [
      "Alice",
      " alice",
      "al",
      "a".repeat(33),
      "al-ice",
    ]) {
      expect(
        signedRequestSchema.safeParse({
          ...good,
          requester: { ...good.requester, username },
        }).success,
      ).toBe(false);
    }
    for (const ciphertext of [
      `0x${"00".repeat(4135)}`,
      `0x${"00".repeat(4137)}`,
      `0x${"zz".repeat(4136)}`,
    ]) {
      expect(
        signedRequestSchema.safeParse({
          ...good,
          addresseeEnvelope: { ...good.addresseeEnvelope, ciphertext },
        }).success,
      ).toBe(false);
    }
    expect(
      signedRequestSchema.safeParse({
        ...good,
        recipientCommitment: `0x${"ff".repeat(32)}`,
      }).success,
    ).toBe(false);
  });
});
