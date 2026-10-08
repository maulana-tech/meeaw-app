import "server-only";
import { type Hex, parseTransaction, recoverTransactionAddress } from "viem";
import type {
  FeeEvidence,
  FrozenTx,
} from "../../../features/sponsorship/types";
import { SponsorshipError } from "./sponsorship.errors";

const UINT256 = (1n << 256n) - 1n,
  UINT64 = (1n << 64n) - 1n;
const address = /^0x[0-9a-fA-F]{40}$/;
const hex = /^0x(?:[0-9a-fA-F]{2})*$/;
function reject(): never {
  throw new SponsorshipError("cost");
}
function price(tx: FrozenTx): bigint {
  if (
    ![143, 10143, 31337].includes(tx.chainId) ||
    !Number.isSafeInteger(tx.nonce) ||
    tx.nonce < 0 ||
    !address.test(tx.from) ||
    !address.test(tx.to) ||
    !hex.test(tx.data) ||
    tx.value !== 0n ||
    typeof tx.gas !== "bigint" ||
    tx.gas <= 0n ||
    tx.gas > UINT64
  )
    reject();
  if (tx.fee.type !== 0 && tx.fee.type !== 2) reject();
  const amount = tx.fee.type === 0 ? tx.fee.gasPrice : tx.fee.maxFeePerGas;
  if (typeof amount !== "bigint" || amount <= 0n || amount > UINT256) reject();
  if (
    tx.fee.type === 2 &&
    (typeof tx.fee.maxPriorityFeePerGas !== "bigint" ||
      tx.fee.maxPriorityFeePerGas < 0n ||
      tx.fee.maxPriorityFeePerGas > amount)
  )
    reject();
  return amount;
}
export function maximumLiability(tx: FrozenTx): bigint {
  const amount = tx.gas * price(tx);
  if (amount > UINT256) reject();
  return amount;
}
function same(a: FrozenTx, b: FrozenTx): boolean {
  if (
    a.chainId !== b.chainId ||
    a.from.toLowerCase() !== b.from.toLowerCase() ||
    a.to.toLowerCase() !== b.to.toLowerCase() ||
    a.data.toLowerCase() !== b.data.toLowerCase() ||
    a.nonce !== b.nonce ||
    a.gas !== b.gas ||
    a.value !== b.value ||
    a.fee.type !== b.fee.type
  )
    return false;
  if (a.fee.type === 0 && b.fee.type === 0)
    return a.fee.gasPrice === b.fee.gasPrice;
  return (
    a.fee.type === 2 &&
    b.fee.type === 2 &&
    a.fee.maxFeePerGas === b.fee.maxFeePerGas &&
    a.fee.maxPriorityFeePerGas === b.fee.maxPriorityFeePerGas
  );
}
export function accountedFee(tx: FrozenTx, evidence: FeeEvidence): bigint {
  const ceiling = price(tx);
  price(evidence.transaction);
  if (
    !same(tx, evidence.transaction) ||
    typeof evidence.gasUsed !== "bigint" ||
    evidence.gasUsed < 0n ||
    evidence.gasUsed > tx.gas ||
    typeof evidence.effectiveGasPrice !== "bigint" ||
    evidence.effectiveGasPrice < 0n ||
    evidence.effectiveGasPrice > ceiling
  )
    reject();
  return (
    (tx.chainId === 31337 ? evidence.gasUsed : tx.gas) *
    evidence.effectiveGasPrice
  );
}
export async function validateSignedTx(
  bytes: Hex,
  expected: FrozenTx,
): Promise<void> {
  try {
    maximumLiability(expected);
    const parsed = parseTransaction(bytes);
    if (parsed.type !== "legacy" && parsed.type !== "eip1559") reject();
    const from = await recoverTransactionAddress({
      serializedTransaction: bytes as Parameters<
        typeof recoverTransactionAddress
      >[0]["serializedTransaction"],
    });
    if (
      !parsed.to ||
      parsed.gas === undefined ||
      parsed.nonce === undefined ||
      parsed.chainId === undefined
    )
      reject();
    let fee: FrozenTx["fee"];
    if (parsed.type === "legacy") {
      if (parsed.gasPrice === undefined) reject();
      fee = { type: 0, gasPrice: parsed.gasPrice };
    } else {
      if (
        parsed.maxFeePerGas === undefined ||
        parsed.maxPriorityFeePerGas === undefined
      )
        reject();
      fee = {
        type: 2,
        maxFeePerGas: parsed.maxFeePerGas,
        maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
      };
    }
    if ((parsed.value ?? 0n) !== 0n) reject();
    const actual: FrozenTx = {
      chainId: parsed.chainId,
      from,
      to: parsed.to,
      data: parsed.data ?? "0x",
      nonce: parsed.nonce,
      gas: parsed.gas,
      value: 0n,
      fee,
    };
    maximumLiability(actual);
    if (!same(actual, expected)) reject();
  } catch {
    reject();
  }
}
