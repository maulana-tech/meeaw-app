import "server-only";
import {
  createPublicClient,
  type Hex,
  http,
  type TransactionReceipt,
} from "viem";
import { getServerEnv } from "../../../env.server";
import { chain, rpcUrl } from "../../../lib/chain";

export type InvoiceReader = {
  chainId: () => Promise<number>;
  head: () => Promise<bigint>;
  receipt: (hash: Hex) => Promise<TransactionReceipt>;
  blockHash: (number: bigint) => Promise<Hex | null>;
  transaction: (hash: Hex) => Promise<{
    hash: Hex;
    to: Hex | null;
    input: Hex;
    blockHash: Hex | null;
    blockNumber: bigint | null;
  }>;
};
export function invoiceReader(): InvoiceReader {
  const client = createPublicClient({
    chain,
    transport: http(getServerEnv().RELAYER_RPC_URL ?? rpcUrl, {
      timeout: 3000,
      retryCount: 0,
    }),
  });
  return {
    chainId: () => client.getChainId(),
    head: () => client.getBlockNumber({ cacheTime: 0 }),
    receipt: (hash) => client.getTransactionReceipt({ hash }),
    transaction: (hash) => client.getTransaction({ hash }),
    blockHash: async (blockNumber) =>
      (await client.getBlock({ blockNumber })).hash,
  };
}
