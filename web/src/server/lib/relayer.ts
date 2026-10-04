import "server-only";

import {
  type Abi,
  type Account,
  type ContractFunctionArgs,
  type ContractFunctionName,
  createPublicClient,
  createWalletClient,
  type Hash,
  http,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getServerEnv } from "../../env.server";
import { chain, rpcUrl } from "../../lib/chain";

let client: WalletClient | null = null;
let reader: PublicClient | null = null;
let account: Account | null = null;

export function relayerConfigured(): boolean {
  return Boolean(getServerEnv().RELAYER_PRIVATE_KEY);
}

function relayer(): {
  client: WalletClient;
  reader: PublicClient;
  account: Account;
} {
  const env = getServerEnv();
  if (!env.RELAYER_PRIVATE_KEY) {
    throw new Error("The gasless relayer is not configured.");
  }
  // Simulation, submission and receipts all go through one endpoint so the
  // relayer sees a consistent view of its own nonce and pending txs.
  const transport = http(env.RELAYER_RPC_URL ?? rpcUrl);
  account ??= privateKeyToAccount(env.RELAYER_PRIVATE_KEY as `0x${string}`);
  client ??= createWalletClient({ account, chain, transport });
  reader ??= createPublicClient({ chain, transport }) as PublicClient;
  return { client, reader, account };
}

export function relayerAddress(): string | null {
  return relayerConfigured() ? relayer().account.address : null;
}

// One in-flight send at a time, so concurrent requests never race for the
// same account nonce.
let queue: Promise<unknown> = Promise.resolve();

export function relayWrite<
  const abi extends Abi,
  functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
>(request: {
  address: `0x${string}`;
  abi: abi;
  functionName: functionName;
  args: ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>;
}): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
  const run = async () => {
    const { client: wallet, reader, account: from } = relayer();
    // Simulation runs the exact call first: a bad proof or signature reverts
    // here, so invalid requests never cost the relayer gas.
    const { request: simulated } = await reader.simulateContract({
      ...(request as Parameters<typeof reader.simulateContract>[0]),
      account: from,
    });
    const hash = await wallet.writeContract(
      simulated as Parameters<WalletClient["writeContract"]>[0],
    );
    const receipt = await reader.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      throw new Error(`Relayed transaction reverted: ${hash}`);
    }
    return { hash, receipt };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}
