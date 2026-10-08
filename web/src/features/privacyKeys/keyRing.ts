import { bytesToHex, ownerPk, toBE32, viewPubkey } from "../../lib/crypto";
import type { LocalAccount } from "../../lib/notes";
import {
  assertKeyGeneration,
  derivePrivacyAccount,
  MAX_KEY_GENERATIONS,
} from "./keyDerivation";
import type {
  LocalPrivacyKeyring,
  PrivacyKeyState,
  PublicKeyPair,
} from "./types";

export async function privacyAccountPubkeys(
  account: LocalAccount,
): Promise<PublicKeyPair> {
  return {
    notePubkey: `0x${bytesToHex(toBE32(await ownerPk(account.ownerSecret)))}`,
    viewPubkey: `0x${bytesToHex(viewPubkey(account.viewSk))}`,
  };
}

export function samePublicKeys(a: PublicKeyPair, b: PublicKeyPair): boolean {
  return (
    a.notePubkey.toLowerCase() === b.notePubkey.toLowerCase() &&
    a.viewPubkey.toLowerCase() === b.viewPubkey.toLowerCase()
  );
}

export function erasePrivacyAccounts(
  accounts: ReadonlyMap<number, LocalAccount>,
): void {
  for (const account of accounts.values()) {
    account.viewSk.fill(0);
    account.ownerSecret = 0n;
  }
}

export async function derivePrivacyKeyring(
  root: Uint8Array,
  state: PrivacyKeyState,
): Promise<LocalPrivacyKeyring> {
  assertKeyGeneration(state.activeGeneration);
  if (
    state.version !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1 ||
    state.generations.length !== state.activeGeneration + 1 ||
    state.generations.length > MAX_KEY_GENERATIONS
  ) {
    throw new Error("Privacy key history is incomplete or invalid");
  }
  const accounts = new Map<number, LocalAccount>(),
    pairs = new Set<string>();
  try {
    for (let id = 0; id < state.generations.length; id++) {
      const entry = state.generations[id];
      if (entry.id !== id)
        throw new Error("Privacy key history must retain every generation");
      const account = derivePrivacyAccount(root, id);
      accounts.set(id, account);
      const derived = await privacyAccountPubkeys(account);
      const pair = `${derived.notePubkey}:${derived.viewPubkey}`;
      if (pairs.has(pair) || !samePublicKeys(derived, entry))
        throw new Error(
          "Recovery keys do not match confirmed privacy key history",
        );
      pairs.add(pair);
    }
    return {
      owner: state.owner,
      registry: state.registry,
      revision: state.revision,
      activeGeneration: state.activeGeneration,
      accounts,
    };
  } catch (error) {
    erasePrivacyAccounts(accounts);
    throw error;
  }
}

export function accountForGeneration(
  ring: LocalPrivacyKeyring,
  id: number,
): LocalAccount {
  assertKeyGeneration(id);
  const account = ring.accounts.get(id);
  if (!account) throw new Error("Privacy key generation is unavailable");
  return account;
}

export function accountForNote(
  ring: LocalPrivacyKeyring,
  note: { keyGeneration?: number },
): LocalAccount {
  return accountForGeneration(ring, note.keyGeneration ?? 0);
}

export async function accountForParticipant(
  ring: LocalPrivacyKeyring,
  participant: PublicKeyPair,
): Promise<LocalAccount> {
  for (const account of ring.accounts.values()) {
    if (samePublicKeys(await privacyAccountPubkeys(account), participant))
      return account;
  }
  throw new Error(
    "Captured participant keys are unavailable in this privacy key session",
  );
}
export async function accountForParticipants(
  account: LocalAccount,
  participants: readonly PublicKeyPair[],
  ring: LocalPrivacyKeyring | null,
): Promise<LocalAccount> {
  const own = await privacyAccountPubkeys(account);
  if (participants.some((participant) => samePublicKeys(own, participant)))
    return account;
  if (ring) {
    for (const participant of participants) {
      for (const candidate of ring.accounts.values()) {
        if (samePublicKeys(await privacyAccountPubkeys(candidate), participant))
          return candidate;
      }
    }
  }
  throw new Error("Captured participant key pair is unavailable");
}
