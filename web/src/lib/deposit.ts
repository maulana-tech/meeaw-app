import { type DepositLifecycle, poolDeposit, type Signer } from "./chain";
import {
  commitment,
  encryptNote,
  fromBE,
  R,
  randomFieldElement,
  toBE32,
} from "./crypto";
import type { PoolDescriptor } from "./pools";
import { proveDeposit } from "./prover";

export type NoteRecipient = {
  /** Poseidon note public key from the registry (32 bytes, big-endian). */
  notePubkey: Uint8Array;
  /** x25519 viewing public key from the registry. */
  viewPubkey: Uint8Array;
};

/**
 * Pay `units` from `signer` into a private note only `recipient` can find and
 * spend: commit to (amount, ownerPk, salt), prove the commitment matches the
 * public amount, encrypt the note to the viewing key, then deposit.
 */
export async function payIntoNote(
  signer: Signer,
  recipient: NoteRecipient,
  units: bigint,
  pool?: PoolDescriptor,
  isCurrent: () => boolean = () => true,
  fixed?: {
    salt: bigint;
    envelope?: { ephemeralPk: Uint8Array; ciphertext: Uint8Array };
    lifecycle?: DepositLifecycle;
  },
): Promise<{ leafIndex: number; txHash: string }> {
  if (!isCurrent())
    throw new Error("The payment selection changed. Review again.");
  const salt = fixed?.salt ?? randomFieldElement();
  if (
    fixed &&
    (salt < 0n ||
      salt >= R ||
      (fixed.envelope &&
        (fixed.envelope.ephemeralPk.length !== 32 ||
          fixed.envelope.ciphertext.length !== 88)))
  )
    throw new Error("The invoice note is invalid. Reload this invoice.");
  const ownerPkField = fromBE(recipient.notePubkey);
  const note = toBE32(await commitment(units, ownerPkField, salt));
  const { proof } = await proveDeposit({
    commitment: fromBE(note).toString(),
    amount: units.toString(),
    ownerPk: ownerPkField.toString(),
    salt: salt.toString(),
  });
  const { ephemeralPk, ciphertext } =
    fixed?.envelope ?? encryptNote(recipient.viewPubkey, units, salt);
  if (!isCurrent())
    throw new Error("The payment selection changed. Review again.");
  const args = [
    signer,
    note,
    units,
    proof,
    ephemeralPk,
    ciphertext,
    pool,
    isCurrent,
  ] as const;
  return fixed?.lifecycle
    ? poolDeposit(...args, fixed.lifecycle)
    : poolDeposit(...args);
}
