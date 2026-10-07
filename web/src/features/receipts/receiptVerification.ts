import type { PoolDescriptor } from "../../lib/pools";
import type {
  LoadReceiptSnapshot,
  ReceiptChainOutcome,
} from "./receiptChainTypes";
import { canonicalReceiptJson, receiptIdentity } from "./receiptIdentity";
import { verifyReceiptMath } from "./receiptProof";
import { parseReceiptJson } from "./receiptSchema";
import type {
  ReceiptBundle,
  ReceiptIdentity,
  ReceiptV2,
  ReceiptVerificationResult,
} from "./receiptTypes";
export function compareReceiptSnapshot(
  bundle: ReceiptV2,
  pool: PoolDescriptor,
  outcome: ReceiptChainOutcome,
  identity: ReceiptIdentity,
): ReceiptVerificationResult {
  if (outcome.status === "unavailable")
    return {
      status: "unavailable",
      local: "passed",
      chain: "unavailable",
      reason: outcome.reason,
      identity,
    };
  if (outcome.status === "mismatch")
    return {
      status: "invalid",
      local: "passed",
      chain: "failed",
      reason: outcome.reason,
    };
  const s = outcome.snapshot;
  if (
    !s.confirmed ||
    s.headBlock - bundle.anchor.blockNumber + 1 < pool.confirmations
  )
    return {
      status: "unavailable",
      local: "passed",
      chain: "unavailable",
      reason: "insufficient-confirmations",
      identity,
    };
  if (
    s.pool !== pool.scope ||
    s.chainId !== pool.chainId ||
    s.blockNumber !== bundle.anchor.blockNumber ||
    s.blockHash.toLowerCase() !== bundle.anchor.blockHash.toLowerCase() ||
    BigInt(s.root) !== BigInt(bundle.root) ||
    s.leafCount !== bundle.anchor.leafCount ||
    bundle.leafIndex >= s.leafCount ||
    s.token.toLowerCase() !== pool.token.toLowerCase() ||
    s.tokenDecimals !== pool.tokenDecimals ||
    bundle.asset !== pool.asset ||
    bundle.tokenDecimals !== pool.tokenDecimals
  )
    return {
      status: "invalid",
      local: "passed",
      chain: "failed",
      reason: "snapshot-mismatch",
    };
  return { status: "verified", local: "passed", chain: "passed", identity };
}
export async function verifyReceipt(
  bundle: ReceiptBundle,
  pool: PoolDescriptor,
  load: LoadReceiptSnapshot,
  isCurrent: () => boolean = () => true,
): Promise<ReceiptVerificationResult> {
  try {
    const parsed = parseReceiptJson(canonicalReceiptJson(bundle), (s) =>
      s === pool.scope ? pool : null,
    );
    if (parsed.status !== "parsed")
      return parsed.status === "unsupported"
        ? {
            status: "unavailable",
            local: "not-run",
            chain: "unavailable",
            reason: parsed.reason,
          }
        : {
            status: "invalid",
            local: "failed",
            chain: "not-run",
            reason: parsed.reason,
          };
    const b = parsed.bundle;
    if (!(await verifyReceiptMath(b, pool.depth)).valid)
      return {
        status: "invalid",
        local: "failed",
        chain: "not-run",
        reason: "proof-mismatch",
      };
    const identity = await receiptIdentity(b);
    if (b.version === 1)
      return {
        status: "unavailable",
        local: "passed",
        chain: "unavailable",
        reason: "anchor-missing",
        identity,
      };
    if (!isCurrent())
      return {
        status: "unavailable",
        local: "passed",
        chain: "unavailable",
        reason: "cancelled",
      };
    let outcome: ReceiptChainOutcome;
    try {
      outcome = await load({
        pool: pool.scope,
        blockNumber: b.anchor.blockNumber,
        blockHash: b.anchor.blockHash,
      });
    } catch {
      return {
        status: "unavailable",
        local: "passed",
        chain: "unavailable",
        reason: "historical-data-unavailable",
        identity,
      };
    }
    if (!isCurrent())
      return {
        status: "unavailable",
        local: "passed",
        chain: "unavailable",
        reason: "cancelled",
      };
    return compareReceiptSnapshot(b, pool, outcome, identity);
  } catch {
    return {
      status: "invalid",
      local: "failed",
      chain: "not-run",
      reason: "malformed-receipt",
    };
  }
}
