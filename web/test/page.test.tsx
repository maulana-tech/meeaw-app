// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
  usdcMintable: true,
}));

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
  it("renders the dashboard while username lookup is pending", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        sessionReady: true,
        usernameResolved: false,
        username: null,
      }),
    );
    mocks.getAccount.mockReturnValue({
      ownerSecret: 1n,
      viewSk: new Uint8Array(32),
    });

    renderWithTRPC(<DashboardPage />);

    expect(
      await screen.findByRole("heading", {
        name: /dashboard: hi, there/i,
      }),
    ).toBeInTheDocument();
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
    mocks.getAccount.mockReturnValue({
      ownerSecret: 1n,
      viewSk: new Uint8Array(32),
    });
    renderWithTRPC(<DashboardPage />);

    expect(
      await screen.findByRole("heading", {
        name: /dashboard: hi, alice/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("My Balance")).toBeInTheDocument();
    const withdrawCard = screen.getByRole("link", { name: "Open Withdraw" });
    const proofsCard = screen.getByRole("link", {
      name: "Open Payment proofs",
    });
    expect(withdrawCard).toHaveAttribute("href", "/withdraw");
    expect(proofsCard).toHaveAttribute("href", "/history");
    for (const card of [withdrawCard, proofsCard]) {
      expect(card.querySelector("a, button")).toBeNull();
    }
    expect(
      screen.getAllByRole("button", { name: "Create a payment link" }),
    ).toHaveLength(2);
    const depositCard = screen.getByRole("button", {
      name: "Open deposit funds",
    });
    expect(depositCard).toBeEnabled();
    expect(
      within(depositCard).getByText(
        "Add money to your Mawee balance. Use it for payments, or withdraw it whenever you need it.",
      ),
    ).toBeInTheDocument();
    expect(within(depositCard).getByText("USDC on Monad")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add cash" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Manage your account here"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Account settings, coming soon",
      }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Open link" })).toHaveClass(
      "bg-primary",
      "!text-primary-foreground",
    );
    expect(screen.queryByText("DEPOSIT_FORM")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claim your username/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/connect your wallet/i)).not.toBeInTheDocument();
  });

  it("opens the Add funds dialog from the Deposit fund tile", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        sessionReady: true,
        usernameResolved: true,
        username: "alice",
      }),
    );
    mocks.getAccount.mockReturnValue({
      ownerSecret: 1n,
      viewSk: new Uint8Array(32),
    });
    renderWithTRPC(<DashboardPage />);

    const depositCard = await screen.findByRole("button", {
      name: "Open deposit funds",
    });
    expect(depositCard).toBeEnabled();
    await userEvent.click(depositCard);

    expect(
      await screen.findByRole("heading", { name: "Add funds" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("12.5")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Get 100 test USDC/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Move to private balance"),
    ).toBeInTheDocument();
  });
});
