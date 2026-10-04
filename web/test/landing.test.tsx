// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ useWallet: vi.fn(), signIn: vi.fn() }));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: mocks.useWallet,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { FinalCta } from "../src/components/landing/FinalCta";
import { Hero } from "../src/components/landing/Hero";

const wallet = (address = "") => ({ address, signIn: mocks.signIn });

beforeEach(() => vi.clearAllMocks());

describe("landing hero", () => {
  it("leads with the promise and starts sign-in from the primary CTA", async () => {
    mocks.useWallet.mockReturnValue(wallet());
    render(<Hero />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /get paid in usdc\. keep your income private\./i,
      }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Create your payment link" }),
    );
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: "See how it works" }),
    ).toHaveAttribute("href", "#how");
  });

  it("sends signed-in visitors to their dashboard instead", () => {
    mocks.useWallet.mockReturnValue(wallet("0xabc"));
    render(<Hero />);
    expect(
      screen.getByRole("link", { name: "Open your dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
    expect(
      screen.queryByRole("button", { name: "Create your payment link" }),
    ).not.toBeInTheDocument();
  });

  it("states only product facts in the stats row", () => {
    mocks.useWallet.mockReturnValue(wallet());
    render(<Hero />);
    for (const label of [
      "Finality on Monad",
      "Gas for you or your client",
      "For every client",
      "Self-custodial",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("closing call to action", () => {
  it("starts sign-in for visitors", async () => {
    mocks.useWallet.mockReturnValue(wallet());
    render(<FinalCta />);
    await userEvent.click(
      screen.getByRole("button", { name: "Create your payment link" }),
    );
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });
});
