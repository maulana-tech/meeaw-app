import { env } from "../env";
import { isSpent } from "./chain";
import {
  bytesToHex,
  commitment,
  decryptNote,
  fromBE,
  nullifier,
  ownerPk,
  TREE_DEPTH,
  toBE32,
  viewPubkey,
} from "./crypto";
import { deriveNoteSecrets } from "./keys";
import {
  loadPoolMirror,
  type PoolMirror,
  refreshPoolMirror,
} from "./poolMirror";
import { activePool, type PoolDescriptor, type PoolScope } from "./pools";

const USERNAME_KEY = "mawee.username";
const IDENTITY_KEY = "mawee.privyUserId";

export type LocalAccount = { ownerSecret: bigint; viewSk: Uint8Array };

/// Note secrets live in this module's memory for the lifetime of the tab and
/// are never written to localStorage, sessionStorage, IndexedDB, cookies or
/// the server (Mera: "nothing sensitive persisted to disk"). The recoverable
/// master stays in the argon2id-encrypted PIN escrow, or is re-derived from
/// the passkey's PRF — so a reload re-locks the account and the same passkey
/// (or PIN) rebuilds the identical keys on any device.
let sessionAccount: LocalAccount | null = null;

export function getAccount(): LocalAccount | null {
  if (typeof window === "undefined") return null;
  return sessionAccount;
}

/// True while this tab holds unlocked note secrets in memory. WalletProvider
/// uses this to decide whether a restored session still needs to unlock its
/// master: after a reload it is false, so the passkey/PIN prompt reappears.
export function hasLocalAccount(): boolean {
  return sessionAccount !== null;
}

export function clearLocalAccount(): void {
  sessionAccount = null;
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(USERNAME_KEY);
}

export function syncLocalAccountIdentity(privyUserId: string | null): void {
  if (typeof window === "undefined") return;
  const previous = window.localStorage.getItem(IDENTITY_KEY);
  if (previous !== privyUserId) clearLocalAccount();
  if (privyUserId) window.localStorage.setItem(IDENTITY_KEY, privyUserId);
  else window.localStorage.removeItem(IDENTITY_KEY);
}

/// Derive the deterministic note secrets from the recoverable master and hold
/// them in memory for this tab. The same master always yields the same
/// owner/view keypair (see deriveNoteSecrets), so a re-derive on any device
/// reproduces the exact pubkeys registered on-chain — that is what makes
/// balances recoverable without ever persisting a secret.
export function deriveAndStoreAccount(master: Uint8Array): LocalAccount {
  const { ownerSecret, viewSk } = deriveNoteSecrets(master);
  sessionAccount = { ownerSecret, viewSk };
  return sessionAccount;
}

export async function accountPubkeys(
  acct: LocalAccount,
): Promise<{ notePubkey: Uint8Array; viewPubkey: Uint8Array }> {
  return {
    notePubkey: toBE32(await ownerPk(acct.ownerSecret)),
    viewPubkey: viewPubkey(acct.viewSk),
  };
}

export function setStoredUsername(username: string): void {
  window.localStorage.setItem(USERNAME_KEY, username);
}

export type MyNote = {
  /** The pool this note lives in; leaf indices are only unique per pool. */
  scope: PoolScope;
  leafIndex: number;
  amount: bigint;
  salt: bigint;
  spent: boolean;
  receivedAt?: string;
  spentAt?: string;
};
export type ScanResult = {
  scope: PoolScope;
  notes: MyNote[];
  leaves: bigint[];
  claimable: bigint;
  mirrorAvailable: boolean;
  indexedAt: string;
  health: "healthy" | "stale" | "degraded";
};

/// Scan one pool (the active pool by default), decrypting each deposit; the
/// ones that decrypt are ours. Also returns that pool's full ordered leaf set
/// needed to build Merkle proofs. Never mix results from different pools.
export async function scanMyNotes(
  acct: LocalAccount,
  options: { refresh?: boolean; pool?: PoolDescriptor; includeRequestRecovery?:boolean } = {},
): Promise<ScanResult> {
  const pool = options.pool ?? activePool();
  const mirror =
    options.refresh === false
      ? await loadPoolMirror(pool)
      : await refreshPoolMirror(pool);
  const scan=await scanMirrorForAccount(acct, mirror, pool);
  if(options.includeRequestRecovery){
    const {recoverPaidRequestOutputs}=await import("../features/requests/requestNoteRecovery");
    return recoverPaidRequestOutputs(acct,pool,scan);
  }
  return scan;
}

