import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  requestDigest,
  requestTypedData,
  submissionDigest,
} from "../src/features/requests/requestTypedData";
import { wireRequestFixture } from "./helpers/requestFixtures";

describe("request signatures", () => {
  it("binds each immutable envelope, identity, scope and commitment", () => {
    const r = wireRequestFixture();
    const digest = requestDigest(r);
    for (const changed of [
      { ...r, id: "00000000-0000-4000-8000-000000000002" },
      {
        ...r,
        pool: "31337:0x4444444444444444444444444444444444444444" as const,
      },
      { ...r, requester: { ...r.requester, username: "carol" } },
      { ...r, addresseeEnvelope: r.requesterEnvelope },
      { ...r, createdAt: "2026-10-06T00:00:00.000Z" },
    ])
      expect(requestDigest(changed)).not.toBe(digest);
    expect(requestDigest({ ...r, signature: "0x12" })).toBe(digest);
  });
  it("round-trips wallet signing with the same typed data", async () => {
    const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const r = wireRequestFixture();
    r.requester.wallet = signer.address;
    const signature = await signer.signTypedData(requestTypedData(r));
    expect(
      await verifyTypedData({
        address: signer.address,
        ...requestTypedData(r),
        signature,
      }),
    ).toBe(true);
  });
  it("binds submission output ciphertext as well as proof and step", () => {
    const r = wireRequestFixture();
    const body = {
      version: 1 as const,
      requestId: r.id,
      operationId: r.id,
      step: 0,
      pool: r.pool,
      kind: "payment" as const,
      root: r.recipientCommitment,
      nullifiers: [r.recipientCommitment],
      proof: {
        a: ["1", "2"] as const,
        b: [
          ["3", "4"],
          ["5", "6"],
        ] as const,
        c: ["7", "8"] as const,
      },
      outputs: [{ commitment: r.recipientCommitment, ...r.requesterEnvelope }],
    };
    const digest = submissionDigest(body);
    expect(submissionDigest({ ...body, step: 1 })).not.toBe(digest);
    expect(
      submissionDigest({
        ...body,
        outputs: [{ ...body.outputs[0], ciphertext: "0x1234" }],
      }),
    ).not.toBe(digest);
  });
});
