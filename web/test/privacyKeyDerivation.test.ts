import { describe, expect, it } from "vitest";
import { derivePrivacyAccount } from "../src/features/privacyKeys/keyDerivation";
import { bytesToHex } from "../src/lib/crypto";

describe("privacy key generations", () => {
  const root = new Uint8Array(32).fill(7);
  it("retains the independently computed generation-zero vector", () => {
    const account = derivePrivacyAccount(root, 0);
    expect(account.ownerSecret.toString()).toBe(
      "4586413771004748177385579691527351924154609703805426817508166825644553166116",
    );
    expect(bytesToHex(account.viewSk)).toBe(
      "c095a46f969e4a46ff23b8d7290c6d8f7023508f351de0b564b41709b5cc8dff",
    );
  });
  it("recreates independent keys for every retained generation", () => {
    const owners = new Set<string>(),
      views = new Set<string>();
    for (let id = 0; id < 64; id++) {
      const account = derivePrivacyAccount(root, id);
      expect(derivePrivacyAccount(root.slice(), id)).toEqual(account);
      owners.add(account.ownerSecret.toString());
      views.add(bytesToHex(account.viewSk));
    }
    expect(owners.size).toBe(64);
    expect(views.size).toBe(64);
    expect(root).toEqual(new Uint8Array(32).fill(7));
  });
  it("rejects invalid roots and noncanonical generation numbers", () => {
    for (const id of [-1, 0.5, 64, NaN, Infinity])
      expect(() => derivePrivacyAccount(root, id)).toThrow();
    for (const size of [0, 31, 33])
      expect(() => derivePrivacyAccount(new Uint8Array(size), 0)).toThrow();
  });
});
