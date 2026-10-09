import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { testPool } from "./helpers/requestFixtures";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";
import { makeTransferFixture } from "./helpers/transferFixtures";

const deps = vi.hoisted(() => ({
  db: null as unknown,
  runtime: null as unknown,
  ledger: null as unknown,
  wallet: "",
}));
vi.mock("../src/server/db/mongo", () => ({ getDb: async () => deps.db }));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: async () => ({ address: deps.wallet }),
}));
vi.mock("../src/server/lib/durableRelayer", async (original) => ({
  ...(await original<typeof import("../src/server/lib/durableRelayer")>()),
  runtimeSender: async () => deps.runtime,
}));
vi.mock("../src/server/lib/relayer", () => ({ relayerConfigured: () => true }));
vi.mock("../src/server/modules/sponsorship/sponsorship.service", () => ({
  sponsorshipLedger: async () => deps.ledger,
}));
vi.mock("../src/lib/pools", async (original) => ({
  ...(await original<typeof import("../src/lib/pools")>()),
  resolvePool: () => testPool,
}));

import { transferSubmissionTypedData } from "../src/features/transfers/transferTypedData";
import type {
  SignedTransferSubmission,
  TransferOperation,
} from "../src/features/transfers/types";
import { maweePoolAbi } from "../src/lib/abi";
import { __resetRateLimit } from "../src/server/lib/rateLimit";
import { OperationSponsorship } from "../src/server/modules/sponsorship/operationAdapters";
import {
  resumeTransfer,
  submitTransfer,
} from "../src/server/modules/transfers/transferOperations";
import { encodeTransferSubmission } from "../src/server/modules/transfers/transferSettlement";
import { TransferRepository } from "../src/server/modules/transfers/transfers.repository";

