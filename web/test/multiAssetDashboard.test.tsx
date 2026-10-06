// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pools = vi.hoisted(() => {
  const base = {
    chainId: 10143,
    deployBlock: 0,
    tokenDecimals: 6,
    depth: 20,
    confirmations: 1,
    role: "active",
    mintable: false,
  } as const;
  const usdc = {
    ...base,
    asset: "USDC",
    scope: "10143:0x00000000000000000000000000000000000000b0",
    address: "0x00000000000000000000000000000000000000b0",
    token: "0x00000000000000000000000000000000000000d0",
    requestCapable: true,
  } as const;
  const ausd = {
    ...base,
    asset: "AUSD",
    scope: "10143:0x00000000000000000000000000000000000000b1",
    address: "0x00000000000000000000000000000000000000b1",
    token: "0x00000000000000000000000000000000000000d1",
    requestCapable: false,
  } as const;
  return { usdc, ausd, all: [usdc, ausd] };
});

const mocks = vi.hoisted(() => ({ useMyNotes: vi.fn() }));

vi.mock("../src/lib/pools", () => ({
  activePool: () => pools.usdc,
  activePools: () => pools.all,
  activePoolFor: (asset: string) =>
    pools.all.find((p) => p.asset === asset) ?? null,
  legacyPools: () => [],
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
  useLegacyBalances: () => new Map(),
}));
vi.mock("../src/components/dashboard/useMyNotes", () => ({
  useMyNotes: mocks.useMyNotes,
}));
vi.mock("../src/lib/notes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/notes")>()),
  getAccount: () => ({}),
  scanMyNotes: vi.fn(),
}));

import { BalanceCard } from "../src/components/dashboard/BalanceCard";
import { selectAsset } from "../src/components/dashboard/useSelectedPool";
import { WithdrawDashboard } from "../src/components/dashboard/WithdrawDashboard";

beforeEach(() => {
  localStorage.clear();
  selectAsset("USDC");
  mocks.useMyNotes.mockReset();
  mocks.useMyNotes.mockImplementation((_address, pool) => ({
    notes: [
      {
        scope: pool.scope,
        leafIndex: 0,
        amount: 1_000_000n,
        salt: 1n,
        spent: false,
      },
    ],
    claimable: 1_000_000n,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }));
});

it("lets the balance switch to an asset that has an active pool", async () => {
  const user = userEvent.setup();
  render(<BalanceCard claimable={0n} loading={false} />);
  expect(screen.getByText(/USDC on Monad/)).toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "Choose balance currency" }),
  );
  const ausd = await screen.findByRole("menuitem", { name: /^AUSD Agora$/ });
  expect(ausd).not.toHaveAttribute("aria-disabled");
  // Assets without a pool stay listed as upcoming.
  expect(
    screen.getByRole("menuitem", { name: /USDT Tether Coming soon/ }),
  ).toHaveAttribute("aria-disabled", "true");

  await user.click(ausd);
  expect(await screen.findByText(/AUSD on Monad/)).toBeInTheDocument();
  expect(localStorage.getItem("mawee:dashboard-asset")).toBe("AUSD");
});

it("cashes out from the pool of the chosen asset", () => {
  render(<WithdrawDashboard />);
  expect(mocks.useMyNotes).toHaveBeenLastCalledWith(
    expect.anything(),
    pools.usdc,
  );

  fireEvent.click(screen.getByRole("button", { name: "AUSD" }));
  expect(screen.getByRole("button", { name: "AUSD" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(mocks.useMyNotes).toHaveBeenLastCalledWith(
    expect.anything(),
    pools.ausd,
  );
  expect(
    screen.getByRole("button", { name: "Withdraw private payment 1, 1 AUSD" }),
  ).toBeInTheDocument();
});
