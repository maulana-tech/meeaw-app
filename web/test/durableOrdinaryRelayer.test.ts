import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as string[],
  result: "confirmed",
  simulateFail: false,
  replay: null as unknown,
  depositPrior: false,
  admitFail: false,
}));
const HASH = `0x${"11".repeat(32)}` as const;
vi.mock("../src/server/lib/durableRelayer", () => ({
  runtimeSender: async () => ({
    journal: { read: async () => state.replay },
    budget: {
      ledger: {
        findOrdinaryAction: async () => null,
        readAction: async (_chain: number, actionId: string) =>
          actionId === "deposit:test" && !state.depositPrior
            ? null
            : {
                intent: {
                  businessDigest: `0x${"11".repeat(32)}`,
                  kind: actionId === "deposit:test" ? "deposit" : "withdraw",
                  principal: { kind: "anonymous", key: "shared" },
                },
                fence: 1,
              },
        admit: async () => {
          if (state.admitFail) throw new Error("Budget rejected");
          return {
            chainId: 143,
            actionId: "withdraw:test",
            fence: 1,
          };
        },
        closeAction: async () => {},
      },
    },
    sender: {
      prepare: async () => {
        state.events.push("persist");
        return { txHash: `0x${"11".repeat(32)}` };
      },
      broadcast: async () => {
        state.events.push("raw-broadcast");
      },
      reconcile: async () => {
        state.events.push("reconcile");
        return {
          state: state.result,
          txHash: `0x${"11".repeat(32)}`,
          receipt: {
            status: state.result === "confirmed" ? "success" : "reverted",
          },
        };
      },
    },
  }),
}));
vi.mock("viem", async (original) => {
  const actual = await original<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      simulateContract: async () => {
        state.events.push("simulate");
        if (state.simulateFail) throw Error("InvalidProof");
        return { request: {} };
      },
      waitForTransactionReceipt: async () => {
        state.events.push("receipt");
        return { status: "success", transactionHash: `0x${"11".repeat(32)}` };
      },
    }),
    createWalletClient: () => ({
      writeContract: async () => {
        throw Error("Unsigned broadcast bypassed the durable journal");
      },
    }),
  };
});

import { maweePoolAbi } from "../src/lib/abi";
import { relayWrite } from "../src/server/lib/relayer";
import { RelayNotSubmittedError } from "../src/server/lib/relayOutcome.errors";

const request = {
  address: "0x2222222222222222222222222222222222222222" as const,
  abi: maweePoolAbi,
  functionName: "withdraw" as const,
  args: [
    "0x3333333333333333333333333333333333333333",
    1n,
    HASH,
    HASH,
    {
      a: [1n, 2n],
      b: [
        [3n, 4n],
        [5n, 6n],
      ],
      c: [7n, 8n],
    },
  ] as const,
};
const sponsor = {
  kind: "withdraw" as const,
  principal: { kind: "anonymous" as const, key: "shared" },
  identity: { actionId: "withdraw:test", businessDigest: HASH, childId: "one" },
};
beforeEach(() => {
  state.events = [];
  state.result = "confirmed";
  state.simulateFail = false;
  state.replay = null;
  state.depositPrior = false;
  state.admitFail = false;
  vi.stubEnv("RELAYER_PRIVATE_KEY", `0x${"11".repeat(32)}`);
});
describe("ordinary relay shared durability", () => {
  it("marks fresh deposit admission failures as not submitted", async () => {
    state.admitFail = true;
    const deposit = {
      address: request.address,
      abi: maweePoolAbi,
      functionName: "deposit" as const,
      args: [HASH, 1n, request.args[4], HASH, "0x1234"] as const,
    };
    await expect(
      relayWrite(deposit, {
        ...sponsor,
        kind: "deposit",
        identity: { ...sponsor.identity, actionId: "deposit:test" },
      }),
    ).rejects.toBeInstanceOf(RelayNotSubmittedError);
    expect(state.events).toEqual(["simulate"]);
  });
  it("does not mark an existing deposit operation as safe after uncertainty", async () => {
    state.depositPrior = true;
    state.admitFail = true;
    const deposit = {
      address: request.address,
      abi: maweePoolAbi,
      functionName: "deposit" as const,
      args: [HASH, 1n, request.args[4], HASH, "0x1234"] as const,
    };
    const error = await relayWrite(deposit, {
      ...sponsor,
      kind: "deposit",
      identity: { ...sponsor.identity, actionId: "deposit:test" },
    }).catch((error) => error);
    expect(error).not.toBeInstanceOf(RelayNotSubmittedError);
  });
  it("persists ordinary withdrawal sends before broadcasting", async () => {
    expect((await relayWrite(request, sponsor)).hash).toBe(HASH);
    expect(state.events).toEqual([
      "simulate",
      "persist",
      "raw-broadcast",
      "receipt",
      "reconcile",
    ]);
  });
  it("does not reserve or send a reverting proof", async () => {
    state.simulateFail = true;
    await expect(relayWrite(request, sponsor)).rejects.toThrow("InvalidProof");
    expect(state.events).toEqual(["simulate"]);
  });
  it("does not report a reverted receipt as success", async () => {
    state.result = "reverted";
    await expect(relayWrite(request, sponsor)).rejects.toThrow("reverted");
  });
  it("reconciles stored bytes before simulating a replay with a spent nullifier", async () => {
    state.replay = {
      serializedTransaction: "0x1234",
      txHash: HASH,
      intent: {
        operationKey: "ordinary:withdraw:test",
        chainId: 143,
        wallet: "0x1111111111111111111111111111111111111111",
        to: request.address,
        data: "0xab",
        confirmations: 1,
        sponsorship: {
          action: { chainId: 143, actionId: "withdraw:test", fence: 1 },
          childId: "one",
        },
      },
    };
    state.simulateFail = true;
    expect((await relayWrite(request, sponsor)).hash).toBe(HASH);
    expect(state.events).toEqual([
      "persist",
      "raw-broadcast",
      "receipt",
      "reconcile",
    ]);
  });
});
