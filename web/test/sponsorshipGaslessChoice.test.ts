import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  withdraw: vi.fn(),
  write: vi.fn(),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    relay: {
      status: { query: mocks.status },
      withdraw: { mutate: mocks.withdraw },
    },
  },
}));
vi.mock("viem", async (original) => ({
  ...(await original<typeof import("viem")>()),
  createPublicClient: () => ({
    simulateContract: async (request: unknown) => ({ request }),
    waitForTransactionReceipt: async () => ({ status: "success" }),
  }),
}));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.write.mockResolvedValue(`0x${"a".repeat(64)}`);
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
});
it("does not silently pay wallet gas when configuration availability cannot be checked", async () => {
  const { poolWithdraw } = await import("../src/lib/chain");
  mocks.status.mockRejectedValueOnce(Error("offline"));
  const signer = {
    address: "0x1111111111111111111111111111111111111111",
    walletClient: { writeContract: mocks.write },
  } as unknown as import("../src/lib/chain").Signer;
  await expect(
    poolWithdraw(
      signer,
      signer.address,
      1n,
      new Uint8Array(32),
      new Uint8Array(32),
      {
        a: [1n, 2n],
        b: [
          [1n, 2n],
          [1n, 2n],
        ],
        c: [1n, 2n],
      },
    ),
  ).rejects.toThrow(/availability|check|gasless/i);
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.withdraw).not.toHaveBeenCalled();
});
it("refreshes configuration between actions instead of keeping a permanent boolean", async () => {
  const { gaslessEnabled } = await import("../src/lib/chain");
  mocks.status
    .mockResolvedValueOnce({ enabled: true })
    .mockResolvedValueOnce({ enabled: false });
  expect(await gaslessEnabled()).toBe(true);
  expect(await gaslessEnabled()).toBe(false);
});
it("keeps an uncertain cash-out marker and starts a fresh explicit action after a canonical revert", async () => {
  const { poolWithdraw } = await import("../src/lib/chain");
  mocks.status.mockResolvedValue({ enabled: true });
  const args = [
    null,
    "0x1111111111111111111111111111111111111111",
    1n,
    new Uint8Array(32),
    new Uint8Array(32),
    {
      a: [1n, 2n],
      b: [
        [1n, 2n],
        [1n, 2n],
      ],
      c: [1n, 2n],
    },
  ] as const;
  mocks.withdraw
    .mockRejectedValueOnce(Error("network timeout"))
    .mockRejectedValueOnce({
      data: {
        relayOutcome: { state: "reverted", txHash: `0x${"a".repeat(64)}` },
      },
    })
    .mockResolvedValueOnce({ txHash: `0x${"b".repeat(64)}` });
  await expect(poolWithdraw(...args)).rejects.toThrow();
  await expect(poolWithdraw(...args)).rejects.toBeDefined();
  await poolWithdraw(...args);
  const inputs = mocks.withdraw.mock.calls.map((call) => call[0]);
  expect(inputs[0].id).toMatch(/^[0-9a-f-]{36}$/);
  expect(inputs[1].id).toBe(inputs[0].id);
  expect(inputs[2].id).not.toBe(inputs[0].id);
});
it("does not submit another account's proof after it switches during the availability check", async () => {
  const { poolWithdraw } = await import("../src/lib/chain");
  let current = true,
    finish: (value: { enabled: boolean }) => void = () => {};
  mocks.status.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mocks.withdraw.mockResolvedValueOnce({ txHash: `0x${"a".repeat(64)}` });
  const pending = poolWithdraw(
    null,
    "0x1111111111111111111111111111111111111111",
    1n,
    new Uint8Array(32),
    new Uint8Array(32),
    {
      a: [1n, 2n],
      b: [
        [1n, 2n],
        [1n, 2n],
      ],
      c: [1n, 2n],
    },
    undefined,
    undefined,
    () => current,
  );
  current = false;
  finish({ enabled: true });
  await expect(pending).rejects.toThrow(/account|session/i);
  expect(mocks.withdraw).not.toHaveBeenCalled();
  expect(mocks.write).not.toHaveBeenCalled();
});
