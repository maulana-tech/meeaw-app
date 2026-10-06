import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import {
  createSignedRequest,
  localParticipantKeys,
} from "../../src/features/requests/requestCrypto";
import type {
  Participant,
  PoolDescriptor,
  RequestPayload,
  SignedRequest,
} from "../../src/features/requests/types";
import type { Signer } from "../../src/lib/chain";
import type { LocalAccount } from "../../src/lib/notes";

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

export const testPool: PoolDescriptor = {
  scope: "31337:0x1111111111111111111111111111111111111111",
  chainId: 31337,
  address: "0x1111111111111111111111111111111111111111",
  deployBlock: 0,
  token: "0x5555555555555555555555555555555555555555",
  tokenDecimals: 6,
  depth: 20,
  confirmations: 1,
  role: "active",
  requestCapable: true,
  transferCapable: true,
  asset: "USDC",
  mintable: true,
};

/** Deterministic, test-only account: never reuse these secrets elsewhere. */
export function testAccount(seed: number): LocalAccount {
  return {
    ownerSecret: BigInt(1000 + seed),
    viewSk: new Uint8Array(32).fill(seed),
  };
}

export function testSigner(seed: number): Signer {
  const account = privateKeyToAccount(
    `0x${seed.toString(16).padStart(2, "0").repeat(32)}`,
  );
  return {
    address: account.address,
    walletClient: createWalletClient({
      account,
      chain: hardhat,
      // Local accounts sign in-process; no request reaches this URL.
      transport: http("http://127.0.0.1:1"),
    }),
  };
}

export async function testParticipant(
  username: string,
  seed: number,
): Promise<Participant> {
  return {
    username,
    wallet: testSigner(seed).address.toLowerCase() as `0x${string}`,
    ...(await localParticipantKeys(testAccount(seed))),
  };
}

export async function makeRequestFixture(
  overrides: { amount?: bigint; note?: string } = {},
): Promise<{
  record: SignedRequest;
  payload: RequestPayload;
  requester: LocalAccount;
  addressee: LocalAccount;
  outsider: LocalAccount;
  requesterSigner: Signer;
  pool: PoolDescriptor;
}> {
  const requesterSigner = testSigner(1);
  const { record, payload } = await createSignedRequest(
    {
      id: "00000000-0000-4000-8000-0000000000a1",
      pool: testPool,
      requester: await testParticipant("alice", 1),
      addressee: await testParticipant("bob", 2),
      amount: overrides.amount ?? 20_000_000n,
      note: overrides.note ?? "Dinner 🍜",
      createdAt: "2026-10-05T00:00:00.000Z",
    },
    requesterSigner,
  );
  return {
    record,
    payload,
    requester: testAccount(1),
    addressee: testAccount(2),
    outsider: testAccount(3),
    requesterSigner,
    pool: testPool,
  };
}
