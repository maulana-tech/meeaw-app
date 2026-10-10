import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGORA_DEPLOYMENTS } from "../src/lib/agora";
import { assetPool } from "./helpers/multiAssetFixtures";

const mock = vi.hoisted(() => ({ read: vi.fn(), relay: vi.fn() }));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({ readContract: mock.read }),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    relay: {
      status: { query: async () => ({ enabled: true }) },
      deposit: { mutate: mock.relay },
    },
  },
}));

import { poolDeposit, type Signer } from "../src/lib/chain";

const pool = {
  ...assetPool("AUSD"),
  chainId: 10143,
  token: AGORA_DEPLOYMENTS[10143],
  mintable: false,
};
const proof = {
  a: [0n, 0n] as [bigint, bigint],
  b: [
    [0n, 0n],
    [0n, 0n],
  ] as [[bigint, bigint], [bigint, bigint]],
  c: [0n, 0n] as [bigint, bigint],
};
beforeEach(() => {
  mock.read
    .mockReset()
    .mockImplementation(async ({ functionName, address }) => {
      if (functionName === "allowance") return 0n;
      if (functionName === "nonces") return address === pool.token ? 3n : 8n;
      if (functionName === "eip712Domain")
        return [
          "0x0f",
          "Agora Dollar",
          "1",
          10143n,
          pool.token,
          `0x${"0".repeat(64)}`,
          [],
        ];
      throw new Error("Unexpected token read");
    });
  mock.relay
    .mockReset()
    .mockResolvedValue({ leafIndex: 0, txHash: `0x${"a".repeat(64)}` });
});
describe("official AUSD gasless deposit", () => {
  it("signs the token's Agora Dollar domain instead of guessing from its AUSD symbol", async () => {
    const signTypedData = vi.fn(async () => `0x${"11".repeat(64)}1b`),
      signer = {
        address: `0x${"1".repeat(40)}`,
        walletClient: { signTypedData },
      } as unknown as Signer;
    await poolDeposit(
      signer,
      new Uint8Array(32),
      10_000_000n,
      proof,
      new Uint8Array(32),
      new Uint8Array(88),
      pool,
    );
    expect(signTypedData.mock.calls[0][0]).toMatchObject({
      domain: {
        name: "Agora Dollar",
        version: "1",
        chainId: 10143,
        verifyingContract: pool.token,
      },
      primaryType: "Permit",
      message: {
        owner: signer.address,
        spender: pool.address,
        value: 10_000_000n,
        nonce: 3n,
      },
    });
    expect(mock.relay).toHaveBeenCalledOnce();
    expect(mock.relay.mock.calls[0][0].permit.value).toBe("10000000");
  });
  it("does not sign or relay when the token domain is unavailable", async () => {
    mock.read.mockImplementation(async ({ functionName }) => {
      if (functionName === "allowance") return 0n;
      if (functionName === "nonces") return 0n;
      throw new Error("Token RPC unavailable");
    });
    const signTypedData = vi.fn(),
      signer = {
        address: `0x${"1".repeat(40)}`,
        walletClient: { signTypedData },
      } as unknown as Signer;
    await expect(
      poolDeposit(
        signer,
        new Uint8Array(32),
        1n,
        proof,
        new Uint8Array(32),
        new Uint8Array(88),
        pool,
      ),
    ).rejects.toThrow("Token RPC unavailable");
    expect(signTypedData).not.toHaveBeenCalled();
    expect(mock.relay).not.toHaveBeenCalled();
  });
});
