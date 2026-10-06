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
  getPasskey: vi.fn(),
  savePasskey: vi.fn(),
  passkeysAvailable: false,
  createPasskeyMaster: vi.fn(),
  unlockPasskeyMaster: vi.fn(),
  hasLocal: true,
  deriveAndStoreAccount: vi.fn(),
  replace: vi.fn(),
  pathname: "/",
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
  return { useRouter: () => router, usePathname: () => mocks.pathname };
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
      getPasskey: { query: mocks.getPasskey },
      savePasskey: { mutate: mocks.savePasskey },
    },
  },
}));

vi.mock("../src/lib/passkey", () => ({
  passkeysAvailable: () => mocks.passkeysAvailable,
  createPasskeyMaster: mocks.createPasskeyMaster,
  unlockPasskeyMaster: mocks.unlockPasskeyMaster,
  passkeyErrorMessage: (e: unknown) =>
    e instanceof Error ? e.message : "passkey failed",
}));

vi.mock("../src/lib/keys", () => ({
  deriveNoteSecrets: (master: Uint8Array) => ({ master }),
  randomMaster: () => new Uint8Array(32).fill(5),
}));

vi.mock("../src/lib/notes", () => ({
  hasLocalAccount: () => mocks.hasLocal,
  deriveAndStoreAccount: mocks.deriveAndStoreAccount,
  // The "view pubkey" is the master's first byte, repeated: enough to tell
  // keys from different passkeys apart.
  accountPubkeys: async ({ master }: { master: Uint8Array }) => ({
    notePubkey: new Uint8Array(32).fill(master[0]),
    viewPubkey: new Uint8Array(32).fill(master[0]),
  }),
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
  const {
    address,
    error,
    sessionReady,
    signIn,
    disconnect,
    accountUnlocked,
    recoveryModal,
    recoveryError,
    recoveryMethod,
    chooseRecovery,
    unlockWithPasskey,
  } = useWallet();
  return (
    <div>
      <div data-testid="unlocked">{accountUnlocked ? "yes" : "no"}</div>
      <div data-testid="recovery-modal">{recoveryModal ?? "none"}</div>
      <div data-testid="recovery-error">{recoveryError || "none"}</div>
      <div data-testid="recovery-method">{recoveryMethod ?? "none"}</div>
      <button type="button" onClick={() => void chooseRecovery("passkey")}>
        Use passkey
      </button>
      <button type="button" onClick={() => void unlockWithPasskey()}>
        Unlock passkey
      </button>
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
  mocks.pathname = "/";
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
  mocks.getPasskey.mockResolvedValue(null);
  mocks.savePasskey.mockResolvedValue({ ok: true });
  mocks.passkeysAvailable = false;
  mocks.hasLocal = true;
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

  it("leaves a payer's Privy session alone on a pay link", async () => {
    mocks.pathname = "/pay/alice";
    mocks.restore.mockResolvedValue(null);
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("ready")).toHaveTextContent("yes"),
    );
    // Paying must not create a Mawee account or leave the checkout.
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByTestId("address")).toHaveTextContent("none");
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

describe("WalletProvider passkey recovery (Mera PRF)", () => {
  const RECORD = {
    credentialId: "Y3JlZGVudGlhbC1pZC0x",
    transports: ["internal"],
  };

  it("asks a new account to choose how to protect its keys", async () => {
    mocks.getEscrow.mockResolvedValue(null);
    mocks.passkeysAvailable = true;
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("recovery-modal")).toHaveTextContent("choose"),
    );
    expect(screen.getByTestId("unlocked")).toHaveTextContent("no");
    expect(mocks.deriveAndStoreAccount).not.toHaveBeenCalled();
  });

  it("derives keys from a new passkey and stores only public data", async () => {
    mocks.getEscrow.mockResolvedValue(null);
    mocks.usernameOf.mockResolvedValue(null);
    mocks.passkeysAvailable = true;
    const master = new Uint8Array(32).fill(7);
    mocks.createPasskeyMaster.mockResolvedValue({ master, record: RECORD });
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("recovery-modal")).toHaveTextContent("choose"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Use passkey" }));

    await waitFor(() =>
      expect(screen.getByTestId("unlocked")).toHaveTextContent("yes"),
    );
    expect(mocks.savePasskey).toHaveBeenCalledWith({
      ...RECORD,
      viewPubkeyHex: "07".repeat(32),
    });
    // Nothing secret goes to the server.
    expect(JSON.stringify(mocks.savePasskey.mock.calls)).not.toContain(
      "[7,7,7",
    );
    expect(mocks.deriveAndStoreAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("recovery-method")).toHaveTextContent("passkey");
    expect(screen.getByTestId("recovery-modal")).toHaveTextContent("none");
  });

  it("keeps the account locked when the passkey can't derive keys", async () => {
    mocks.getEscrow.mockResolvedValue(null);
    mocks.passkeysAvailable = true;
    mocks.createPasskeyMaster.mockRejectedValue(new Error("no PRF here"));
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("recovery-modal")).toHaveTextContent("choose"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Use passkey" }));
    await waitFor(() =>
      expect(screen.getByTestId("recovery-error")).toHaveTextContent(
        "no PRF here",
      ),
    );
    expect(screen.getByTestId("unlocked")).toHaveTextContent("no");
    expect(mocks.savePasskey).not.toHaveBeenCalled();
  });

  it("re-derives the keys on a new device with the same passkey", async () => {
    mocks.hasLocal = false;
    mocks.getPasskey.mockResolvedValue({
      ...RECORD,
      viewPubkeyHex: "09".repeat(32),
    });
    mocks.unlockPasskeyMaster.mockResolvedValue(new Uint8Array(32).fill(9));
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("recovery-modal")).toHaveTextContent(
        "passkey-unlock",
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Unlock passkey" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("unlocked")).toHaveTextContent("yes"),
    );
    expect(mocks.unlockPasskeyMaster).toHaveBeenCalledWith({
      record: expect.objectContaining({ credentialId: RECORD.credentialId }),
    });
    expect(mocks.deriveAndStoreAccount).toHaveBeenCalledTimes(1);
  });

  it("rejects a passkey that derives different keys than the account's", async () => {
    mocks.hasLocal = false;
    mocks.getPasskey.mockResolvedValue({
      ...RECORD,
      viewPubkeyHex: "09".repeat(32),
    });
    mocks.unlockPasskeyMaster.mockResolvedValue(new Uint8Array(32).fill(3));
    render(
      <WalletProvider>
        <Probe />
      </WalletProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("recovery-modal")).toHaveTextContent(
        "passkey-unlock",
      ),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Unlock passkey" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("recovery-error")).toHaveTextContent(
        "derived different keys",
      ),
    );
    expect(screen.getByTestId("unlocked")).toHaveTextContent("no");
    expect(mocks.deriveAndStoreAccount).not.toHaveBeenCalled();
  });
});
