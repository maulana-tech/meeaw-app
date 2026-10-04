import { poolDeposit, type Signer } from "./chain";
import {
  commitment,
  encryptNote,
  fromBE,
  randomFieldElement,
  toBE32,
} from "./crypto";
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
): Promise<{ leafIndex: number; txHash: string }> {
  const salt = randomFieldElement();
  const ownerPkField = fromBE(recipient.notePubkey);
  const note = toBE32(await commitment(units, ownerPkField, salt));
  const { proof } = await proveDeposit({
    commitment: fromBE(note).toString(),
    amount: units.toString(),
    ownerPk: ownerPkField.toString(),
    salt: salt.toString(),
  });
  const { ephemeralPk, ciphertext } = encryptNote(
    recipient.viewPubkey,
    units,
    salt,
  );
  return poolDeposit(signer, note, units, proof, ephemeralPk, ciphertext);
}
