// Payers use their own browser wallet (MetaMask, Rabby, Phantom EVM, …) via
// the injected EIP-1193 provider. No Mawee account is needed to pay.

import {
  createWalletClient,
  custom,
  type EIP1193Provider,
  getAddress,
  numberToHex,
} from "viem";
import { chain, type Signer } from "../../lib/chain";

function injected(): EIP1193Provider {
  const provider =
    typeof window === "undefined"
      ? undefined
      : (window as { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) {
    throw new Error(
      "No browser wallet found. Install MetaMask or another EVM wallet to pay.",
    );
  }
  return provider;
}

/** Ask the wallet to switch to Monad, adding the network if it is unknown. */
async function ensureChain(provider: EIP1193Provider): Promise<void> {
  const chainId = numberToHex(chain.id);
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [...chain.rpcUrls.default.http],
          blockExplorerUrls: chain.blockExplorers
            ? [chain.blockExplorers.default.url]
            : undefined,
        },
      ],
    });
  }
}

export async function connectPayerWallet(): Promise<string> {
  const provider = injected();
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  if (!account) throw new Error("The wallet did not share an account.");
  await ensureChain(provider);
  return getAddress(account);
}

export async function payerSigner(address: string): Promise<Signer> {
  const provider = injected();
  await ensureChain(provider);
  const account = getAddress(address);
  return {
    address: account,
    walletClient: createWalletClient({
      account,
      chain,
      transport: custom(provider),
    }),
  };
}
