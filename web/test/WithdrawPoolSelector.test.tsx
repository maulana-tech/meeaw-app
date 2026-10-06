// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const pools = vi.hoisted(() => {
  const base = {
    chainId: 10143,
    deployBlock: 0,
    token: "0x00000000000000000000000000000000000000d0",
    tokenDecimals: 6,
    depth: 20,
    confirmations: 1,
    asset: "USDC",
    mintable: false,
  } as const;
  const active = {
    ...base,
    scope: "10143:0x00000000000000000000000000000000000000b0",
    address: "0x00000000000000000000000000000000000000b0",
    role: "active",
    requestCapable: true,
  } as const;
  const legacy = {
    ...base,
    scope: "10143:0x00000000000000000000000000000000000000c0",
    address: "0x00000000000000000000000000000000000000c0",
    role: "legacy",
    requestCapable: false,
  } as const;
  return { active, legacy, all: [active, legacy] };
});

const mocks = vi.hoisted(() => ({
  useMyNotes: vi.fn(),
  legacyBalances: new Map<string, bigint>(),
}));

vi.mock("../src/lib/pools", () => ({
  activePool: () => pools.active,
  activePools: () => [pools.active],
  activePoolFor: (asset: string) =>
    asset === pools.active.asset ? pools.active : null,
  legacyPools: () => [pools.legacy],
  listPools: () => pools.all,
  resolvePool: (scope: string) => {
    const pool = pools.all.find((p) => p.scope === scope);
    if (!pool) throw new Error("Unknown pool.");
    return pool;
  },
}));

vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: "0x00000000000000000000000000000000000000E1",
    accountUnlocked: true,
    promptUnlock: vi.fn(),
    getSigner: vi.fn(async () => ({})),
  }),
}));

vi.mock("../src/components/dashboard/useLegacyBalances", () => ({
  useLegacyBalances: () => mocks.legacyBalances,
}));

vi.mock("../src/components/dashboard/useMyNotes", () => ({
  useMyNotes: mocks.useMyNotes,
}));

vi.mock("../src/lib/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/notes")>()),
  getAccount: () => ({}),
  scanMyNotes: vi.fn(),
}));

import { WithdrawDashboard } from "../src/components/dashboard/WithdrawDashboard";

beforeEach(() => {
  mocks.legacyBalances = new Map();
  mocks.useMyNotes.mockReset();
  mocks.useMyNotes.mockImplementation((_address, pool) => ({
    notes: [
      {
        scope: pool.scope,
        leafIndex: 0,
        amount: pool.role === "legacy" ? 2_000_000n : 500_000n,
        salt: 1n,
        spent: false,
      },
    ],
    claimable: pool.role === "legacy" ? 2_000_000n : 500_000n,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }));
});

it("shows no pool choice when no previous pool holds funds", () => {
  render(<WithdrawDashboard />);
  expect(
    screen.queryByRole("group", { name: "Pool to withdraw from" }),
  ).not.toBeInTheDocument();
  expect(mocks.useMyNotes).toHaveBeenLastCalledWith(
    expect.anything(),
    pools.active,
  );
});

it("lets the user withdraw a legacy balance from its own pool", () => {
  mocks.legacyBalances = new Map([[pools.legacy.scope, 2_000_000n]]);
  render(<WithdrawDashboard />);

  const current = screen.getByRole("button", { name: "Current pool" });
  const previous = screen.getByRole("button", { name: /Previous pool · \$2/ });
  expect(current).toHaveAttribute("aria-pressed", "true");
  expect(previous).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(previous);
  expect(previous).toHaveAttribute("aria-pressed", "true");
  expect(mocks.useMyNotes).toHaveBeenLastCalledWith(
    expect.anything(),
    pools.legacy,
  );
  expect(
    screen.getByRole("button", { name: "Withdraw private payment 1, 2 USDC" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/can only be\s+withdrawn/)).toBeInTheDocument();
});
