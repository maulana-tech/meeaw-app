import { decryptMaster, deserializeEscrow } from "../../lib/keys";
import { unlockPasskeyMaster } from "../../lib/passkey";
import { BadPinError } from "../../lib/pin-errors";
import { api } from "../../trpc/client";
import { derivePrivacyAccount } from "./keyDerivation";
import {
  derivePrivacyKeyring,
  erasePrivacyAccounts,
  privacyAccountPubkeys,
} from "./keyRing";
import { installPrivacyKeyring } from "./session";
import type { LocalPrivacyKeyring, PrivacyKeyState } from "./types";

export async function reauthenticatePrivacyRoot(
  method: "pin" | "passkey",
  pin?: string,
): Promise<Uint8Array> {
  if (method === "pin") {
    const escrow = await api.wallets.getEscrow.query();
    if (!escrow) throw new Error("Your existing PIN recovery is unavailable");
    try {
      return decryptMaster(deserializeEscrow(escrow), pin ?? "");
    } catch {
      throw new BadPinError();
    }
  }
  const record = await api.wallets.getPasskey.query();
  if (!record) throw new Error("Your existing passkey recovery is unavailable");
  const root = await unlockPasskeyMaster({ record });
  const original = derivePrivacyAccount(root, 0);
  try {
    const keys = await privacyAccountPubkeys(original);
    if (keys.viewPubkey.slice(2) !== record.viewPubkeyHex.toLowerCase())
      throw new Error(
        "This passkey does not match your existing recovery identity",
      );
    return root;
  } catch (error) {
    root.fill(0);
    throw error;
  } finally {
    original.viewSk.fill(0);
    original.ownerSecret = 0n;
  }
}

export async function unlockPrivacyKeyring(
  root: Uint8Array,
  state: PrivacyKeyState,
  isCurrent: () => boolean = () => true,
): Promise<LocalPrivacyKeyring> {
  const verified = await api.privacyKeys.verifiedState.query();
  if (
    !verified ||
    verified.owner !== state.owner ||
    verified.registry !== state.registry ||
    verified.revision !== state.revision ||
    verified.activeGeneration !== state.activeGeneration ||
    JSON.stringify(verified.generations) !== JSON.stringify(state.generations)
  )
    throw new Error(
      "Privacy key history changed during unlock. Check again with your existing recovery.",
    );
  const ring = await derivePrivacyKeyring(root, verified);
  try {
    if (!isCurrent())
      throw new Error(
        "Wallet or lock state changed during privacy key recovery",
      );
    installPrivacyKeyring(ring);
    return ring;
  } catch (error) {
    erasePrivacyAccounts(ring.accounts);
    throw error;
  }
}
