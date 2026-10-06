// @vitest-environment node
import { BaseError, ContractFunctionRevertedError } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { maweeRegistryAbi } from "../src/lib/abi";

const OWNER = "0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c";
const SIG = `0x${"11".repeat(65)}`;
const B32 = `0x${"22".repeat(32)}`;

const mocks = vi.hoisted(() => ({
  relayWrite: vi.fn(),
  configured: true,
  currentWallet: vi.fn(),
  verifiedPrivyWallets: vi.fn(),
}));

vi.mock("../src/server/lib/relayer", () => ({
  relayWrite: mocks.relayWrite,
  relayerConfigured: () => mocks.configured,
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: mocks.currentWallet,
  verifiedPrivyWallets: mocks.verifiedPrivyWallets,
}));
vi.mock("../src/lib/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/chain")>();
  return {
    ...actual,
    registryAddress: "0x00000000000000000000000000000000000000A0",
    poolAddress: "0x00000000000000000000000000000000000000B0",
    usdcAddress: "0x00000000000000000000000000000000000000C0",
    usdcMintable: true,
  };
});

import { __resetRateLimit } from "../src/server/lib/rateLimit";
import { relayRouter } from "../src/server/modules/relay/relay.router";

function caller(privyUserId: string | null = "did:privy:user", ip = "1.2.3.4") {
  return relayRouter.createCaller({
    ip,
    authToken: privyUserId ? "token" : null,
    privyUserId,
    privyClaim: privyUserId
      ? {
          app_id: "app",
          issuer: "privy.io",
          issued_at: 1,
          expiration: 2,
          session_id: "s",
          user_id: privyUserId,
        }
      : null,
    authError: null,
  });
}

const registerInput = {
  username: "dinar",
  notePubkey: B32,
  viewPubkey: B32,
  deadline: "1999999999",
  signature: SIG,
};

const proof = {
  a: ["1", "2"] as [string, string],
  b: [
    ["3", "4"],
    ["5", "6"],
  ] as [[string, string], [string, string]],
  c: ["7", "8"] as [string, string],
};

function revert(errorName: string) {
  const inner = new ContractFunctionRevertedError({
    abi: maweeRegistryAbi,
    functionName: "registerFor",
    data: undefined,
  });
  Object.defineProperty(inner, "data", { value: { errorName } });
  return new BaseError("reverted", { cause: inner });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimit();
  mocks.configured = true;
  mocks.currentWallet.mockResolvedValue({ address: OWNER });
  mocks.relayWrite.mockResolvedValue({ hash: "0xhash", receipt: { logs: [] } });
});

