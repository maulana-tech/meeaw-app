import { type Hex, keccak256, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vi } from "vitest";
import type { FrozenTx } from "../../src/features/sponsorship/types";
import {
  makeDurableSender,
  type RelayIntent,
} from "../../src/server/lib/durableRelayer";
import { RelayJournal } from "../../src/server/lib/relayJournal";
import { createSponsorFixture } from "./sponsorshipFixtures";
export async function createSponsorSenderFixture() {
  const f = await createSponsorFixture(),
    account = privateKeyToAccount(`0x${"01".repeat(32)}`);
  const action = await f.a.admit(f.intent("sender"));
  const intent: RelayIntent = {
    chainId: 143,
    wallet: account.address,
    to: "0x2222222222222222222222222222222222222222",
    data: "0x1234",
    operationKey: "test-sponsorship",
    confirmations: 1,
    sponsorship: { action, childId: "one" },
  } as RelayIntent;
  let mined: TransactionReceipt | null = null;
  const blockHash = `0x${"b".repeat(64)}` as Hex;
  const frozen: FrozenTx = {
    chainId: 143,
    from: account.address,
    to: intent.to,
    data: intent.data,
    nonce: 0,
    gas: 100_000n,
    value: 0n,
    fee: { type: 2, maxFeePerGas: 200_000_000_000n, maxPriorityFeePerGas: 1n },
  };
  const prepare = vi.fn(async (_i: RelayIntent, nonce: number) => ({
    ...frozen,
    nonce,
  }));
  const sign = vi.fn(async (tx: FrozenTx) =>
    account.signTransaction({
      chainId: tx.chainId,
      to: tx.to,
      data: tx.data,
      nonce: tx.nonce,
      gas: tx.gas,
      value: 0n,
      type: "eip1559",
      maxFeePerGas: tx.fee.type === 2 ? tx.fee.maxFeePerGas : tx.fee.gasPrice,
      maxPriorityFeePerGas: 1n,
    }),
  );
  const port = {
    pendingNonce: async () => 0,
    blockNumber: async () => 12n,
    receipt: async () => mined,
    block: async () => ({
      hash: blockHash,
      timestamp: BigInt(Date.parse("2026-10-08T00:00:00Z") / 1000),
    }),
    balance: async () => 10_000_000_000_000_000_000n,
    prepare,
    sign,
    prepareAndSign: async (i: RelayIntent, nonce: number) =>
      sign(await prepare(i, nonce)),
    broadcast: vi.fn(async (bytes: Hex) => keccak256(bytes)),
  };
  const journal = new RelayJournal(f.db);
  const sender = makeDurableSender(journal, port, undefined, {
    ledger: f.a,
    policy: () => ({ ready: true, policy: f.policy }),
  });
  return {
    ...f,
    account,
    action,
    intent,
    frozen,
    port,
    journal,
    sender,
    setReceipt(hash: Hex, outcome: "success" | "reverted" = "success") {
      mined = {
        transactionHash: hash,
        blockNumber: 10n,
        blockHash,
        status: outcome,
        gasUsed: 50_000n,
        effectiveGasPrice: 100_000_000_000n,
      } as TransactionReceipt;
    },
  };
}
