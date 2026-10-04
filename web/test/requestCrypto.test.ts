import { describe, expect, it, vi } from "vitest";
import {
  createSignedRequest,
  openRequest,
  RequestUnreadableError,
  sealRequest,
} from "../src/features/requests/requestCrypto";
import { requestTypedData } from "../src/features/requests/requestTypedData";
import type { SignedRequest } from "../src/features/requests/types";
import {
  makeRequestFixture,
  testParticipant,
  testPool,
  testSigner,
} from "./helpers/requestFixtures";

async function resign(record: SignedRequest, seed = 1): Promise<SignedRequest> {
  const signer = testSigner(seed);
  const signature = await signer.walletClient.signTypedData({
    account: signer.walletClient.account ?? signer.address,
    ...requestTypedData(record),
  });
  return { ...record, signature };
}

// Poseidon setup is slow on a loaded runner; these use real crypto, not mocks.
describe("request envelopes", { timeout: 30_000 }, () => {
  it("opens for both participants and rejects outsiders", async () => {
    const f = await makeRequestFixture();
    expect(await openRequest(f.record, f.requester, f.pool)).toEqual(f.payload);
    expect(await openRequest(f.record, f.addressee, f.pool)).toEqual(f.payload);
    await expect(openRequest(f.record, f.outsider, f.pool)).rejects.toThrow(
      RequestUnreadableError,
    );
  });

  it("uses independent ephemeral keys and nonces per envelope and per seal", async () => {
    const f = await makeRequestFixture();
    const again = sealRequest(f.payload);
    expect(f.record.requesterEnvelope.ephemeralPk).not.toBe(
      f.record.addresseeEnvelope.ephemeralPk,
    );
    expect(again.requesterEnvelope.ciphertext).not.toBe(
      f.record.requesterEnvelope.ciphertext,
    );
    expect(again.addresseeEnvelope.ephemeralPk).not.toBe(
      f.record.addresseeEnvelope.ephemeralPk,
    );
  });

  it("keeps ciphertext length independent of note length", async () => {
    const lengths = new Set<number>();
    for (const note of ["", "hi", "🙂".repeat(200), "\u0000".repeat(200)]) {
      const f = await makeRequestFixture({ note });
      lengths.add(f.record.requesterEnvelope.ciphertext.length);
      lengths.add(f.record.addresseeEnvelope.ciphertext.length);
      expect((await openRequest(f.record, f.addressee, f.pool)).note).toBe(
        note,
      );
    }
    expect([...lengths]).toEqual([2 + 2 * 4136]);
  });

  it("rejects a tampered signature", async () => {
    const f = await makeRequestFixture();
    await expect(
      openRequest(
        { ...f.record, signature: (await resign(f.record, 9)).signature },
        f.addressee,
        f.pool,
      ),
    ).rejects.toThrow(RequestUnreadableError);
  });

  it("rejects a re-signed record whose metadata no longer matches the envelope AAD", async () => {
    const f = await makeRequestFixture();
    const altered = await resign({
      ...f.record,
      createdAt: "2026-10-06T00:00:00.000Z",
    });
    await expect(openRequest(altered, f.addressee, f.pool)).rejects.toThrow(
      RequestUnreadableError,
    );
  });

  it("rejects swapped envelopes and wrong pool scope", async () => {
    const f = await makeRequestFixture();
    const swapped = await resign({
      ...f.record,
      requesterEnvelope: f.record.addresseeEnvelope,
      addresseeEnvelope: f.record.requesterEnvelope,
    });
    await expect(openRequest(swapped, f.addressee, f.pool)).rejects.toThrow(
      RequestUnreadableError,
    );
    await expect(
      openRequest(f.record, f.addressee, {
        ...f.pool,
        scope: "31337:0x9999999999999999999999999999999999999999",
        address: "0x9999999999999999999999999999999999999999",
      }),
    ).rejects.toThrow(RequestUnreadableError);
  });

  it("rejects a payload whose amount disagrees with the recipient commitment", async () => {
    const f = await makeRequestFixture();
    const sealed = sealRequest({ ...f.payload, amount: "1" });
    const forged = await resign({ ...f.record, ...sealed });
    await expect(openRequest(forged, f.addressee, f.pool)).rejects.toThrow(
      RequestUnreadableError,
    );
  });

  it("refuses self requests, wrong signers and oversize notes on creation", async () => {
    const alice = await testParticipant("alice", 1);
    const bob = await testParticipant("bob", 2);
    const base = {
      id: "00000000-0000-4000-8000-0000000000b1",
      pool: testPool,
      requester: alice,
      addressee: bob,
      amount: 5n,
      note: "",
      createdAt: "2026-10-05T00:00:00.000Z",
    };
    await expect(
      createSignedRequest({ ...base, addressee: alice }, testSigner(1)),
    ).rejects.toThrow();
    await expect(createSignedRequest(base, testSigner(2))).rejects.toThrow();
    await expect(
      createSignedRequest({ ...base, note: "x".repeat(201) }, testSigner(1)),
    ).rejects.toThrow();
    await expect(
      createSignedRequest({ ...base, amount: 1n << 64n }, testSigner(1)),
    ).rejects.toThrow();
  });

  it("never puts plaintext in errors or logs", async () => {
    const note = "secret-invoice-note";
    const f = await makeRequestFixture({ note, amount: 123_456_789n });
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (m) => vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const error = await openRequest(f.record, f.outsider, f.pool).catch(
      (e: unknown) => e as Error,
    );
    await openRequest(f.record, f.addressee, f.pool);
    const logged = spies.flatMap((s) => s.mock.calls.flat().map(String));
    for (const s of spies) s.mockRestore();
    const text = `${error.message} ${String(error.cause ?? "")} ${logged.join(" ")}`;
    expect(text).not.toContain(note);
    expect(text).not.toContain("123456789");
    expect(text).not.toContain(f.payload.salt);
  });
});