async function scanMirrorForAccount(
  acct: LocalAccount,
  mirror: PoolMirror,
  pool: PoolDescriptor,
): Promise<ScanResult> {
  const deposits = mirror.deposits;
  const spentNullifiers = new Set(mirror.spentNullifiers);
  const spentAtByNullifier = mirror.spentAtByNullifier ?? {};
  const leaves: bigint[] = [];
  for (const d of deposits) leaves[d.leafIndex] = fromBE(d.commitment);

  const myPk = await ownerPk(acct.ownerSecret);
  const debug = env.NODE_ENV !== "production";
  if (debug) {
    // Derived pubkeys must equal what's registered for your username in the
    // registry/Mongo. If these don't match, the payer encrypted to keys this
    // browser can't decrypt → notes are invisible and the balance stays 0.
    console.info("[mawee] scan", {
      deposits: deposits.length,
      myViewPubkey_b64: btoa(String.fromCharCode(...viewPubkey(acct.viewSk))),
      myNotePubkey_b64: btoa(String.fromCharCode(...toBE32(myPk))),
    });
  }
  const notes: MyNote[] = [];
  // Notes the event mirror believes are unspent still need on-chain
  // confirmation (see below) — collect their nullifier bytes as we go.
  const unverified: { note: MyNote; nullifierBytes: Uint8Array }[] = [];
  for (const d of deposits) {
    const dec = decryptNote(acct.viewSk, d.ephemeralPk, d.ciphertext);
    if (!dec) {
      if (debug)
        console.info(`[mawee] leaf ${d.leafIndex}: not mine (decrypt)`);
      continue;
    }
    // Belt-and-suspenders: the recomputed commitment must match the leaf.
    if (
      (await commitment(dec.amount, myPk, dec.salt)) !== fromBE(d.commitment)
    ) {
      if (debug)
        console.warn(
          `[mawee] leaf ${d.leafIndex}: decrypted but commitment mismatch — owner key differs from the one registered at pay time`,
        );
      continue;
    }
    if (debug) console.info(`[mawee] leaf ${d.leafIndex}: MINE`);
    const nullifierBytes = toBE32(
      await nullifier(acct.ownerSecret, d.leafIndex),
    );
    const nullifierHex = bytesToHex(nullifierBytes);
    const spent = spentNullifiers.has(nullifierHex);
    const note: MyNote = {
      scope: pool.scope,
      leafIndex: d.leafIndex,
      amount: dec.amount,
      salt: dec.salt,
      spent,
      receivedAt: d.receivedAt,
      spentAt: spent ? spentAtByNullifier[nullifierHex] : undefined,
    };
    notes.push(note);
    if (!spent) unverified.push({ note, nullifierBytes });
  }

  // The spent-nullifier mirror is indexed from pool events, which testnet RPC
  // only retains for ~24h; a withdraw whose `spend` event ages out before it's
  // indexed is lost from the mirror forever (there's no nullifier integrity
  // backstop). That surfaces an already-cashed-out note as claimable and makes
  // the next withdraw trap with the pool's DoubleSpend (Error #7). Confirm every
  // mirror-"unspent" note against the contract's on-chain nullifier set — the
  // source of truth — so phantom notes never reach a withdraw.
  await Promise.all(
    unverified.map(async ({ note, nullifierBytes }) => {
      try {
        if (await isSpent(nullifierBytes, pool)) note.spent = true;
      } catch {
        // A failed view leaves the mirror's optimistic value; the pool still
        // rejects an actual double-spend on-chain.
      }
    }),
  );

  const claimable = notes
    .filter((n) => !n.spent)
    .reduce((s, n) => s + n.amount, 0n);
  return {
    scope: pool.scope,
    notes,
    leaves,
    claimable,
    mirrorAvailable: mirror.hydrated,
    indexedAt: mirror.indexedAt,
    health: mirror.health,
  };
}

export { TREE_DEPTH };
