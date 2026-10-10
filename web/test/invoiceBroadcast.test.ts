import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetPool } from "./helpers/multiAssetFixtures";

const mock = vi.hoisted(() => ({
  allowance: vi.fn(async () => 100n),
  wait: vi.fn(),
  status: vi.fn(async () => ({ enabled: false })),
  relay: vi.fn(),
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({
    readContract: mock.allowance,
    waitForTransactionReceipt: mock.wait,
  }),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    relay: { status: { query: mock.status }, deposit: { mutate: mock.relay } },
  },
}));

import { poolDeposit, type Signer } from "../src/lib/chain";

const hash = `0x${"a".repeat(64)}` as const;
const proof = {
  a: [0n, 0n] as [bigint, bigint],
  b: [
    [0n, 0n],
    [0n, 0n],
  ] as [[bigint, bigint], [bigint, bigint]],
  c: [0n, 0n] as [bigint, bigint],
};
beforeEach(() => {
  mock.wait.mockReset().mockRejectedValue(new Error("receipt timeout"));
  mock.allowance.mockReset().mockResolvedValue(100n);
  mock.status.mockReset().mockResolvedValue({ enabled: false });
});
describe("invoice broadcast boundaries", () => {
  it("records the hash before a receipt wait fails", async () => {
    const events: string[] = [];
    const writeContract = vi.fn(async () => {
      events.push("write");
      return hash;
    });
    const signer = {
      address: `0x${"1".repeat(40)}`,
      walletClient: { writeContract },
    } as unknown as Signer;
    const lifecycle = {
      onSubmitting: () => events.push("before"),
      onSubmitted: (value: string) => {
        expect(value).toBe(hash);
        events.push("hash");
      },
    };
    await expect(
      poolDeposit(
        signer,
        new Uint8Array(32),
        1n,
        proof,
        new Uint8Array(32),
        new Uint8Array(88),
        assetPool("AUSD"),
        () => true,
        lifecycle,
      ),
    ).rejects.toThrow("receipt timeout");
    expect(events).toEqual(["before", "write", "hash"]);
    expect(writeContract).toHaveBeenCalledOnce();
  });
  it("does not broadcast when attempt persistence fails", async () => {
    const writeContract = vi.fn(async () => hash),
      signer = {
        address: `0x${"1".repeat(40)}`,
        walletClient: { writeContract },
      } as unknown as Signer;
    await expect(
      poolDeposit(
        signer,
        new Uint8Array(32),
        1n,
        proof,
        new Uint8Array(32),
        new Uint8Array(88),
        assetPool("AUSD"),
        () => true,
        {
          onSubmitting: () => {
            throw new Error("storage blocked");
          },
        },
      ),
    ).rejects.toThrow("storage blocked");
    expect(writeContract).not.toHaveBeenCalled();
  });
});
