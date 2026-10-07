import "server-only";
import { createPublicClient, http } from "viem";
import { getServerEnv } from "../../../env.server";
import { maweePoolAbi } from "../../../lib/abi";
import { chain, rpcUrl } from "../../../lib/chain";
import type { ReceiptRpcReader } from "./receipts.service";

const decimalsAbi = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;
export function createReceiptReader(): ReceiptRpcReader {
  const client = createPublicClient({
    chain,
    transport: http(getServerEnv().RELAYER_RPC_URL ?? rpcUrl, {
      timeout: 3000,
      retryCount: 0,
    }),
  });
  return {
    chainId: () => client.getChainId(),
    head: async () => Number(await client.getBlockNumber({ cacheTime: 0 })),
    block: async (number) => {
      const b = await client.getBlock({ blockNumber: BigInt(number) });
      if (!b.hash || b.number === null) throw new Error("Block unavailable.");
      return { number: Number(b.number), hash: b.hash };
    },
    root: (pool, number) =>
      client.readContract({
        address: pool.address,
        abi: maweePoolAbi,
        functionName: "currentRoot",
        blockNumber: BigInt(number),
      }),
    leafCount: async (pool, number) =>
      Number(
        await client.readContract({
          address: pool.address,
          abi: maweePoolAbi,
          functionName: "nextIndex",
          blockNumber: BigInt(number),
        }),
      ),
    token: (pool, number) =>
      client.readContract({
        address: pool.address,
        abi: maweePoolAbi,
        functionName: "token",
        blockNumber: BigInt(number),
      }),
    decimals: async (token, number) =>
      Number(
        await client.readContract({
          address: token,
          abi: decimalsAbi,
          functionName: "decimals",
          blockNumber: BigInt(number),
        }),
      ),
  };
}