describe("relay router", () => {
  it("reports whether gasless mode is available", async () => {
    await expect(caller(null).status()).resolves.toEqual({
      enabled: true,
      testUsdcMintable: true,
    });
    mocks.configured = false;
    await expect(caller(null).status()).resolves.toMatchObject({
      enabled: false,
    });
  });

  it("registers only for the signed-in user's bound wallet", async () => {
    await expect(caller().register(registerInput)).resolves.toEqual({
      txHash: "0xhash",
    });
    const request = mocks.relayWrite.mock.calls[0][0];
    expect(request.functionName).toBe("registerFor");
    // The owner comes from the server-side wallet binding, never the client.
    expect(request.args[0]).toBe(OWNER);
    expect(request.args[1]).toBe("dinar");
  });

  it("uses setPubkeysFor when rotating keys", async () => {
    await caller().register({ ...registerInput, rotate: true });
    expect(mocks.relayWrite.mock.calls[0][0].functionName).toBe(
      "setPubkeysFor",
    );
  });

  it("requires a Privy session to register", async () => {
    await expect(caller(null).register(registerInput)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(mocks.relayWrite).not.toHaveBeenCalled();
  });

  it("refuses to register when no wallet is bound", async () => {
    mocks.currentWallet.mockResolvedValue(null);
    await expect(caller().register(registerInput)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mocks.relayWrite).not.toHaveBeenCalled();
  });

  it("relays a withdrawal without any user identity", async () => {
    await expect(
      caller(null).withdraw({
        recipient: OWNER.toLowerCase(),
        amount: "5000000",
        root: B32,
        nullifier: B32,
        proof,
      }),
    ).resolves.toEqual({ txHash: "0xhash" });
    const request = mocks.relayWrite.mock.calls[0][0];
    expect(request.functionName).toBe("withdraw");
    expect(request.args[0]).toBe(OWNER);
    expect(request.args[1]).toBe(5_000_000n);
    expect(request.args[4].a).toEqual([1n, 2n]);
  });

  it("withdraws from a configured pool scope and refuses unknown pools", async () => {
    const { activePool } = await import("../src/lib/pools");
    const base = {
      recipient: OWNER,
      amount: "1",
      root: B32,
      nullifier: B32,
      proof,
    };
    await caller(null).withdraw({ ...base, pool: activePool().scope });
    expect(mocks.relayWrite.mock.calls[0][0].address).toBe(
      activePool().address,
    );

    await expect(
      caller(null).withdraw({
        ...base,
        pool: "10143:0x00000000000000000000000000000000000000c0",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Unknown pool." });
    expect(mocks.relayWrite).toHaveBeenCalledTimes(1);
  });

  it("translates contract reverts into user-facing errors", async () => {
    mocks.relayWrite.mockRejectedValue(revert("DoubleSpend"));
    await expect(
      caller(null).withdraw({
        recipient: OWNER,
        amount: "1",
        root: B32,
        nullifier: B32,
        proof,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This payment was already cashed out.",
    });
  });

  it("reports an unconfigured relayer as a precondition failure", async () => {
    mocks.configured = false;
    await expect(
      caller(null).withdraw({
        recipient: OWNER,
        amount: "1",
        root: B32,
        nullifier: B32,
        proof,
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.relayWrite).not.toHaveBeenCalled();
  });

  it("rate-limits relayed withdrawals per IP", async () => {
    const input = {
      recipient: OWNER,
      amount: "1",
      root: B32,
      nullifier: B32,
      proof,
    };
    for (let i = 0; i < 30; i += 1)
      await caller(null, "9.9.9.9").withdraw(input);
    await expect(caller(null, "9.9.9.9").withdraw(input)).rejects.toMatchObject(
      {
        code: "TOO_MANY_REQUESTS",
      },
    );
    // A different client is unaffected.
    await expect(caller(null, "8.8.8.8").withdraw(input)).resolves.toBeTruthy();
  });

  it("rejects malformed calldata before touching the relayer", async () => {
    await expect(
      caller(null).withdraw({
        recipient: "GABC",
        amount: "1",
        root: B32,
        nullifier: B32,
        proof,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller(null).withdraw({
        recipient: OWNER,
        amount: "-1",
        root: B32,
        nullifier: B32,
        proof,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.relayWrite).not.toHaveBeenCalled();
  });

  it("mints test USDC to the bound wallet only", async () => {
    await caller().mintTestUsdc();
    const request = mocks.relayWrite.mock.calls[0][0];
    expect(request.functionName).toBe("mint");
    expect(request.args[0]).toBe(OWNER);
  });

  it("mints to a payer's verified Privy wallet when there is no Mawee wallet", async () => {
    const PAYER = "0x00000000000000000000000000000000000000Fa";
    mocks.currentWallet.mockResolvedValue(null);
    mocks.verifiedPrivyWallets.mockResolvedValue([{ address: PAYER }]);
    await caller().mintTestUsdc();
    expect(mocks.relayWrite.mock.calls[0][0].args[0]).toBe(PAYER);
  });

  it("refuses to mint when the identity has no wallet at all", async () => {
    mocks.currentWallet.mockResolvedValue(null);
    mocks.verifiedPrivyWallets.mockResolvedValue([]);
    await expect(caller().mintTestUsdc()).rejects.toBeTruthy();
    expect(mocks.relayWrite).not.toHaveBeenCalled();
  });
});
