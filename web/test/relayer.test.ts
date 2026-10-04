// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = `0x${"11".repeat(32)}`;

const mocks = vi.hoisted(() => ({
  http: vi.fn((url?: string) => ({ url })),
  simulate: vi.fn(),
  write: vi.fn(),
  receipt: vi.fn(),
  order: [] as string[],
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    http: mocks.http,
    createPublicClient: () => ({
      simulateContract: mocks.simulate,
      waitForTransactionReceipt: mocks.receipt,
    }),
    createWalletClient: () => ({ writeContract: mocks.write }),
  };
});

const request = {
  address: "0x00000000000000000000000000000000000000B0",
  abi: [],
  functionName: "withdraw",
  args: [],
} as never;

async function load() {
  vi.resetModules();
  return import("../src/server/lib/relayer");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  vi.stubEnv("RELAYER_PRIVATE_KEY", KEY);
  vi.stubEnv("RELAYER_RPC_URL", "https://monad-testnet.g.alchemy.com/v2/test");
  mocks.simulate.mockImplementation(async () => {
    mocks.order.push("simulate");
    return { request: { simulated: true } };
  });
  mocks.write.mockImplementation(async () => {
    mocks.order.push("write");
    return "0xhash";
  });
  mocks.receipt.mockImplementation(async () => {
    mocks.order.push("receipt");
    return { status: "success", logs: [] };
  });
});

describe("relayer", () => {
  it("simulates before sending and uses the dedicated relayer RPC", async () => {
    const { relayWrite } = await load();
    await expect(relayWrite(request)).resolves.toMatchObject({
      hash: "0xhash",
    });
    expect(mocks.order).toEqual(["simulate", "write", "receipt"]);
    expect(mocks.http).toHaveBeenCalledWith(
      "https://monad-testnet.g.alchemy.com/v2/test",
    );
    expect(mocks.write).toHaveBeenCalledWith({ simulated: true });
  });

  it("never sends a transaction whose simulation reverts", async () => {
    mocks.simulate.mockRejectedValue(new Error("InvalidProof"));
    const { relayWrite } = await load();
    await expect(relayWrite(request)).rejects.toThrow("InvalidProof");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("serializes concurrent sends so nonces never collide", async () => {
    let release: () => void = () => {};
    mocks.receipt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: "success", logs: [] });
        }),
    );
    const { relayWrite } = await load();
    const first = relayWrite(request);
    const second = relayWrite(request);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    // The second send waits until the first is mined.
    expect(mocks.simulate).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });

  it("keeps working after a failed send", async () => {
    mocks.simulate.mockRejectedValueOnce(new Error("boom"));
    const { relayWrite } = await load();
    await expect(relayWrite(request)).rejects.toThrow("boom");
    await expect(relayWrite(request)).resolves.toMatchObject({
      hash: "0xhash",
    });
  });

  it("reports a reverted receipt as a failure", async () => {
    mocks.receipt.mockResolvedValue({ status: "reverted", logs: [] });
    const { relayWrite } = await load();
    await expect(relayWrite(request)).rejects.toThrow("reverted");
  });

  it("is disabled without a key", async () => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "");
    const { relayerConfigured, relayWrite } = await load();
    expect(relayerConfigured()).toBe(false);
    await expect(relayWrite(request)).rejects.toThrow("not configured");
  });
});
