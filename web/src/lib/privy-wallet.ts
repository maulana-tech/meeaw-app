import type { ConnectedWallet } from "@privy-io/react-auth";
import { createWalletClient, custom, getAddress } from "viem";
import { chain, type Signer } from "./chain";

/** The user's Privy embedded Ethereum wallet, which is their Mawee account. */
export function findEmbeddedWallet(
  wallets: readonly ConnectedWallet[],
): ConnectedWallet | null {
  return wallets.find((wallet) => wallet.walletClientType === "privy") ?? null;
}

/**
 * A viem signer backed by the embedded wallet, pinned to the configured
 * Monad chain. Privy shows its own confirmation UI for each transaction.
 */
export async function privySigner(wallet: ConnectedWallet): Promise<Signer> {
  await wallet.switchChain(chain.id);
  const provider = await wallet.getEthereumProvider();
  const address = getAddress(wallet.address);
  return {
    address,
    walletClient: createWalletClient({
      account: address,
      chain,
      transport: custom(provider),
    }),
  };
}
