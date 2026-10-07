// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),usePathname:()=>"/dashboard"}));

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  getAccount: vi.fn(),
  scanMyNotes: vi.fn(),
  usdcBalanceLabel: vi.fn(),
  accountStatus: vi.fn(),
  openUsernameModal: vi.fn(),
}));

// Passthrough stubs for the GSAP-driven landing shell (not under test here).
vi.mock("../src/components/landing/Chrome", () => ({
  Chrome: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../src/components/landing/Hero", () => ({
  Hero: () => {
    const wallet = mocks.useWallet();
    if (!wallet.address) return <div>Connect your wallet</div>;
    if (wallet.usernameResolved && !wallet.username) {
      return (
        <button type="button" onClick={wallet.openUsernameModal}>
          Claim your username
        </button>
      );
    }
    return null;
  },
}));
vi.mock("../src/components/landing/ProblemStatement", () => ({
  ProblemStatement: () => null,
}));
vi.mock("../src/components/landing/Solution", () => ({ Solution: () => null }));
vi.mock("../src/components/landing/Steps", () => ({ Steps: () => null }));
vi.mock("../src/components/landing/Users", () => ({ Users: () => null }));
vi.mock("../src/components/landing/Faq", () => ({ Faq: () => null }));
vi.mock("../src/components/landing/Footer", () => ({ Footer: () => null }));
vi.mock("../src/components/WalletStatus", () => ({ WalletStatus: () => null }));
vi.mock("../src/components/DepositForm", () => ({
  DepositForm: () => <div>DEPOSIT_FORM</div>,
}));
vi.mock("../src/lib/deposit", () => ({ payIntoNote: vi.fn() }));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: mocks.useWallet,
  useOptionalWallet:mocks.useWallet,
}));
vi.mock("../src/lib/notes", () => ({
  getAccount: mocks.getAccount,
  scanMyNotes: mocks.scanMyNotes,
}));
vi.mock("../src/lib/chain", () => ({
  usdcBalanceLabel: mocks.usdcBalanceLabel,
  accountStatus: mocks.accountStatus,
  gasFaucetUrl: "https://faucet.monad.xyz",
  mintTestUsdc: vi.fn(),
  gaslessEnabled: async () => true,
}));
// The dashboard funds the selected pool; make it a mintable test pool.
vi.mock("../src/lib/pools", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/pools")>();
  const pool = { ...real.activePool(), mintable: true };
  return {
    ...real,
    activePools: () => [pool],
    activePool: () => pool,
    activePoolFor: (asset: string) => (asset === pool.asset ? pool : null),
  };
});

import DashboardPage from "../src/app/(dashboard)/dashboard/page";
import Home from "../src/app/page";
import { renderWithTRPC } from "./renderWithTRPC";

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    address: "",
    getSigner: vi.fn(),
    username: null,
    usernameResolved: false,
    sessionReady: true,
    accountUnlocked: true,
    promptUnlock: vi.fn(),
    openUsernameModal: mocks.openUsernameModal,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accountStatus.mockResolvedValue({ usdc: "12.5", gas: "0.5" });
  mocks.usdcBalanceLabel.mockResolvedValue("0");
  mocks.getAccount.mockReturnValue(null);
  mocks.scanMyNotes.mockResolvedValue({ notes: [], leaves: [], claimable: 0n });
});

describe("Home get-started gating", () => {
  it("shows the connect prompt when no wallet is connected", async () => {
    mocks.useWallet.mockReturnValue(wallet({ address: "" }));
    render(<Home />);

    expect(await screen.findByText(/connect your wallet/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claim your username/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("DEPOSIT_FORM")).not.toBeInTheDocument();
  });

  it("shows a claim-username CTA that opens the modal when connected without a username", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        usernameResolved: true,
        username: null,
      }),
    );
    render(<Home />);

    const cta = await screen.findByRole("button", {
      name: /claim your username/i,
    });
    await userEvent.click(cta);
    expect(mocks.openUsernameModal).toHaveBeenCalledTimes(1);

    expect(screen.queryByText("DEPOSIT_FORM")).not.toBeInTheDocument();
    expect(screen.queryByText(/connect your wallet/i)).not.toBeInTheDocument();
  });

  it("keeps the dashboard off the public landing page once connected", () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        usernameResolved: true,
        username: "alice",
      }),
    );
    render(<Home />);

    expect(
      screen.queryByRole("heading", { name: /dashboard/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/private balance/i)).not.toBeInTheDocument();
  });
});

describe("Dashboard route", () => {
  const unlockedAccount = {
    ownerSecret: 1n,
    viewSk: new Uint8Array(32),
  };

  it("renders the dashboard while username lookup is pending", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        sessionReady: true,
        usernameResolved: false,
        username: null,
      }),
    );
    mocks.getAccount.mockReturnValue(unlockedAccount);

    renderWithTRPC(<DashboardPage />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Welcome to Mawee",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Claim username" }),
    ).not.toBeInTheDocument();
  });

  it("asks a signed-in user without a username to claim one", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        usernameResolved: true,
        username: null,
      }),
    );
    mocks.getAccount.mockReturnValue(unlockedAccount);
    renderWithTRPC(<DashboardPage />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Claim username" }),
    );
    expect(mocks.openUsernameModal).toHaveBeenCalledOnce();
    // Receiving needs a username, so the action is hidden until then.
    expect(
      screen.queryByRole("button", { name: "Receive payment" }),
    ).not.toBeInTheDocument();
  });

  it("shows the private dashboard once connected with a claimed username", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        sessionReady: true,
        usernameResolved: true,
        username: "alice",
      }),
    );
    mocks.getAccount.mockReturnValue(unlockedAccount);
    renderWithTRPC(<DashboardPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Hi, @alice" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Private balance")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Receive payment" }),
    ).toBeEnabled();
    expect(screen.getByRole("link", { name: "Cash out" })).toHaveAttribute(
      "href",
      "/withdraw",
    );
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute(
      "href",
      "/links",
    );
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/history",
    );
    expect(
      (await screen.findByRole("link", { name: "Open link" })).getAttribute(
        "href",
      ),
    ).toMatch(/\/pay\/alice$/);
    expect(
      screen.queryByRole("button", { name: "Claim username" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("DEPOSIT_FORM")).not.toBeInTheDocument();
  });

  it("keeps balance and activity private until the account is unlocked", async () => {
    const promptUnlock = vi.fn();
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        usernameResolved: true,
        username: "alice",
        accountUnlocked: false,
        promptUnlock,
      }),
    );
    renderWithTRPC(<DashboardPage />);

    await userEvent.click(
      await screen.findByRole("button", { name: "Unlock with PIN" }),
    );
    expect(promptUnlock).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Add funds" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/your payment history is private/i),
    ).toBeInTheDocument();
  });

  it("opens the Add funds dialog from the balance card", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        sessionReady: true,
        usernameResolved: true,
        username: "alice",
      }),
    );
    mocks.getAccount.mockReturnValue(unlockedAccount);
    renderWithTRPC(<DashboardPage />);

    const addFunds = await screen.findByRole("button", { name: "Add funds" });
    await vi.waitFor(() => expect(addFunds).toBeEnabled());
    await userEvent.click(addFunds);

    expect(
      await screen.findByRole("heading", { name: "Add funds" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("12.5")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Get 100 test USDC/ }),
    ).toBeInTheDocument();
    // With the relayer on, users never see gas: no MON balance or faucet.
    expect(await screen.findByText("Covered by Mawee")).toBeInTheDocument();
    expect(screen.queryByText("MON faucet")).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Move to private balance"),
    ).toBeInTheDocument();
  });
});
