import "server-only";
import type { Hex } from "viem";
import type {
  ReceiptChainInput,
  ReceiptChainOutcome,
} from "../../../features/receipts/receiptChainTypes";
import { chain } from "../../../lib/chain";
import { findPool, type PoolDescriptor } from "../../../lib/pools";
import { createReceiptReader } from "./receipts.rpc";
export type ReceiptRpcReader = {
  chainId: () => Promise<number>;
  head: () => Promise<number>;
  block: (number: number) => Promise<{ number: number; hash: Hex }>;
  root: (pool: PoolDescriptor, number: number) => Promise<Hex>;
  leafCount: (pool: PoolDescriptor, number: number) => Promise<number>;
  token: (pool: PoolDescriptor, number: number) => Promise<Hex>;
  decimals: (token: Hex, number: number) => Promise<number>;
};
export async function readReceiptChainSnapshot(
  input: ReceiptChainInput,
  deps: {
    reader: ReceiptRpcReader;
    resolve: (scope: string) => PoolDescriptor | null;
    chainId: number;
  },
): Promise<ReceiptChainOutcome> {
  try {
    const pool = deps.resolve(input.pool),
      { reader } = deps;
    if (!pool || pool.chainId !== deps.chainId)
      return { status: "unavailable", reason: "unsupported-pool" };
    if (
      !Number.isSafeInteger(input.blockNumber) ||
      input.blockNumber < pool.deployBlock
    )
      return { status: "unavailable", reason: "block-before-deployment" };
    const [chainId, headBlock, before] = await Promise.all([
      reader.chainId(),
      reader.head(),
      reader.block(input.blockNumber),
    ]);
    if (chainId !== deps.chainId)
      return { status: "mismatch", reason: "chain-mismatch" };
    if (input.blockNumber > headBlock)
      return { status: "unavailable", reason: "future-block" };
    if (headBlock - input.blockNumber + 1 < pool.confirmations)
      return { status: "unavailable", reason: "insufficient-confirmations" };
    if (before.number !== input.blockNumber)
      return { status: "unavailable", reason: "historical-data-unavailable" };
    const [root, leafCount, token] = await Promise.all([
      reader.root(pool, input.blockNumber),
      reader.leafCount(pool, input.blockNumber),
      reader.token(pool, input.blockNumber),
    ]);
    if (token.toLowerCase() !== pool.token.toLowerCase()) {
      const after = await reader.block(input.blockNumber);
      if (
        before.hash.toLowerCase() !== after.hash.toLowerCase() ||
        after.number !== input.blockNumber
      )
        return { status: "unavailable", reason: "reorg-during-read" };
      return { status: "mismatch", reason: "token-mismatch" };
    }
    const [tokenDecimals, after] = await Promise.all([
      reader.decimals(token, input.blockNumber),
      reader.block(input.blockNumber),
    ]);
    if (
      before.hash.toLowerCase() !== after.hash.toLowerCase() ||
      after.number !== input.blockNumber
    )
      return { status: "unavailable", reason: "reorg-during-read" };
    if (
      input.blockHash &&
      input.blockHash.toLowerCase() !== after.hash.toLowerCase()
    )
      return { status: "mismatch", reason: "block-hash-mismatch" };
    if (tokenDecimals !== pool.tokenDecimals)
      return { status: "mismatch", reason: "token-precision-mismatch" };
    if (
      !Number.isSafeInteger(leafCount) ||
      leafCount < 0 ||
      leafCount > 2 ** pool.depth
    )
      return { status: "unavailable", reason: "historical-data-unavailable" };
    return {
      status: "available",
      snapshot: {
        pool: pool.scope,
        chainId,
        blockNumber: input.blockNumber,
        blockHash: after.hash.toLowerCase() as Hex,
        root: root.toLowerCase() as Hex,
        leafCount,
        token: token.toLowerCase() as Hex,
        tokenDecimals,
        headBlock,
        confirmed: true,
      },
    };
  } catch {
    return { status: "unavailable", reason: "historical-data-unavailable" };
  }
}
let concurrent = 0;
export async function withReceiptSnapshotLimit(
  run: () => Promise<ReceiptChainOutcome>,
  timeoutMs = 12000,
): Promise<ReceiptChainOutcome> {
  if (concurrent >= 8) return { status: "unavailable", reason: "busy" };
  concurrent++;
  const work = Promise.resolve()
    .then(run)
    .catch(
      (): ReceiptChainOutcome => ({
        status: "unavailable",
        reason: "historical-data-unavailable",
      }),
    );
  void work.then(() => {
    concurrent--;
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<ReceiptChainOutcome>((resolve) => {
        timer = setTimeout(
          () => resolve({ status: "unavailable", reason: "rpc-timeout" }),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function getReceiptChainSnapshot(
  input: ReceiptChainInput,
): Promise<ReceiptChainOutcome> {
  return withReceiptSnapshotLimit(() =>
    readReceiptChainSnapshot(input, {
      reader: createReceiptReader(),
      resolve: findPool,
      chainId: chain.id,
    }),
  );
}
