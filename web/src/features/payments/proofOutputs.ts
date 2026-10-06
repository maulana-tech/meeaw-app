import { toHex } from "viem";
import { commitment, encryptNote, toBE32 } from "../../lib/crypto";
import type { EvmProof } from "../../lib/prover";
import type { NoteOutput, ProofWire } from "../requests/types";
export function proofWire(p: EvmProof): ProofWire {
  return {
    a: p.a.map(String) as [string, string],
    b: p.b.map((row) => row.map(String)) as [
      [string, string],
      [string, string],
    ],
    c: p.c.map(String) as [string, string],
  };
}
export async function createNoteOutput(
  amount: bigint,
  pk: bigint,
  view: Uint8Array,
  salt: bigint,
): Promise<NoteOutput> {
  const encrypted = encryptNote(view, amount, salt);
  return {
    commitment: toHex(toBE32(await commitment(amount, pk, salt))),
    ephemeralPk: toHex(encrypted.ephemeralPk),
    ciphertext: toHex(encrypted.ciphertext),
  };
}