const h = (value: number) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
beforeEach(() => {
  __resetRateLimit();
});
it.each([
  "normal",
  "price spike",
  "UTC rollover",
  "terminal after preparation",
])("shares one quota across key migration, merge and final private Send: %s", async (mode) => {
  f = await createSponsorSenderFixture(31337);
  const ledger = f.a;
  deps.db = f.db;
  deps.ledger = ledger;
  await ledger.cancelUnsigned(f.action);
  const fixture = await makeTransferFixture(),
    repo = new TransferRepository(f.db),
    record = await repo.create(fixture.record);
  deps.wallet = record.sender.wallet;
  let accepted: SignedTransferSubmission;
  let receipt: TransactionReceipt | null = null;
  const account = f.account,
    port = f.port;
  const frozen = f.frozen;
  let feeSpike = false;
  port.prepare.mockImplementation(async (intent, nonce) => ({
    ...frozen,
    to: intent.to,
    data: intent.data,
    nonce,
    ...(feeSpike
      ? {
          fee: {
            type: 2 as const,
            maxFeePerGas: 210_000_000_000n,
            maxPriorityFeePerGas: 1n,
          },
        }
      : {}),
  }));
  port.receipt = async () => receipt;
  port.broadcast.mockImplementation(async (bytes) => {
    const hash = (await import("viem")).keccak256(bytes);
    const logs = [
      ...accepted.outputs.map((o, index) => ({
        address: testPool.address,
        removed: false,
        topics: encodeEventTopics({
          abi: maweePoolAbi,
          eventName: "Deposit",
          args: { leafIndex: index + accepted.step * 2 },
        }),
        data: encodeAbiParameters(
          [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }],
          [o.commitment, o.ephemeralPk, o.ciphertext],
        ),
      })),
      ...accepted.nullifiers.map((nullifier) => ({
        address: testPool.address,
        removed: false,
        topics: encodeEventTopics({
          abi: maweePoolAbi,
          eventName: "Spend",
          args: { nullifier },
        }),
        data: "0x" as Hex,
      })),
    ];
    receipt = {
      transactionHash: hash,
      to: testPool.address,
      status: "success",
      blockNumber: 10n,
      blockHash: `0x${"b".repeat(64)}`,
      gasUsed: 50_000n,
      effectiveGasPrice: 100_000_000_000n,
      logs,
    } as TransactionReceipt;
    return hash;
  });
  deps.runtime = {
    account,
    journal: f.journal,
    sender: f.sender,
    budget: { ledger },
    reader: {
      call: async () => {},
      getTransaction: async ({ hash }: { hash: Hex }) => ({
        hash,
        to: testPool.address,
        input: encodeTransferSubmission(accepted),
      }),
      getBlockNumber: async () => 12n,
      getBlock: async () => ({ timestamp: 1791417600n }),
    },
  };
  const parents = [];
  for (const [step, kind] of (
    ["split", "merge", "payment"] as const
  ).entries()) {
    if (mode === "UTC rollover" && step === 1) {
      f.clock.set(new Date("2026-10-09T00:00:00Z"));
      port.block = async () => ({
        hash: `0x${"b".repeat(64)}`,
        timestamp: BigInt(Date.parse("2026-10-09T00:00:00Z") / 1000),
      });
    }
    receipt = null;
    const output = {
      commitment:
        kind === "payment" ? record.recipientCommitment : h(20 + step),
      ephemeralPk: h(30 + step),
      ciphertext: "0x1234" as Hex,
    };
    const body = {
      version: 1 as const,
      transferId: record.id,
      operationId: record.operationId,
      step,
      pool: record.pool,
      kind,
      root: h(1),
      nullifiers:
        kind === "merge" ? [h(40 + step), h(50 + step)] : [h(40 + step)],
      proof: {
        a: ["1", "2"] as const,
        b: [
          ["1", "2"],
          ["1", "2"],
        ] as const,
        c: ["1", "2"] as const,
      },
      outputs:
        kind === "merge"
          ? [output]
          : [output, { ...output, commitment: h(60 + step) }],
      recoveryEnvelope: record.senderEnvelope,
    };
    accepted = {
      ...body,
      signature: await fixture.signer.walletClient.signTypedData({
        account: fixture.signer.walletClient.account ?? fixture.signer.address,
        ...transferSubmissionTypedData(body),
      }),
    };
    let result: TransferOperation;
    if (mode === "price spike" && step === 1) {
      feeSpike = true;
      await expect(submitTransfer("alice", accepted)).rejects.toMatchObject({
        reason: "cost",
      });
      const paused = await repo.collection.findOne({ _id: record.id });
      expect(paused).toMatchObject({
        currentSubmission: { kind: "merge" },
        operation: {
          nextStep: 1,
          sponsorshipPause: "cost",
          sponsorshipAction: parents[0],
        },
      });
      expect(port.sign).toHaveBeenCalledTimes(1);
      feeSpike = false;
      result = await resumeTransfer("alice", record.id);
    } else result = await submitTransfer("alice", accepted);
    expect(result.phase).toBe(kind === "payment" ? "confirmed" : "preparing");
    parents.push(result.sponsorshipAction);
    if (mode === "terminal after preparation" && step === 0) {
      if (!result.sponsorshipAction) throw Error("Missing admitted parent");
      await expect(
        ledger.cancelUnsigned(result.sponsorshipAction),
      ).rejects.toMatchObject({ reason: "budget" });
      await repo.collection.updateOne(
        { _id: record.id },
        { $set: { status: "failed", "operation.phase": "failed" } },
      );
      await new OperationSponsorship(ledger).finish(
        "transfer",
        record.operationId,
      );
      break;
    }
  }
  expect(parents[0]).toBeDefined();
  if (mode !== "terminal after preparation") {
    expect(parents[1]).toEqual(parents[0]);
    expect(parents[2]).toEqual(parents[0]);
  }
  expect(await ledger.status({ kind: "user", key: "alice" })).toMatchObject({
    used: mode === "UTC rollover" ? 0 : 1,
    reserved: 0,
  });
  const snapshot = await ledger.repo.snapshot(31337);
  expect(snapshot.usedWeiStr).toBe(
    mode === "UTC rollover"
      ? "10000000000000000"
      : mode === "terminal after preparation"
        ? "5000000000000000"
        : "15000000000000000",
  );
});
