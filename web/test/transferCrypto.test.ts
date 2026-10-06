import { describe, expect, it } from "vitest";
import {
  createSignedTransfer,
  openTransfer,
  openTransferEnvelope,
} from "../src/features/transfers/transferCrypto";
import {
  transferMetadataHash,
  transferTypedData,
} from "../src/features/transfers/transferTypedData";
import { concatBytes } from "@noble/hashes/utils.js";
import { hexToBytes, verifyTypedData } from "viem";
import {
  parseTransferAmount,
  validateTransferNote,
  transferPayloadSchema,
  signedTransferSchema,
} from "../src/features/transfers/validation";
import { poseidonHash, toBE32 } from "../src/lib/crypto";
import { toHex } from "viem";
import {
  testAccount,
  testParticipant,
  testPool,
  testSigner,
} from "./helpers/requestFixtures";

async function fixture(note = "Lunch 🍜") {
  const record = await createSignedTransfer({
    id: "00000000-0000-4000-8000-0000000000a1",
    pool: testPool,
    sender: await testParticipant("alice", 1),
    recipient: await testParticipant("bob", 2),
    account: testAccount(1),
    signer: testSigner(1),
    amount: 20_000_000n,
    note,
    createdAt: "2026-10-06T00:00:00.000Z",
  });
  return record;
}

describe("direct transfer envelopes", { timeout: 30_000 }, () => {
  it("lets both participants read the amount and note without exposing them in the record", async () => {
    const r = await fixture();
    expect(
      await verifyTypedData({
        address: r.sender.wallet,
        ...transferTypedData(r),
        signature: r.signature,
      }),
    ).toBe(true);
    const raw = openTransferEnvelope(
      r.senderEnvelope,
      testAccount(1),
      concatBytes(Uint8Array.of(1), hexToBytes(transferMetadataHash(r))),
    ) as { amount: string };
    expect(raw.amount).toBe("20000000");
    const parsed = transferPayloadSchema.parse(raw);
    signedTransferSchema.parse(r);
    expect(transferMetadataHash(parsed.metadata)).toBe(transferMetadataHash(r));
    expect(
      toHex(
        toBE32(
          await poseidonHash([
            BigInt(parsed.amount),
            BigInt(r.recipient.notePubkey),
            BigInt(parsed.salt),
          ]),
        ),
      ),
    ).toBe(r.recipientCommitment);
    const sender = await openTransfer(r, testAccount(1), testPool);
    const recipient = await openTransfer(r, testAccount(2), testPool);
    expect(sender).toEqual(recipient);
    expect(recipient.amount).toBe("20000000");
    expect(recipient.note).toBe("Lunch 🍜");
    expect(JSON.stringify(r)).not.toContain("Lunch");
    await expect(openTransfer(r, testAccount(3), testPool)).rejects.toThrow();
  });
  it("rejects changed signed metadata and swapped envelopes", async () => {
    const r = await fixture();
    await expect(
      openTransfer(
        { ...r, createdAt: "2026-10-07T00:00:00.000Z" },
        testAccount(2),
        testPool,
      ),
    ).rejects.toThrow();
    await expect(
      openTransfer(
        { ...r, recipientEnvelope: r.senderEnvelope },
        testAccount(2),
        testPool,
      ),
    ).rejects.toThrow();
    await expect(
      openTransfer(r, testAccount(2), {
        ...testPool,
        scope: "31337:0x2222222222222222222222222222222222222222",
      }),
    ).rejects.toThrow();
  });
  it("pads short and long notes to the same ciphertext length with independent randomness", async () => {
    const empty = await fixture("");
    const full = await fixture("🍜".repeat(200));
    expect(empty.recipientEnvelope.ciphertext.length).toBe(
      full.recipientEnvelope.ciphertext.length,
    );
    expect(full.recipientEnvelope.ephemeralPk).not.toBe(
      full.senderEnvelope.ephemeralPk,
    );
  });
  it("rejects self transfer and mismatched local sender keys", async () => {
    const sender = await testParticipant("alice", 1);
    const input = {
      id: "00000000-0000-4000-8000-0000000000a1",
      pool: testPool,
      sender,
      recipient: sender,
      account: testAccount(1),
      signer: testSigner(1),
      amount: 1n,
      note: "",
      createdAt: "2026-10-06T00:00:00.000Z",
    };
    await expect(createSignedTransfer(input)).rejects.toThrow();
    await expect(
      createSignedTransfer({
        ...input,
        recipient: await testParticipant("bob", 2),
        account: testAccount(3),
      }),
    ).rejects.toThrow();
  });
});

describe("transfer input", () => {
  it("parses precise integer units without rounding", () => {
    expect(parseTransferAmount("20.000001", 6)).toBe(20_000_001n);
    for (const value of [
      "0",
      "-1",
      "1e3",
      "0.0000001",
      "18446744073709.551616",
    ])
      expect(() => parseTransferAmount(value, 6)).toThrow();
    expect(parseTransferAmount("18446744073709.551615", 6)).toBe(
      (1n << 64n) - 1n,
    );
  });
  it("counts emoji as one character and trims notes", () => {
    expect(validateTransferNote("  Lunch  ")).toBe("Lunch");
    expect(validateTransferNote("🍜".repeat(200))).toHaveLength(400);
    expect(() => validateTransferNote("🍜".repeat(201))).toThrow();
  });
});
