import { hkdf } from "@noble/hashes/hkdf.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { fromBE, R } from "../../lib/crypto";
import { deriveNoteSecrets } from "../../lib/keys";
import type { LocalAccount } from "../../lib/notes";

export const MAX_KEY_GENERATIONS = 64;

export function assertKeyGeneration(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id >= MAX_KEY_GENERATIONS) {
    throw new Error("Privacy key generation must be an integer from 0 to 63");
  }
}

export function derivePrivacyAccount(
  root: Uint8Array,
  generation: number,
): LocalAccount {
  assertKeyGeneration(generation);
  if (root.length !== 32)
    throw new Error("Recovery root must contain 32 bytes");
  if (generation === 0) return deriveNoteSecrets(root);
  const utf8 = new TextEncoder();
  const ownerBytes = hkdf(
    sha512,
    root,
    undefined,
    utf8.encode(`mawee.privacy.owner.v1/generation/${generation}`),
    64,
  );
  try {
    return {
      ownerSecret: fromBE(ownerBytes) % R,
      viewSk: hkdf(
        sha512,
        root,
        undefined,
        utf8.encode(`mawee.privacy.view.v1/generation/${generation}`),
        32,
      ),
    };
  } finally {
    ownerBytes.fill(0);
  }
}
