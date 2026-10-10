import {
  encodeAbiParameters,
  encodeEventTopics,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it } from "vitest";
import { maweePoolAbi } from "../src/lib/abi";
import { verifyInvoiceReceipt } from "../src/server/modules/invoices/invoiceReceipt";
import { assetPool } from "./helpers/multiAssetFixtures";

const hash = `0x${"a".repeat(64)}` as const;
const blockHash = `0x${"b".repeat(64)}` as const;
const commitment = `0x${"c".repeat(64)}` as const;
const ephemeralPk = `0x${"d".repeat(64)}` as const;
const ciphertext = `0x${"ef".repeat(88)}` as const;
const pool = assetPool("AUSD");
function invoiceReceiptFixture() {
  const log = {
    address: pool.address,
    topics: encodeEventTopics({
      abi: maweePoolAbi,
      eventName: "Deposit",
      args: { leafIndex: 4 },
    }),
    data: encodeAbiParameters(
      [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }],
      [commitment, ephemeralPk, ciphertext],
    ),
    removed: false,
    transactionHash: hash,
    blockHash,
    blockNumber: 10n,
    logIndex: 0,
    transactionIndex: 0,
  };
  const receipt = {
    status: "success",
    to: pool.address,
    transactionHash: hash,
    blockHash,
    blockNumber: 10n,
    logs: [log],
  } as unknown as TransactionReceipt;
  const invoice = {
    pool,
    commitment,
    ephemeralPk,
    ciphertext,
    createdBlock: 9,
  };
  return {
    invoice,
    receipt,
    hash,
    chainId: pool.chainId,
    head: 10n,
    canonicalHash: blockHash,
  };
}
describe("invoice payment evidence", () => {
  it("accepts only the canonical invoice note at the configured pool", () => {
    expect(verifyInvoiceReceipt(invoiceReceiptFixture())).toBe(4);
  });
  it.each([
    "chain",
    "pool",
    "reverted",
    "confirmations",
    "reorg",
    "removed",
    "commitment",
    "envelope",
    "txhash",
    "oldblock",
  ])("rejects %s evidence", (kind) => {
    const f = invoiceReceiptFixture();
    if (kind === "chain") f.chainId++;
    if (kind === "pool") f.receipt.to = assetPool("USDC").address;
    if (kind === "reverted") f.receipt.status = "reverted";
    if (kind === "confirmations") f.head = 9n;
    if (kind === "reorg")
      f.canonicalHash = `0x${"1".repeat(64)}` as typeof blockHash;
    if (kind === "removed") f.receipt.logs[0].removed = true;
    if (kind === "commitment")
      f.invoice.commitment = `0x${"1".repeat(64)}` as typeof commitment;
    if (kind === "envelope") f.invoice.ciphertext = "0x00" as typeof ciphertext;
    if (kind === "txhash") f.receipt.transactionHash = `0x${"1".repeat(64)}`;
    if (kind === "oldblock") f.invoice.createdBlock = 11;
    expect(verifyInvoiceReceipt(f)).toBeNull();
  });
});
