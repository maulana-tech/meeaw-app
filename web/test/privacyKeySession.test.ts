// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountForGeneration,
  accountForNote,
  accountForParticipant,
  derivePrivacyKeyring,
} from "../src/features/privacyKeys/keyRing";
import {
  getPrivacyKeyring,
  installPrivacyKeyring,
} from "../src/features/privacyKeys/session";
import {
  clearLocalAccount,
  deriveAndStoreAccount,
  getAccount,
  syncLocalAccountIdentity,
} from "../src/lib/notes";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";

afterEach(() => {
  clearLocalAccount();
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("verified privacy key session", () => {
  it("restores historical keys and selects both participant keys", async () => {
    const f = await makePrivacyFixture();
    const ring = await derivePrivacyKeyring(f.root, f.rotatedState);
    expect(accountForGeneration(ring, 1)).toEqual(f.accounts.get(1));
    expect(accountForNote(ring, {})).toEqual(f.accounts.get(0));
    expect(accountForNote(ring, { keyGeneration: 1 })).toEqual(
      f.accounts.get(1),
    );
    expect(() => accountForNote(ring, { keyGeneration: 2 })).toThrow();
    expect(await accountForParticipant(ring, f.keys[0])).toEqual(
      f.accounts.get(0),
    );
    await expect(
      accountForParticipant(ring, {
        notePubkey: f.keys[0].notePubkey,
        viewPubkey: f.keys[1].viewPubkey,
      }),
    ).rejects.toThrow();
  });
  it("rejects wrong roots, truncated history, duplicate IDs/pairs and unknown active keys", async () => {
    const f = await makePrivacyFixture();
    await expect(
      derivePrivacyKeyring(new Uint8Array(32).fill(8), f.rotatedState),
    ).rejects.toThrow();
    for (const state of [
      { ...f.rotatedState, generations: f.rotatedState.generations.slice(1) },
      {
        ...f.rotatedState,
        generations: [f.state.generations[0], f.state.generations[0]],
      },
      {
        ...f.rotatedState,
        generations: [
          f.state.generations[0],
          { ...f.state.generations[0], id: 1 },
        ],
      },
      { ...f.rotatedState, activeGeneration: 64 },
    ])
      await expect(derivePrivacyKeyring(f.root, state)).rejects.toThrow();
    expect(getPrivacyKeyring()).toBeNull();
  });
  it("uses active generation, refuses legacy overwrite, clears every secret and persists none", async () => {
    const f = await makePrivacyFixture();
    const persist = vi.spyOn(Storage.prototype, "setItem");
    const ring = await derivePrivacyKeyring(f.root, f.rotatedState);
    installPrivacyKeyring(ring);
    expect(getAccount()).toEqual(f.accounts.get(1));
    expect(() => deriveAndStoreAccount(f.root)).toThrow();
    expect(persist).not.toHaveBeenCalled();
    expect("root" in ring).toBe(false);
    clearLocalAccount();
    expect(getAccount()).toBeNull();
    expect(getPrivacyKeyring()).toBeNull();
    for (const account of ring.accounts.values()) {
      expect(account.ownerSecret).toBe(0n);
      expect(account.viewSk.every((byte) => byte === 0)).toBe(true);
    }
  });
  it("clears the complete ring when wallet identity changes", async () => {
    const f = await makePrivacyFixture();
    syncLocalAccountIdentity("first");
    const ring = await derivePrivacyKeyring(f.root, f.rotatedState);
    installPrivacyKeyring(ring);
    syncLocalAccountIdentity("second");
    expect(getPrivacyKeyring()).toBeNull();
    expect(getAccount()).toBeNull();
    expect(accountForGeneration(ring, 1).ownerSecret).toBe(0n);
  });
});
