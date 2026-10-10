import { type Hex, keccak256, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, expect, it } from "vitest";
import type { RelaySend } from "../src/server/lib/relayJournal";
import { ledgerKey } from "../src/server/modules/sponsorship/ledgerModel";
import { SponsorshipRecovery } from "../src/server/modules/sponsorship/recovery";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";

let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
it("advances beyond twenty unresolved signatures rather than starving later settlement", async () => {
  f = await createSponsorSenderFixture();
  await f.a.cancelUnsigned(f.action);
  const entries = [];
  for (let n = 1; n <= 21; n++) {
    const account = privateKeyToAccount(
        `0x${n.toString(16).padStart(64, "0")}`,
      ),
      tx = { ...f.frozen, from: account.address };
    const bytes = await account.signTransaction({
        chainId: 143,
        to: tx.to,
        data: tx.data,
        nonce: 0,
        gas: tx.gas,
        maxFeePerGas: 200_000_000_000n,
        maxPriorityFeePerGas: 1n,
        type: "eip1559",
      }),
      hash = keccak256(bytes),
      actionId = `legacy:${hash}`;
    entries.push({
      account,
      tx,
      bytes,
      hash,
      actionId,
      key: ledgerKey(actionId),
    });
  }
  entries.sort((a, b) => a.key.localeCompare(b.key));
  for (const e of entries) {
    const ticket = await f.a.importLegacy({
      kind: "import",
      intent: {
        chainId: 143,
        actionId: e.actionId,
        kind: "legacy-transfer",
        principal: { kind: "anonymous", key: "shared" },
        businessDigest: e.hash,
        maximumChildren: 1,
      },
      tx: e.tx,
      digest: e.hash,
      hash: e.hash,
      walletFence: 1,
    });
    const walletKey = `143:${e.account.address.toLowerCase()}`,
      operationKey = e.actionId;
    await f.journal.sends.insertOne({
      _id: `${walletKey}:${operationKey}`,
      walletKey,
      operationKey,
      digest: e.hash,
      fence: 1,
      nonce: 0,
      phase: "unknown",
      expiresAt: new Date(0),
      serializedTransaction: e.bytes,
      txHash: e.hash,
      budgetChild: ticket,
      intent: {
        chainId: 143,
        wallet: e.account.address,
        to: e.tx.to,
        data: e.tx.data,
        operationKey,
        confirmations: 1,
      },
    } as RelaySend & { _id: string });
  }
  const last = entries[20];
  f.port.receipt = async (hash: Hex) =>
    hash === last.hash
      ? ({
          transactionHash: hash,
          blockHash: `0x${"b".repeat(64)}`,
          blockNumber: 10n,
          status: "success",
          gasUsed: 50_000n,
          effectiveGasPrice: 100_000_000_000n,
        } as TransactionReceipt)
      : null;
  const recovery = new SponsorshipRecovery(f.a, f.journal, f.port, 143);
  expect((await recovery.reconcile(20)).settled).toBe(0);
  expect((await recovery.reconcile(20)).settled).toBe(1);
});
