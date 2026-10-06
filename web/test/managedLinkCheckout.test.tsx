// @vitest-environment happy-dom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assetPool } from "./helpers/multiAssetFixtures";

const mock = vi.hoisted(() => ({
  pay: vi.fn(),
  signer: vi.fn(),
  balance: vi.fn(),
  pools: [] as any[],
}));
vi.mock("../src/lib/pools", () => ({
  activePools: () => mock.pools,
  activePoolFor: (asset: string) => mock.pools.find((p) => p.asset === asset),
}));
vi.mock("../src/features/payerWallet/hooks/usePayerWallet", () => ({
  usePayerWallet: () => ({
    address: "0x1234567890123456789012345678901234567890",
    source: "injected",
    privyReady: true,
    getSigner: mock.signer,
  }),
}));
vi.mock("../src/lib/chain", () => ({
  chain: { name: "Monad" },
  tokenBalance: mock.balance,
  explorerTxUrl: () => "https://example.com/tx",
  mintTestUsdc: vi.fn(),
}));
vi.mock("../src/lib/deposit", () => ({ payIntoNote: mock.pay }));
vi.mock("../src/lib/useGasless", () => ({ useGasless: () => false }));
vi.mock("../src/components/PrivacyPoolStat", () => ({
  PrivacyPoolStat: () => null,
}));
vi.mock("../src/components/ui/toast-feedback", () => ({
  ToastFeedback: ({ message }: { message?: string }) =>
    message ? <p>{message}</p> : null,
}));

import { PayForm } from "../src/app/pay/[username]/PayForm";

const account = { note_pubkey: "0x01", view_pubkey: "0x02" } as any;
const link = {
  id: "l",
  owner: "alice",
  asset: "AUSD",
  tokenDecimals: 6,
  amount: null,
} as any;
describe("managed checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.pools = [assetPool("USDC"), assetPool("AUSD")];
    mock.balance.mockResolvedValue(100_000_000n);
    mock.signer.mockResolvedValue({
      address: "0x1234567890123456789012345678901234567890",
    });
    mock.pay.mockResolvedValue({ txHash: "0x01" });
  });
  it("locks an open managed link to AUSD and pays the same pool", async () => {
    const user = userEvent.setup();
    render(<PayForm account={account} username="alice" link={link} />);
    expect(
      screen.queryByRole("button", { name: "USDC" }),
    ).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "AUSD" }), "20");
    await user.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(mock.pay).toHaveBeenCalled());
    expect(mock.pay.mock.calls[0][3].asset).toBe("AUSD");
    expect(mock.pay.mock.calls[0][2]).toBe(20_000_000n);
  });
  it("keeps currency choice on a general username checkout", () => {
    render(<PayForm account={account} username="alice" />);
    expect(screen.getByRole("button", { name: "USDC" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "AUSD" })).toBeInTheDocument();
  });
  it("discards a balance result from the previously selected token", async () => {
    let finishOld!: (balance: bigint) => void;
    mock.balance.mockImplementation((_address, pool) => pool.asset === "USDC" ? new Promise<bigint>(resolve => { finishOld = resolve; }) : Promise.resolve(7_000_000n));
    const user = userEvent.setup();
    render(<PayForm account={account} username="alice" />);
    await user.click(screen.getByRole("button", {name:"AUSD"}));
    await screen.findByText(/Balance: 7 AUSD/);
    await act(async () => finishOld(99_000_000n));
    expect(screen.getByText(/Balance: 7 AUSD/)).toBeInTheDocument();
    expect(screen.queryByText(/Balance: 99 AUSD/)).not.toBeInTheDocument();
  });
  it("rejects rotation while preparing the signer", async () => {
    mock.signer.mockImplementation(async () => {
      mock.pools = [assetPool("USDC"), {...assetPool("USDT0"),asset:"AUSD"}];
      return { address: "0x1234567890123456789012345678901234567890" };
    });
    const user = userEvent.setup();
    render(<PayForm account={account} username="alice" link={link} />);
    await user.type(screen.getByRole("textbox", { name: "AUSD" }), "20");
    await user.click(screen.getByRole("button", { name: "Pay" }));
    await screen.findByText(/wallet or payment asset changed/);
    expect(mock.pay).not.toHaveBeenCalled();
  });
});
