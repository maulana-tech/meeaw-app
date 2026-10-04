// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const WALLET = "0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c";
const mapping = { address: WALLET };

const mocks = vi.hoisted(() => ({
  authenticated: true,
  unstableHookValues: false,
  user: { id: "did:privy:user", linkedAccounts: [] },
  login: vi.fn(),
  logout: vi.fn(async () => {}),
  createWallet: vi.fn(),
  wallets: [] as { walletClientType: string; address: string }[],
  findWallet: vi.fn(),
  current: vi.fn(),
  restore: vi.fn(),
  bootstrap: vi.fn(),
  getEscrow: vi.fn(),
  replace: vi.fn(),
  usernameOf: vi.fn(),
  clearLocalAccount: vi.fn(),
  syncLocalAccountIdentity: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: true,
    authenticated: mocks.authenticated,
    user: mocks.unstableHookValues
      ? { ...mocks.user, linkedAccounts: [...mocks.user.linkedAccounts] }
      : mocks.user,
    login: mocks.login,
    logout: mocks.logout,
  }),
  useWallets: () => ({
    ready: true,
    wallets: mocks.unstableHookValues ? [...mocks.wallets] : mocks.wallets,
  }),
  useCreateWallet: () => ({
    createWallet: mocks.unstableHookValues
      ? (...args: Parameters<typeof mocks.createWallet>) =>
          mocks.createWallet(...args)
      : mocks.createWallet,
  }),
}));

vi.mock("next/navigation", () => {
  const router = { replace: mocks.replace };
  return { useRouter: () => router };
});

vi.mock("../src/lib/privy-wallet", () => ({
  findEmbeddedWallet: mocks.findWallet,
  privySigner: vi.fn(async () => ({ address: WALLET })),
}));

vi.mock("../src/trpc/client", () => ({
  api: {
    wallets: {
      current: { query: mocks.current },
      restore: { mutate: mocks.restore },
      bootstrap: { mutate: mocks.bootstrap },
      getEscrow: { query: mocks.getEscrow },
      saveEscrow: { mutate: vi.fn() },
    },
  },
}));

vi.mock("../src/lib/notes", () => ({
  hasLocalAccount: () => true,
  deriveAndStoreAccount: vi.fn(),
  accountPubkeys: vi.fn(),
  clearLocalAccount: mocks.clearLocalAccount,
  syncLocalAccountIdentity: mocks.syncLocalAccountIdentity,
}));

vi.mock("../src/lib/chain", () => ({
  usernameOf: mocks.usernameOf,
  registerUsernameCache: vi.fn(),
  setUsernamePubkeys: vi.fn(),
}));

import { useWallet, WalletProvider } from "../src/components/WalletProvider";

function Probe() {
  const { address, error, sessionReady, signIn, disconnect } = useWallet();
  return (
    <div>
      <div data-testid="address">{address || "none"}</div>
      <div data-testid="error">{error || "none"}</div>
      <div data-testid="ready">{sessionReady ? "yes" : "no"}</div>
      <button type="button" onClick={signIn}>
        Retry
      </button>
      <button type="button" onClick={disconnect}>
        Disconnect
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated = true;
  mocks.unstableHookValues = false;
  mocks.wallets = [{ walletClientType: "privy", address: WALLET }];
  mocks.findWallet.mockImplementation(
    (wallets: { walletClientType: string }[]) =>
      wallets.find((w) => w.walletClientType === "privy") ?? null,
  );
  mocks.createWallet.mockResolvedValue({ address: WALLET });
  mocks.current.mockResolvedValue(mapping);
  mocks.restore.mockResolvedValue(mapping);
  mocks.bootstrap.mockResolvedValue(mapping);
  mocks.getEscrow.mockResolvedValue({
    encryptedMasterHex: "aa",
    masterSaltHex: "bb",
    kdfParams: { m: 1, t: 1, p: 1 },
  });
  mocks.usernameOf.mockResolvedValue("alice");
});

describe("WalletProvider Privy session", () => {
  it("restores the account mapped to the Privy identity", async () => {
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent(WALLET),
    );
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("yes"),
    );
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.findWallet).not.toHaveBeenCalled();
    expect(mocks.createWallet).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("does not restart setup when Privy returns unstable hook identities", async () => {
    mocks.unstableHookValues = true;
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent(WALLET),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.restore).toHaveBeenCalledTimes(1);
    expect(mocks.current).not.toHaveBeenCalled();
    expect(mocks.createWallet).not.toHaveBeenCalled();
  });

  it("automatically bootstraps a new Privy identity", async () => {
    mocks.restore.mockResolvedValue(null);
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent(WALLET),
    );
    expect(mocks.bootstrap).toHaveBeenCalledWith({ address: WALLET });
    expect(mocks.createWallet).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("creates the embedded wallet when Privy has not provisioned one", async () => {
    mocks.restore.mockResolvedValue(null);
    mocks.wallets = [];
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent(WALLET),
    );
    expect(mocks.createWallet).toHaveBeenCalledTimes(1);
    expect(mocks.bootstrap).toHaveBeenCalledWith({ address: WALLET });
  });

  it("retries automatic bootstrap after a recoverable failure", async () => {
    mocks.restore.mockResolvedValue(null);
    mocks.bootstrap
      .mockRejectedValueOnce(new Error("bootstrap unavailable"))
      .mockResolvedValueOnce(mapping);
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    expect(await screen.findByTestId("error")).toHaveTextContent(
      "bootstrap unavailable",
    );
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(await screen.findByTestId("address")).toHaveTextContent(WALLET);
    expect(mocks.bootstrap).toHaveBeenCalledTimes(2);
    expect(mocks.createWallet).not.toHaveBeenCalled();
  });

  it("logs out and clears local wallet state", async () => {
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    expect(await screen.findByTestId("address")).toHaveTextContent(WALLET);
    await userEvent.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(mocks.logout).toHaveBeenCalledTimes(1);
    expect(mocks.clearLocalAccount).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("none"),
    );
  });
});
