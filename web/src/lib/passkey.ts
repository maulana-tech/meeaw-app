// Passkey-derived privacy keys (Mera PRF).
//
// One passkey ceremony with a Mawee-specific PRF salt yields 32 bytes that
// depend only on the passkey, the relying party (this site) and the salt.
// We HKDF that into the account master, from which keys.ts derives the
// Poseidon note secret and the x25519 viewing key. Nothing secret is stored
// anywhere: the same synced passkey re-derives the same keys on any device.

import {
  createPasskeyWithPrfOutput,
  getPasskeyPrfOutput,
  isMeraError,
  type WebAuthnClient,
} from "@category-labs/mera";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

const utf8 = (s: string) => new TextEncoder().encode(s);

/**
 * PRF salt namespace for the Mawee privacy master. Distinct from Mera's
 * default salt, so the same passkey used elsewhere yields unrelated output.
 */
export const MASTER_PRF_SALT = sha256(utf8("mawee.prf.privacy-master.v1"));
const MASTER_INFO = utf8("mawee.master.passkey.v1");

export type PasskeyRecord = {
  credentialId: string;
  transports: string[];
};

/** HKDF the raw PRF output into the account master (domain-separated). */
export function masterFromPrf(prfOutput: Uint8Array): Uint8Array {
  if (prfOutput.length !== 32) throw new Error("PRF output must be 32 bytes");
  return hkdf(sha512, prfOutput, undefined, MASTER_INFO, 32);
}

/** Passkeys are scoped to the site's host; dev (localhost) ≠ production. */
export function currentRpId(): string {
  return window.location.hostname;
}

/** Creates a new passkey and derives the account master from it. */
export async function createPasskeyMaster(options: {
  userName: string;
  rpId?: string;
  webAuthnClient?: WebAuthnClient;
}): Promise<{ master: Uint8Array; record: PasskeyRecord }> {
  const result = await createPasskeyWithPrfOutput({
    rp: { id: options.rpId ?? currentRpId(), name: "Mawee" },
    user: { name: options.userName, displayName: options.userName },
    prfSalt: MASTER_PRF_SALT,
    webAuthnClient: options.webAuthnClient,
  });
  try {
    return {
      master: masterFromPrf(result.prfOutput),
      record: {
        credentialId: result.credentialId,
        transports: [...(result.transports ?? [])],
      },
    };
  } finally {
    result.prfOutput.fill(0);
  }
}

/** Re-derives the account master from the registered passkey. */
export async function unlockPasskeyMaster(options: {
  record: PasskeyRecord;
  rpId?: string;
  webAuthnClient?: WebAuthnClient;
}): Promise<Uint8Array> {
  const result = await getPasskeyPrfOutput({
    rpId: options.rpId ?? currentRpId(),
    credential: {
      credentialId: options.record.credentialId,
      transports: options.record.transports,
    },
    prfSalt: MASTER_PRF_SALT,
    webAuthnClient: options.webAuthnClient,
  });
  try {
    if (result.credentialId !== options.record.credentialId) {
      throw new PasskeyMismatchError();
    }
    return masterFromPrf(result.prfOutput);
  } finally {
    result.prfOutput.fill(0);
  }
}

export class PasskeyMismatchError extends Error {
  constructor() {
    super(
      "This passkey doesn't belong to your Mawee account. Choose the passkey you created for Mawee.",
    );
    this.name = "PasskeyMismatchError";
  }
}

/** Whether this browser exposes WebAuthn at all (PRF is checked on use). */
export function passkeysAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential !== "undefined"
  );
}

/** Turns Mera/WebAuthn failures into guidance a user can act on. */
export function passkeyErrorMessage(error: unknown): string {
  if (error instanceof PasskeyMismatchError) return error.message;
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return "This passkey provider can't derive keys. Use iCloud Keychain, Google Password Manager, or 1Password — or protect your account with a PIN instead.";
      case "PASSKEY_OPERATION_FAILED":
        return "The passkey request was cancelled or isn't available in this browser. Try again.";
      case "CRYPTO_UNAVAILABLE":
        return "This browser is missing the cryptography passkeys need. Try an up-to-date browser.";
      default:
        return "The passkey request failed. Try again.";
    }
  }
  return error instanceof Error ? error.message : "The passkey request failed.";
}

/** Mirrors WalletProvider.promptUnlock: passkey accounts re-derive, others use PIN. */
export function unlockLabel(method: "passkey" | "pin" | null): string {
  return method === "passkey" ? "Unlock with passkey" : "Unlock with PIN";
}
