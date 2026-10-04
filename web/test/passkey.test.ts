// @vitest-environment node
import type { WebAuthnClient } from "@category-labs/mera";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { bytesToHex } from "../src/lib/crypto";
import { deriveNoteSecrets } from "../src/lib/keys";
import {
  createPasskeyMaster,
  MASTER_PRF_SALT,
  masterFromPrf,
  passkeyErrorMessage,
  unlockPasskeyMaster,
} from "../src/lib/passkey";

/**
 * A fake platform authenticator with a synced keychain: each passkey holds a
 * secret, and its PRF is HMAC-SHA256(secret, rpId ‖ salt) — deterministic per
 * credential, relying party and salt, like WebAuthn's hmac-secret.
 */
function fakeKeychain(options: { prf?: boolean } = {}) {
  const passkeys = new Map<string, { secret: Uint8Array; rpId: string }>();
  let counter = 0;
  const prf = (secret: Uint8Array, rpId: string, salt: Uint8Array) =>
    hmac(
      sha256,
      secret,
      new Uint8Array([...new TextEncoder().encode(rpId), ...salt]),
    );

  const device = (): WebAuthnClient => ({
    async createCredential(request) {
      counter += 1;
      const id = new Uint8Array(16).fill(counter);
      const secret = sha256(new TextEncoder().encode(`passkey-${counter}`));
      passkeys.set(bytesToHex(id), { secret, rpId: request.rp.id });
      return {
        credentialId: id,
        transports: ["internal", "hybrid"],
        prfEnabled: options.prf !== false,
        prfOutput:
          options.prf === false
            ? undefined
            : prf(secret, request.rp.id, request.prfSalt),
      };
    },
    async getCredential(request) {
      const wanted = request.allowCredential
        ? bytesToHex(request.allowCredential.credentialId)
        : [...passkeys.keys()][0];
      const passkey = wanted ? passkeys.get(wanted) : undefined;
      if (!passkey || passkey.rpId !== request.rpId) {
        throw new Error("NotAllowedError");
      }
      return {
        credentialId: new Uint8Array(
          wanted.match(/../g)!.map((h) => Number.parseInt(h, 16)),
        ),
        prfOutput:
          options.prf === false
            ? undefined
            : prf(passkey.secret, request.rpId, request.prfSalt),
      };
    },
  });
  return { passkeys, device };
}

const RP = "mawee.xyz";

describe("passkey-derived privacy keys (Mera PRF)", () => {
  it("re-derives the same note and viewing keys on a second device", async () => {
    const keychain = fakeKeychain();
    const laptop = keychain.device();
    const phone = keychain.device(); // same synced passkeys, fresh browser

    const created = await createPasskeyMaster({
      userName: "dinar@example.com",
      rpId: RP,
      webAuthnClient: laptop,
    });
    const restored = await unlockPasskeyMaster({
      record: created.record,
      rpId: RP,
      webAuthnClient: phone,
    });

    expect(bytesToHex(restored)).toBe(bytesToHex(created.master));
    const a = deriveNoteSecrets(created.master);
    const b = deriveNoteSecrets(restored);
    expect(b.ownerSecret).toBe(a.ownerSecret);
    expect(bytesToHex(b.viewSk)).toBe(bytesToHex(a.viewSk));
    // Only public metadata leaves the device.
    expect(Object.keys(created.record).sort()).toEqual([
      "credentialId",
      "transports",
    ]);
  });

  it("uses a Mawee-specific salt and HKDF, not the raw PRF output", async () => {
    const seen: Uint8Array[] = [];
    const keychain = fakeKeychain();
    const base = keychain.device();
    const spy: WebAuthnClient = {
      createCredential: (request) => {
        seen.push(request.prfSalt);
        return base.createCredential(request);
      },
      getCredential: base.getCredential,
    };
    const { master } = await createPasskeyMaster({
      userName: "u",
      rpId: RP,
      webAuthnClient: spy,
    });
    expect(bytesToHex(seen[0])).toBe(bytesToHex(MASTER_PRF_SALT));
    expect(bytesToHex(MASTER_PRF_SALT)).not.toBe(
      bytesToHex(sha256(new TextEncoder().encode("mera.prf.salt.v1"))),
    );
    const raw = new Uint8Array(32).fill(9);
    expect(bytesToHex(masterFromPrf(raw))).not.toBe(bytesToHex(raw));
    expect(master).toHaveLength(32);
  });

  it("derives unrelated keys for different passkeys and different sites", async () => {
    const keychain = fakeKeychain();
    const device = keychain.device();
    const first = await createPasskeyMaster({
      userName: "a",
      rpId: RP,
      webAuthnClient: device,
    });
    const second = await createPasskeyMaster({
      userName: "b",
      rpId: RP,
      webAuthnClient: device,
    });
    expect(bytesToHex(first.master)).not.toBe(bytesToHex(second.master));

    const other = await createPasskeyMaster({
      userName: "a",
      rpId: "localhost",
      webAuthnClient: fakeKeychain().device(),
    });
    expect(bytesToHex(other.master)).not.toBe(bytesToHex(first.master));
  });

  it("refuses a different passkey than the one registered", async () => {
    const keychain = fakeKeychain();
    const device = keychain.device();
    const mine = await createPasskeyMaster({
      userName: "a",
      rpId: RP,
      webAuthnClient: device,
    });
    const other = await createPasskeyMaster({
      userName: "b",
      rpId: RP,
      webAuthnClient: device,
    });
    const lying: WebAuthnClient = {
      createCredential: device.createCredential,
      // Authenticator answers with another credential than requested.
      getCredential: (request) =>
        device.getCredential({
          ...request,
          allowCredential: {
            credentialId: new Uint8Array(
              Buffer.from(other.record.credentialId, "base64url"),
            ),
          },
        }),
    };
    await expect(
      unlockPasskeyMaster({
        record: mine.record,
        rpId: RP,
        webAuthnClient: lying,
      }),
    ).rejects.toThrow("doesn't belong to your Mawee account");
  });

  it("explains authenticators without PRF support", async () => {
    const device = fakeKeychain({ prf: false }).device();
    const error = await createPasskeyMaster({
      userName: "a",
      rpId: RP,
      webAuthnClient: device,
    }).catch((e) => e);
    expect(passkeyErrorMessage(error)).toMatch(/can't derive keys/);
    expect(passkeyErrorMessage(error)).toMatch(/PIN/);
  });
});
