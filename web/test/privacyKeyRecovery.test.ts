// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  state: vi.fn(),
  escrow: vi.fn(),
  passkey: vi.fn(),
  unlockPasskey: vi.fn(),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    privacyKeys: { verifiedState: { query: ports.state } },
    wallets: {
      getEscrow: { query: ports.escrow },
      getPasskey: { query: ports.passkey },
    },
  },
}));
vi.mock("../src/lib/passkey", () => ({
  unlockPasskeyMaster: ports.unlockPasskey,
}));

import { accountForGeneration } from "../src/features/privacyKeys/keyRing";
import {
  reauthenticatePrivacyRoot,
  unlockPrivacyKeyring,
} from "../src/features/privacyKeys/reauthenticate";
import {
  decryptMaster,
  deserializeEscrow,
  encryptMaster,
  rotateEscrow,
  serializeEscrow,
} from "../src/lib/keys";
import { clearLocalAccount, getAccount } from "../src/lib/notes";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";

afterEach(() => {
  clearLocalAccount();
  vi.clearAllMocks();
});
describe("privacy recovery across generations", () => {
  it("restores old and current keys from the same PIN after changing that PIN", async () => {
    const f = await makePrivacyFixture();
    ports.state.mockResolvedValue(f.rotatedState);
    const encrypted = serializeEscrow(encryptMaster(f.root, "123456"));
    const replacement = rotateEscrow(encrypted, "123456", "654321");
    ports.escrow.mockResolvedValue(replacement);
    const restored = await reauthenticatePrivacyRoot("pin", "654321");
    try {
      const ring = await unlockPrivacyKeyring(restored, f.rotatedState);
      expect(accountForGeneration(ring, 0)).toEqual(f.accounts.get(0));
      expect(accountForGeneration(ring, 1)).toEqual(f.accounts.get(1));
      expect(getAccount()).toEqual(f.accounts.get(1));
    } finally {
      restored.fill(0);
    }
    expect(() =>
      decryptMaster(deserializeEscrow(replacement), "123456"),
    ).toThrow();
  });
  it("uses the established passkey root identity rather than its rotated viewing key", async () => {
    const f = await makePrivacyFixture();
    ports.state.mockResolvedValue(f.rotatedState);
    ports.passkey.mockResolvedValue({
      credentialId: "existing",
      transports: [],
      viewPubkeyHex: f.keys[0].viewPubkey.slice(2),
    });
    ports.unlockPasskey.mockResolvedValue(f.root.slice());
    const restored = await reauthenticatePrivacyRoot("passkey");
    try {
      expect(
        accountForGeneration(
          await unlockPrivacyKeyring(restored, f.rotatedState),
          1,
        ),
      ).toEqual(f.accounts.get(1));
    } finally {
      restored.fill(0);
    }
    expect(ports.unlockPasskey).toHaveBeenCalledOnce();
  });
  it("fails closed if metadata changed during unlock and clears failed derived buffers", async () => {
    const f = await makePrivacyFixture();
    ports.state.mockResolvedValue(f.state);
    await expect(
      unlockPrivacyKeyring(f.root, f.rotatedState),
    ).rejects.toThrow();
    expect(getAccount()).toBeNull();
  });
  it("does not install recovered keys if the wallet or lock state changed during derivation", async () => {
    const f = await makePrivacyFixture();
    ports.state.mockResolvedValue(f.rotatedState);
    await expect(
      unlockPrivacyKeyring(f.root, f.rotatedState, () => false),
    ).rejects.toThrow();
    expect(getAccount()).toBeNull();
  });
});
