// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddFundsDialog } from "../src/components/dashboard/AddFundsDialog";
import { AGORA_DEPLOYMENTS } from "../src/lib/agora";
import { assetPool } from "./helpers/multiAssetFixtures";

const mock = vi.hoisted(() => ({ status: vi.fn(), mint: vi.fn() }));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({ address: `0x${"1".repeat(40)}`, getSigner: vi.fn() }),
}));
vi.mock("../src/lib/chain", () => ({
  accountStatus: mock.status,
  mintTestUsdc: mock.mint,
  gasFaucetUrl: "",
}));
vi.mock("../src/lib/useGasless", () => ({ useGasless: () => true }));
beforeEach(() => {
  mock.status.mockReset().mockResolvedValue({ usdc: "0", gas: "0" });
  mock.mint.mockReset();
});
describe("official AUSD funding", () => {
  it("offers issuer faucet guidance and refresh without a mock mint action", async () => {
    const pool = {
      ...assetPool("AUSD"),
      chainId: 10143,
      token: AGORA_DEPLOYMENTS[10143],
      mintable: false,
    };
    render(<AddFundsDialog open onOpenChange={vi.fn()} pool={pool} />);
    expect(
      await screen.findByRole("link", { name: "Agora testnet faucet" }),
    ).toHaveAttribute(
      "href",
      "https://docs.agora.finance/developer/contract-deployments",
    );
    expect(screen.getByText(/Agora's official test AUSD/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Get 100 test AUSD" }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(mock.status).toHaveBeenCalledOnce());
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh wallet balance" }),
    );
    await waitFor(() => expect(mock.status).toHaveBeenCalledTimes(2));
    expect(mock.mint).not.toHaveBeenCalled();
  });
  it("keeps the existing mint action for mock AUSD", async () => {
    render(
      <AddFundsDialog open onOpenChange={vi.fn()} pool={assetPool("AUSD")} />,
    );
    expect(
      await screen.findByRole("button", { name: "Get 100 test AUSD" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Agora testnet faucet" }),
    ).not.toBeInTheDocument();
  });
});
