import "server-only";
import {
  decodeFunctionData,
  type Hex,
  parseEventLogs,
  type TransactionReceipt,
} from "viem";
import { maweePoolAbi } from "../../../lib/abi";
import type { PoolDescriptor } from "../../../lib/pools";

export type InvoiceEvidenceTarget = {
  pool: PoolDescriptor;
  commitment: Hex;
  ephemeralPk: Hex;
  ciphertext: Hex;
  createdBlock: number;
};
export function verifyInvoiceRevert(input: {
  invoice: InvoiceEvidenceTarget & { amount: string };
  hash: Hex;
  chainId: number;
  head: bigint;
  canonicalHash: Hex | null;
  receipt: TransactionReceipt;
  transaction: {
    hash: Hex;
    to: Hex | null;
    input: Hex;
    blockHash: Hex | null;
    blockNumber: bigint | null;
  };
}): boolean {
  const { invoice, receipt: r, transaction: tx } = input;
  const same = (a: string | null | undefined, b: string) =>
    a?.toLowerCase() === b.toLowerCase();
  try {
    if (
      input.chainId !== invoice.pool.chainId ||
      r.status !== "reverted" ||
      !same(r.to, invoice.pool.address) ||
      !same(r.transactionHash, input.hash) ||
      !same(input.canonicalHash, r.blockHash) ||
      input.head < r.blockNumber ||
      input.head - r.blockNumber + 1n < BigInt(invoice.pool.confirmations) ||
      r.blockNumber <
        BigInt(Math.max(invoice.createdBlock, invoice.pool.deployBlock)) ||
      !same(tx.hash, input.hash) ||
      !same(tx.to, invoice.pool.address) ||
      !same(tx.blockHash, r.blockHash) ||
      tx.blockNumber !== r.blockNumber
    )
      return false;
    const decoded = decodeFunctionData({ abi: maweePoolAbi, data: tx.input });
    if (decoded.functionName === "deposit")
      return (
        same(decoded.args[0], invoice.commitment) &&
        decoded.args[1] === BigInt(invoice.amount) &&
        same(decoded.args[3], invoice.ephemeralPk) &&
        same(decoded.args[4], invoice.ciphertext)
      );
    if (decoded.functionName === "depositWithAuthorization")
      return (
        same(decoded.args[1], invoice.commitment) &&
        decoded.args[2] === BigInt(invoice.amount) &&
        same(decoded.args[4], invoice.ephemeralPk) &&
        same(decoded.args[5], invoice.ciphertext)
      );
    return false;
  } catch {
    return false;
  }
}
export function verifyInvoiceReceipt(input: {
  invoice: InvoiceEvidenceTarget;
  hash: Hex;
  chainId: number;
  head: bigint;
  canonicalHash: Hex | null;
  receipt: TransactionReceipt;
}): number | null {
  const { invoice, receipt: r } = input;
  const same = (a: string | null | undefined, b: string) =>
    a?.toLowerCase() === b.toLowerCase();
  try {
    if (
      input.chainId !== invoice.pool.chainId ||
      r.status !== "success" ||
      !same(r.to, invoice.pool.address) ||
      !same(r.transactionHash, input.hash) ||
      !same(input.canonicalHash, r.blockHash) ||
      r.blockNumber <
        BigInt(Math.max(invoice.createdBlock, invoice.pool.deployBlock)) ||
      input.head < r.blockNumber ||
      input.head - r.blockNumber + 1n < BigInt(invoice.pool.confirmations)
    )
      return null;
    const logs = r.logs.filter(
      (log) =>
        same(log.address, invoice.pool.address) &&
        !log.removed &&
        same(log.transactionHash, r.transactionHash) &&
        same(log.blockHash, r.blockHash) &&
        log.blockNumber === r.blockNumber,
    );
    const deposits = parseEventLogs({
      abi: maweePoolAbi,
      eventName: "Deposit",
      logs,
      strict: true,
    }).filter(
      (log) =>
        same(log.args.commitment, invoice.commitment) &&
        same(log.args.ephemeralPk, invoice.ephemeralPk) &&
        same(log.args.ciphertext, invoice.ciphertext),
    );
    if (deposits.length !== 1) return null;
    const leafIndex = Number(deposits[0].args.leafIndex);
    return Number.isSafeInteger(leafIndex) && leafIndex >= 0 ? leafIndex : null;
  } catch {
    return null;
  }
}
