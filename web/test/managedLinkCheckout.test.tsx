import { sponsorshipUiFixture } from "./helpers/sponsorshipUiFixture";

vi.mock("../src/features/sponsorship/useSponsorship", () => ({
  useSponsorship: sponsorshipUiFixture,
}));

// @vitest-environment happy-dom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoicePaymentIntent } from "../src/features/invoices/types";
import type { PaymentLink } from "../src/features/paymentLinks/types";
import { AGORA_DEPLOYMENTS } from "../src/lib/agora";
import type { MaweeAccount } from "../src/lib/chain";
import type { PoolDescriptor } from "../src/lib/pools";
import { assetPool } from "./helpers/multiAssetFixtures";

const mock = vi.hoisted(() => ({
  pay: vi.fn(),
  signer: vi.fn(),
  balance: vi.fn(),
  pools: [] as PoolDescriptor[],
}));
vi.mock("../src/lib/pools", () => ({
  activePools: () => mock.pools,
  activePoolFor: (asset: string) => mock.pools.find((p) => p.asset === asset),
  resolvePool: (scope: string) => {
    const pool = mock.pools.find((p) => p.scope === scope);
    if (!pool) throw new Error("Unknown pool");
    return pool;
  },
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

const account: MaweeAccount = {
  owner: "0x1111111111111111111111111111111111111111",
  note_pubkey: new Uint8Array(32),
  view_pubkey: new Uint8Array(32),
  created: 0n,
};
const link = {
  id: "l",
  owner: "alice",
  asset: "AUSD",
  tokenDecimals: 6,
  amount: null,
} as unknown as PaymentLink;
describe("managed checkout", () => {
  it("guides an official AUSD payer to issuer funding and refreshes that token balance", async () => {
    const official = {
      ...assetPool("AUSD"),
      chainId: 10143,
      token: AGORA_DEPLOYMENTS[10143],
      mintable: false,
    };
    mock.pools = [assetPool("USDC"), official];
    mock.balance.mockResolvedValue(0n);
    render(<PayForm account={account} username="alice" link={link} />);
    expect(
      await screen.findByRole("link", { name: "Agora testnet faucet" }),
    ).toHaveAttribute(
      "href",
      "https://docs.agora.finance/developer/contract-deployments",
    );
    expect(
      screen.queryByRole("button", { name: "Get 100 test AUSD" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(mock.balance).toHaveBeenCalledOnce());
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Refresh wallet balance" }));
    await waitFor(() => expect(mock.balance).toHaveBeenCalledTimes(2));
    expect(mock.balance.mock.calls[1][1].token).toBe(official.token);
    expect(mock.pay).not.toHaveBeenCalled();
  });
  it("keeps Pay disabled after a broadcast attempt has an uncertain result", async () => {
    const intent: InvoicePaymentIntent = {
      poolScope: assetPool("AUSD").scope,
      salt: "7",
      ephemeralPk: `0x${"11".repeat(32)}`,
      ciphertext: `0x${"22".repeat(88)}`,
    };
    const lifecycle = {
      onSubmitting: vi.fn(),
      onSubmitted: vi.fn(),
      onUncertain: vi.fn(),
      onReleased: vi.fn(),
    };
    mock.pay.mockImplementation(async (...args) => {
      args[5].lifecycle.onSubmitting();
      throw new Error("receipt timeout");
    });
    render(
      <PayForm
        account={account}
        username="alice"
        link={{ ...link, amount: "2500000" }}
        invoice={intent}
        invoiceLifecycle={lifecycle}
      />,
    );
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /Pay 2.5 AUSD/i }));
    await waitFor(() => expect(lifecycle.onUncertain).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: /check payment status/i }),
    ).toBeDisabled();
    expect(lifecycle.onReleased).not.toHaveBeenCalled();
    expect(mock.pay).toHaveBeenCalledOnce();
  });
  it("passes the pinned invoice note and reports the resulting receipt", async () => {
    const intent: InvoicePaymentIntent = {
      poolScope: assetPool("AUSD").scope,
      salt: "7",
      ephemeralPk: `0x${"11".repeat(32)}`,
      ciphertext: `0x${"22".repeat(88)}`,
    };
    const onPaid = vi.fn(async () => {});
    mock.pay.mockResolvedValue({ txHash: `0x${"a".repeat(64)}`, leafIndex: 0 });
    render(
      <PayForm
        account={account}
        username="alice"
        link={{ ...link, amount: "2500000" }}
        invoice={intent}
        onPaid={onPaid}
      />,
    );
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: /Pay 2.5 AUSD/i }));
    await waitFor(() =>
      expect(onPaid).toHaveBeenCalledWith(`0x${"a".repeat(64)}`),
    );
    expect(mock.pay.mock.calls[0][5].salt).toBe(7n);
    expect(mock.pay.mock.calls[0][5].envelope.ciphertext).toHaveLength(88);
    expect(
      screen.getByRole("button", { name: /payment submitted/i }),
    ).toBeDisabled();
  });
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
    mock.balance.mockImplementation((_address, pool) =>
      pool.asset === "USDC"
        ? new Promise<bigint>((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve(7_000_000n),
    );
    const user = userEvent.setup();
    render(<PayForm account={account} username="alice" />);
    await user.click(screen.getByRole("button", { name: "AUSD" }));
    await screen.findByText(/Balance: 7 AUSD/);
    await act(async () => finishOld(99_000_000n));
    expect(screen.getByText(/Balance: 7 AUSD/)).toBeInTheDocument();
    expect(screen.queryByText(/Balance: 99 AUSD/)).not.toBeInTheDocument();
  });
  it("rejects rotation while preparing the signer", async () => {
    mock.signer.mockImplementation(async () => {
      mock.pools = [
        assetPool("USDC"),
        { ...assetPool("USDT0"), asset: "AUSD" },
      ];
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
