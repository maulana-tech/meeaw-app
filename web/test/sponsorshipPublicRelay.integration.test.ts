import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";

const state = vi.hoisted(() => ({
  runtime: null as unknown,
  invalid: false,
  simulations: 0,
  wait: null as null | ((hash: `0x${string}`) => Promise<TransactionReceipt>),
}));
vi.mock("../src/server/lib/durableRelayer", async (original) => ({
  ...(await original<typeof import("../src/server/lib/durableRelayer")>()),
  runtimeSender: async () => state.runtime,
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({
    simulateContract: async () => {
      state.simulations++;
      if (state.invalid) throw Error("InvalidSignature");
    },
    waitForTransactionReceipt: async ({ hash }: { hash: `0x${string}` }) =>
      state.wait?.(hash),
  }),
}));
vi.mock("../src/lib/chain", () => ({
  chain: { id: 143 },
  rpcUrl: "http://127.0.0.1:8545",
  poolAddress: "0x2222222222222222222222222222222222222222",
  registryAddress: "0x3333333333333333333333333333333333333333",
  usdcMintable: true,
  revertErrorName: () => null,
}));
vi.mock("../src/lib/pools", () => ({
  activePool: () => ({
    scope: "143:0x2222222222222222222222222222222222222222",
    address: "0x2222222222222222222222222222222222222222",
    role: "active",
  }),
  findPool: () => null,
}));

import { maweePoolAbi } from "../src/lib/abi";
import { __resetRateLimit } from "../src/server/lib/rateLimit";
import { relayRouter } from "../src/server/modules/relay/relay.router";

const guest = {
  ip: "127.0.0.1",
  authToken: null,
  privyUserId: null,
  privyClaim: null,
  authError: null,
};
const hash = `0x${"a".repeat(64)}` as const;
const recipient = "0x1111111111111111111111111111111111111111";
const proof = {
  a: ["1", "2"],
  b: [
    ["3", "4"],
    ["5", "6"],
  ],
  c: ["7", "8"],
} as {
  a: [string, string];
  b: [[string, string], [string, string]];
  c: [string, string];
};
const withdrawal = {
  recipient,
  amount: "10",
  root: hash,
  nullifier: hash,
  proof,
};
let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
function fixture() {
  if (!f) throw new Error("Missing isolated sponsorship fixture");
  return f;
}
beforeEach(async () => {
  f = await createSponsorSenderFixture();
  state.invalid = false;
  state.simulations = 0;
  __resetRateLimit();
  vi.stubEnv("RELAYER_PRIVATE_KEY", `0x${"01".repeat(32)}`);
  await f.a.cancelUnsigned(f.action);
  f.port.prepare.mockImplementation(async (i, nonce) => ({
    ...fixture().frozen,
    to: i.to,
    data: i.data,
    nonce,
  }));
  state.runtime = {
    sender: f.sender,
    journal: f.journal,
    budget: { ledger: f.a },
  };
  state.wait = async (hash) => {
    fixture().setReceipt(hash);
    return {
      ...(await fixture().port.receipt(hash)),
      logs: [],
    } as TransactionReceipt;
  };
});
afterEach(async () => {
  await f?.close();
  f = undefined;
  vi.unstubAllEnvs();
});
describe("public relay with authoritative sponsorship ledger", () => {
  it("keeps anonymous withdrawals inside the shared daily quota across destinations", async () => {
    fixture().policy.anonymousLimit = 1;
    const caller = relayRouter.createCaller(guest);
    await caller.withdraw(withdrawal);
    await expect(
      caller.withdraw({
        ...withdrawal,
        recipient: "0x4444444444444444444444444444444444444444",
        nullifier: `0x${"b".repeat(64)}`,
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      cause: { reason: "quota" },
    });
    expect(fixture().port.sign).toHaveBeenCalledTimes(1);
  });
  it("sponsors a guest deposit and records anonymous-subset and global spending", async () => {
    const topics = encodeEventTopics({
      abi: maweePoolAbi,
      eventName: "Deposit",
      args: { leafIndex: 0 },
    });
    state.wait = async (txHash) => {
      fixture().setReceipt(txHash);
      return {
        ...(await fixture().port.receipt(txHash)),
        logs: [
          {
            topics,
            data: encodeAbiParameters(
              [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }],
              [hash, hash, "0x12"],
            ),
          },
        ],
      } as TransactionReceipt;
    };
    await expect(
      relayRouter.createCaller(guest).deposit({
        payer: recipient,
        commitment: hash,
        amount: "10",
        proof,
        ephemeralPk: hash,
        ciphertext: "0x12",
        deadline: "9999999999",
        signature: `0x${"11".repeat(65)}`,
        permit: null,
      }),
    ).resolves.toMatchObject({ leafIndex: 0 });
    const ledger = await fixture().a.repo.snapshot(143);
    expect(BigInt(ledger.anonymousUsedWeiStr)).toBeGreaterThan(0n);
    expect(ledger.usedWeiStr).toBe(ledger.anonymousUsedWeiStr);
    expect(
      await fixture().a.status({ kind: "guest-wallet", key: recipient }),
    ).toMatchObject({ used: 1, reserved: 0 });
  });
  it("does not acquire a claimed payer quota when signature preflight fails", async () => {
    state.invalid = true;
    await expect(
      relayRouter.createCaller(guest).deposit({
        payer: recipient,
        commitment: hash,
        amount: "10",
        proof,
        ephemeralPk: hash,
        ciphertext: "0x12",
        deadline: "9999999999",
        signature: `0x${"11".repeat(65)}`,
        permit: null,
      }),
    ).rejects.toThrow();
    expect(
      await fixture().a.status({ kind: "guest-wallet", key: recipient }),
    ).toMatchObject({ used: 0, reserved: 0 });
    expect(fixture().port.sign).not.toHaveBeenCalled();
  });
  it("replays a withdrawal with fresh proof randomness without another signature or quota", async () => {
    const caller = relayRouter.createCaller(guest);
    const result = await caller.withdraw(withdrawal);
    state.invalid = true;
    expect(
      await caller.withdraw({
        ...withdrawal,
        proof: { ...proof, a: ["9", "10"] },
      }),
    ).toEqual(result);
    expect(fixture().port.sign).toHaveBeenCalledTimes(1);
    expect(state.simulations).toBe(1);
    expect(
      await fixture().a.status({ kind: "anonymous", key: "shared" }),
    ).toMatchObject({ used: 1, reserved: 0 });
  });
});
