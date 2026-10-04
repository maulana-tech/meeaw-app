// @vitest-environment happy-dom

// Mera criterion: "nothing sensitive persisted to disk or server". The note
// secrets must exist only in this tab's memory — a reload (or a fresh browser
// profile) re-locks, and the same passkey/PIN re-derives them.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/keys", () => ({
  deriveNoteSecrets: vi.fn((master: Uint8Array) => ({
    ownerSecret: BigInt(master[0]),
    viewSk: new Uint8Array(32).fill(master[0]),
  })),
}));

import {
  clearLocalAccount,
  deriveAndStoreAccount,
  getAccount,
  hasLocalAccount,
} from "../src/lib/notes";

const master = new Uint8Array(32).fill(9);

beforeEach(() => {
  window.localStorage.clear();
  clearLocalAccount();
});

describe("note secret storage", () => {
  it("derives into memory without touching localStorage", () => {
    deriveAndStoreAccount(master);

    expect(getAccount()).toEqual({
      ownerSecret: 9n,
      viewSk: new Uint8Array(32).fill(9),
    });
    expect(hasLocalAccount()).toBe(true);

    const keys = Object.keys(window.localStorage);
    expect(keys).not.toContain("mawee.ownerSecret");
    expect(keys).not.toContain("mawee.viewSecret");
    // Nothing in storage may contain the derived material either.
    for (const key of keys) {
      const value = window.localStorage.getItem(key) ?? "";
      expect(value).not.toContain("09".repeat(32));
    }
  });

  it("re-locks when the account is cleared (reload/disconnect)", () => {
    deriveAndStoreAccount(master);
    clearLocalAccount();

    expect(getAccount()).toBeNull();
    expect(hasLocalAccount()).toBe(false);
  });

  it("stays locked before any derivation", () => {
    expect(getAccount()).toBeNull();
    expect(hasLocalAccount()).toBe(false);
  });
});
