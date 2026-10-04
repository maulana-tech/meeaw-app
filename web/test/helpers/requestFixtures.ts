import type { SignedRequest } from "../../src/features/requests/types";
export function wireRequestFixture(): SignedRequest {
  const key = (n: string) => `0x${n.repeat(64)}` as const;
  return {
    version: 1,
    id: "00000000-0000-4000-8000-000000000001",
    pool: "31337:0x1111111111111111111111111111111111111111",
    requester: {
      username: "alice",
      wallet: "0x2222222222222222222222222222222222222222",
      notePubkey: key("1"),
      viewPubkey: key("2"),
    },
    addressee: {
      username: "bob",
      wallet: "0x3333333333333333333333333333333333333333",
      notePubkey: key("1"),
      viewPubkey: key("3"),
    },
    createdAt: "2026-10-05T00:00:00.000Z",
    recipientCommitment: key("1"),
    requesterEnvelope: {
      ephemeralPk: key("4"),
      ciphertext: `0x${"00".repeat(4136)}`,
    },
    addresseeEnvelope: {
      ephemeralPk: key("5"),
      ciphertext: `0x${"11".repeat(4136)}`,
    },
    signature: `0x${"11".repeat(65)}`,
  };
}
