import { z } from "zod";
import { ASSET_SYMBOLS } from "../../lib/assets";
import { formatAssetUnits } from "../../lib/paymentAsset";
import type { PoolDescriptor } from "../../lib/pools";
import { findPool } from "../../lib/pools";
import { MAX_REQUEST_AMOUNT, SNARK_FIELD } from "../requests/validation";
import type { ReceiptBundle, ReceiptParseResult } from "./receiptTypes";
export const MAX_RECEIPT_BYTES = 65_536;
const boundedDecimal = (digits: number) =>
  z.string().regex(/^\d+$/).max(digits);
const scalar = boundedDecimal(78).refine(
  (v) => v.length <= 78 && /^\d+$/.test(v) && BigInt(v) < SNARK_FIELD,
);
const amount = boundedDecimal(20).refine(
  (v) =>
    v.length <= 20 &&
    /^\d+$/.test(v) &&
    BigInt(v) > 0n &&
    BigInt(v) <= MAX_REQUEST_AMOUNT,
);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const common = {
  pool: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  network: z.string().max(32),
  leafIndex: z
    .number()
    .int()
    .min(0)
    .max(2 ** 20 - 1),
  commitmentHex: z.string().regex(/^[0-9a-fA-F]{64}$/),
  commitment: scalar,
  rootHex: z.string().regex(/^[0-9a-fA-F]{64}$/),
  root: scalar,
  amount,
  amountLabel: z.string().max(80),
  ownerPk: scalar,
  salt: scalar,
  pathElements: z.array(scalar).length(20),
  pathIndices: z.array(z.union([z.literal(0), z.literal(1)])).length(20),
  username: z.string().max(33).nullable(),
  disclosedAt: z
    .string()
    .max(40)
    .refine((v) => Number.isFinite(Date.parse(v))),
};
export const receiptWireSchema = z.discriminatedUnion("version", [
  z.strictObject({
    ...common,
    version: z.literal(1),
    asset: z.enum(ASSET_SYMBOLS).optional(),
    tokenDecimals: z.number().int().min(0).max(18).optional(),
  }),
  z.strictObject({
    ...common,
    version: z.literal(2),
    asset: z.enum(ASSET_SYMBOLS),
    tokenDecimals: z.number().int().min(0).max(18),
    anchor: z.strictObject({
      blockNumber: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      blockHash: hash,
      leafCount: z
        .number()
        .int()
        .min(1)
        .max(2 ** 20),
    }),
  }),
]);
export function receiptShapeValid(bundle: ReceiptBundle, depth = 20): boolean {
  return (
    bundle.pathElements.length === depth &&
    bundle.pathIndices.length === depth &&
    bundle.leafIndex < 2 ** depth &&
    bundle.pathIndices.every(
      (v, i) => v === Math.floor(bundle.leafIndex / 2 ** i) % 2,
    ) &&
    BigInt(`0x${bundle.commitmentHex}`) === BigInt(bundle.commitment) &&
    BigInt(`0x${bundle.rootHex}`) === BigInt(bundle.root) &&
    (bundle.version === 1 || bundle.leafIndex < bundle.anchor.leafCount)
  );
}
export function normalizeReceipt(bundle: ReceiptBundle): ReceiptBundle {
  const decimal = (v: string) => BigInt(v).toString();
  const normalized = {
    ...bundle,
    pool: bundle.pool.toLowerCase(),
    commitment: decimal(bundle.commitment),
    commitmentHex: bundle.commitmentHex.toLowerCase(),
    root: decimal(bundle.root),
    rootHex: bundle.rootHex.toLowerCase(),
    amount: decimal(bundle.amount),
    ownerPk: decimal(bundle.ownerPk),
    salt: decimal(bundle.salt),
    pathElements: bundle.pathElements.map(decimal),
  };
  return bundle.version === 2
    ? {
        ...normalized,
        version: 2,
        asset: bundle.asset,
        tokenDecimals: bundle.tokenDecimals,
        anchor: {
          ...bundle.anchor,
          blockHash: bundle.anchor.blockHash.toLowerCase() as `0x${string}`,
        },
      }
    : { ...normalized, version: 1 };
}
export function parseReceiptJson(
  text: string,
  resolve: (scope: string) => PoolDescriptor | null = findPool,
): ReceiptParseResult {
  try {
    if (
      text.length > MAX_RECEIPT_BYTES ||
      new TextEncoder().encode(text).byteLength > MAX_RECEIPT_BYTES
    )
      return { status: "invalid", reason: "file-too-large" };
    const raw: unknown = JSON.parse(text);
    if (
      raw &&
      typeof raw === "object" &&
      "version" in raw &&
      raw.version !== 1 &&
      raw.version !== 2
    )
      return { status: "unsupported", reason: "unsupported-version" };
    const result = receiptWireSchema.safeParse(raw);
    if (!result.success)
      return { status: "invalid", reason: "malformed-receipt" };
    let bundle = normalizeReceipt(result.data as ReceiptBundle);
    if (!receiptShapeValid(bundle))
      return { status: "invalid", reason: "proof-shape-mismatch" };
    const network = /^eip155:([1-9]\d{0,15})$/.exec(bundle.network);
    if (!network)
      return { status: "unsupported", reason: "unsupported-network" };
    const pool = resolve(`${network[1]}:${bundle.pool}`);
    if (!pool) return { status: "unsupported", reason: "unsupported-pool" };
    if (pool.depth !== 20 || pool.chainId !== Number(network[1]))
      return { status: "unsupported", reason: "unsupported-pool" };
    if (bundle.version === 1) {
      if (
        (bundle.asset === undefined || bundle.tokenDecimals === undefined) &&
        pool.asset !== "USDC"
      )
        return { status: "unsupported", reason: "legacy-asset-missing" };
      bundle = {
        ...bundle,
        asset: bundle.asset ?? pool.asset,
        tokenDecimals: bundle.tokenDecimals ?? pool.tokenDecimals,
      };
    }
    if (
      bundle.asset !== pool.asset ||
      bundle.tokenDecimals !== pool.tokenDecimals ||
      bundle.amountLabel !==
        formatAssetUnits(BigInt(bundle.amount), pool.tokenDecimals)
    )
      return { status: "invalid", reason: "asset-label-mismatch" };
    return { status: "parsed", bundle, pool };
  } catch {
    return { status: "invalid", reason: "malformed-receipt" };
  }
}
