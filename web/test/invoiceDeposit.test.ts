import { x25519 } from "@noble/curves/ed25519.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptNote, fromBE, R, toBE32 } from "../src/lib/crypto";

const mock = vi.hoisted(() => ({ prove: vi.fn(), deposit: vi.fn() }));
vi.mock("../src/lib/chain", () => ({ poolDeposit: mock.deposit }));
vi.mock("../src/lib/prover", () => ({ proveDeposit: mock.prove }));

import { payIntoNote } from "../src/lib/deposit";

const recipient = {
  notePubkey: toBE32(5n),
  viewPubkey: x25519.getPublicKey(new Uint8Array(32).fill(1)),
};
const signer = {} as Parameters<typeof payIntoNote>[0];
beforeEach(() => {
  mock.prove.mockReset().mockResolvedValue({
    proof: {
      a: [0n, 0n],
      b: [
        [0n, 0n],
        [0n, 0n],
      ],
      c: [0n, 0n],
    },
  });
  mock.deposit
    .mockReset()
    .mockResolvedValue({ leafIndex: 0, txHash: `0x${"a".repeat(64)}` });
});
describe("invoice note deposit", () => {
  it("uses the invoice's fixed salt and canonical encrypted note", async () => {
    const envelope = encryptNote(recipient.viewPubkey, 2_500_000n, 7n);
    await payIntoNote(signer, recipient, 2_500_000n, undefined, () => true, {
      salt: 7n,
      envelope,
    });
    expect(mock.prove.mock.calls[0][0].salt).toBe("7");
    expect(mock.deposit.mock.calls[0][4]).toEqual(envelope.ephemeralPk);
    expect(mock.deposit.mock.calls[0][5]).toEqual(envelope.ciphertext);
  });
  it("keeps regular payment links on fresh random notes", async () => {
    await payIntoNote(signer, recipient, 1n);
    await payIntoNote(signer, recipient, 1n);
    expect(mock.prove.mock.calls[0][0].salt).not.toBe(
      mock.prove.mock.calls[1][0].salt,
    );
    expect(fromBE(mock.deposit.mock.calls[0][1])).not.toBe(
      fromBE(mock.deposit.mock.calls[1][1]),
    );
  });
  it("rejects a salt outside the circuit field before proving", async () => {
    await expect(
      payIntoNote(signer, recipient, 1n, undefined, () => true, { salt: R }),
    ).rejects.toThrow(/invoice note/i);
    expect(mock.prove).not.toHaveBeenCalled();
  });
});
