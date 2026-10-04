// @vitest-environment node
const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  current: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  bootstrapWallet: mocks.bootstrap,
  currentWallet: mocks.current,
  restoreWallet: mocks.restore,
  getEscrow: vi.fn(),
  rotateEscrow: vi.fn(),
  saveEscrow: vi.fn(),
}));

import { getAddress } from "viem";
import { walletsRouter } from "../src/server/modules/wallets/wallets.router";

const claim = {
  app_id: "app",
  issuer: "privy.io",
  issued_at: 1,
  expiration: 2,
  session_id: "session",
  user_id: "did:privy:user",
};
const caller = walletsRouter.createCaller({
  ip: null,
  authToken: "token",
  privyUserId: claim.user_id,
  privyClaim: claim,
  authError: null,
});

const WALLET = getAddress("0x5a0b54d5dc17e0aadc383d2db43b0a0d3e029c4c");

describe("wallet bootstrap router", () => {
  it("restores an old account from the authenticated Privy identity", async () => {
    mocks.restore.mockResolvedValue({ address: WALLET });

    await expect(caller.restore()).resolves.toEqual({ address: WALLET });
    expect(mocks.restore).toHaveBeenCalledWith(claim.user_id);
  });

  it("derives identity from protected context and checksums the wallet", async () => {
    mocks.bootstrap.mockResolvedValue({ address: WALLET });
    const result = await caller.bootstrap({ address: WALLET.toLowerCase() });
    expect(mocks.bootstrap).toHaveBeenCalledWith(claim.user_id, {
      address: WALLET,
    });
    expect(result.address).toBe(WALLET);
  });

  it("rejects a non-EVM wallet address", async () => {
    await expect(caller.bootstrap({ address: "GABCDEF" })).rejects.toThrow();
  });
});
