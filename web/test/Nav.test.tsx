// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  useWallet: vi.fn(),
  openUsernameModal: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));
vi.mock("../src/components/SignInModal", () => ({
  SignInModal: () => null,
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { EditionsTopNav } from "../src/components/landing/Nav";

function wallet(overrides: Record<string, unknown> = {}) {
  return {
    address: "",
    connecting: false,
    username: null,
    usernameResolved: false,
    openUsernameModal: mocks.openUsernameModal,
    signIn: mocks.signIn,
    disconnect: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("EditionsTopNav", () => {
  it("shows a sign-in button when disconnected", () => {
    mocks.useWallet.mockReturnValue(wallet());
    render(<EditionsTopNav />);
    expect(
      screen.getByRole("button", { name: /sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /claim username/i }),
    ).not.toBeInTheDocument();

    // The bar turns solid and blurred once the page scrolls (Chrome sets
    // data-scrolled), so content never shows through the links.
    const nav = document.querySelector("[data-ed-topnav]");
    expect(nav).toHaveClass(
      "data-[scrolled=true]:bg-void/70",
      "data-[scrolled=true]:backdrop-blur-md",
    );
  });

  it("links every landing section from the section pill", () => {
    mocks.useWallet.mockReturnValue(wallet());
    render(<EditionsTopNav />);
    const sections = screen.getByRole("navigation", { name: "Sections" });
    for (const [name, href] of [
      ["Why Mawee", "#why"],
      ["How it works", "#how"],
      ["Who it's for", "#who"],
      ["FAQ", "#faq"],
    ]) {
      expect(within(sections).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  it("opens Privy's login modal directly", async () => {
    mocks.useWallet.mockReturnValue(wallet());
    render(<EditionsTopNav />);

    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it("shows the loader before the sign-in label while connecting", () => {
    mocks.useWallet.mockReturnValue(wallet({ connecting: true }));
    render(<EditionsTopNav />);

    const button = screen.getByRole("button", { name: "Signing in…" });
    expect(button.firstElementChild).toHaveClass(
      "lucide-loader",
      "motion-safe:animate-spin",
    );
  });

  it("shows @username when connected with a username", () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        usernameResolved: true,
        username: "alice",
      }),
    );
    render(<EditionsTopNav />);
    const account = screen.getByRole("button", { name: "@alice" });
    // Touch target stays at least 44px tall.
    expect(account).toHaveClass("min-h-11", "font-semibold");
    expect(
      screen.queryByRole("button", { name: /claim username/i }),
    ).not.toBeInTheDocument();
  });

  it("offers a claim-username CTA for a connected user without a username", async () => {
    mocks.useWallet.mockReturnValue(
      wallet({
        address: "0x00000000000000000000000000000000000000E1",
        usernameResolved: true,
        username: null,
      }),
    );
    render(<EditionsTopNav />);

    const cta = screen.getByRole("button", { name: /claim username/i });
    await userEvent.click(cta);
    expect(mocks.openUsernameModal).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByText(/GCAB|5678/)).not.toBeInTheDocument();
  });
});
