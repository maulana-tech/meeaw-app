import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { maweePoolAbi } from "../src/lib/abi";
import {
  operationSponsorLedger,
  resetOperationSponsorLedger,
} from "./helpers/operationSponsorLedger";
import { openIsolatedRequestDb } from "./helpers/requestDb";

vi.mock("../src/server/modules/sponsorship/sponsorship.service", () => ({
  sponsorshipLedger: async () =>
    operationSponsorLedger(deps.db as import("mongodb").Db),
}));

import { transferSubmissionTypedData } from "../src/features/transfers/transferTypedData";
import type { SignedTransferSubmission } from "../src/features/transfers/types";
import { TransferRepository } from "../src/server/modules/transfers/transfers.repository";
import { testPool } from "./helpers/requestFixtures";
import { makeTransferFixture } from "./helpers/transferFixtures";

const deps = vi.hoisted(() => ({
  db: null as unknown,
  runtime: null as unknown,
  wallet: "",
}));
vi.mock("../src/server/db/mongo", () => ({ getDb: async () => deps.db }));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: async () => ({ address: deps.wallet }),
}));
vi.mock("../src/server/lib/durableRelayer", () => ({
  runtimeSender: async () => deps.runtime,
}));
vi.mock("../src/server/lib/relayer", () => ({ relayerConfigured: () => true }));
vi.mock("../src/lib/pools", async (original) => ({
  ...(await original<typeof import("../src/lib/pools")>()),
  resolvePool: () => testPool,
  requestPool: () => testPool,
}));

import {
  resumeTransfer,
  submitTransfer,
  transferEvidence,
  transferStatus,
} from "../src/server/modules/transfers/transferOperations";

const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
describe("direct transfer operation state", () => {
  let db: Awaited<ReturnType<typeof openIsolatedRequestDb>>,
    repo: TransferRepository;
  beforeAll(async () => {
    db = await openIsolatedRequestDb();
    deps.db = db.db;
    repo = new TransferRepository(db.db);
    await repo.ensureIndexes();
  }, 15000);
  beforeEach(async () => {
    await resetOperationSponsorLedger(db.db);
    await repo.collection.deleteMany({});
    await repo.steps.deleteMany({});
  });
  afterAll(async () => {
    await db?.close();
  });
  async function prepare() {
    const f = await makeTransferFixture(),
      record = await repo.create(f.record);
    deps.wallet = record.sender.wallet;
    const body: Omit<SignedTransferSubmission, "signature"> = {
      version: 1,
      transferId: record.id,
      operationId: record.operationId,
      step: 0,
      pool: record.pool,
      kind: "payment",
      root: h(1),
      nullifiers: [h(2)],
      proof: {
        a: ["1", "2"],
        b: [
          ["1", "2"],
          ["1", "2"],
        ],
        c: ["1", "2"],
      },
      outputs: [
        {
          commitment: record.recipientCommitment,
          ephemeralPk: h(3),
          ciphertext: "0x1234",
        },
        { commitment: h(4), ephemeralPk: h(5), ciphertext: "0x1234" },
      ],
      recoveryEnvelope: record.senderEnvelope,
    };
    const signature = await f.signer.walletClient.signTypedData({
      account: f.signer.walletClient.account ?? f.signer.address,
      ...transferSubmissionTypedData(body),
    });
    const submission = { ...body, signature };
    let prepared = 0,
      broadcasts = 0,
      available = false;
    const txHash = h(8),
      data = (
        await import("../src/server/modules/transfers/transferSettlement")
      ).encodeTransferSubmission(submission);
    const logs = submission.outputs.map((o, i) => ({
      address: testPool.address,
      removed: false,
      topics: encodeEventTopics({
        abi: maweePoolAbi,
        eventName: "Deposit",
        args: { leafIndex: i },
      }),
      data: encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }],
        [o.commitment, o.ephemeralPk, o.ciphertext],
      ),
    }));
    logs.push({
      address: testPool.address,
      removed: false,
      topics: encodeEventTopics({
        abi: maweePoolAbi,
        eventName: "Spend",
        args: { nullifier: h(2) },
      }),
      data: "0x",
    } as (typeof logs)[number]);
    const receipt = {
      transactionHash: txHash,
      to: testPool.address,
      status: "success",
      blockNumber: 1n,
      logs,
    } as unknown as TransactionReceipt;
    deps.runtime = {
      account: privateKeyToAccount(h(1)),
      journal: {
        read: async () =>
          available ? { serializedTransaction: "0x1234" } : null,
      },
      reader: {
        call: async () => {},
        getTransaction: async () => ({
          hash: txHash,
          to: testPool.address,
          input: data,
        }),
        getBlockNumber: async () => 2n,
        getBlock: async () => ({ timestamp: 1791244800n }),
      },
      sender: {
        prepare: async () => {
          prepared++;
          return { txHash };
        },
        broadcast: async () => {
          broadcasts++;
          available = true;
        },
        reconcile: async () =>
          available
            ? { state: "confirmed", receipt }
            : { state: "unknown", receipt: null },
      },
    };
    return { f, record, submission, stats: () => ({ prepared, broadcasts }) };
  }
  it("confirms exact evidence and makes final submission retries idempotent", async () => {
    const f = await prepare();
    const result = await submitTransfer("sender", f.submission);
    expect(result.phase).toBe("confirmed");
    await submitTransfer("sender", f.submission);
    expect(f.stats().broadcasts).toBe(1);
    expect((await transferEvidence("sender", f.record.id)).steps).toHaveLength(
      1,
    );
  });
  it("keeps immutable step ciphertext outside the bounded transfer document", async () => {
    const f = await prepare();
    await submitTransfer("step-storage", f.submission);
    const raw = await repo.collection.findOne({ _id: f.record.id });
    expect(raw).not.toHaveProperty("submissions");
    expect(raw).not.toHaveProperty("steps");
    expect(
      await db.db
        .collection("private_transfer_steps")
        .countDocuments({ transferId: f.record.id }),
    ).toBe(1);
  });
  it("applies the submission budget to resume attempts", async () => {
    const f = await prepare();
    for (let n = 0; n < 20; n++)
      await resumeTransfer("resume-budget", f.record.id);
    await expect(resumeTransfer("resume-budget", f.record.id)).rejects.toThrow(
      /Too many/,
    );
  });
  it("rejects recipient spending authority and altered final commitment", async () => {
    const f = await prepare();
    deps.wallet = f.record.recipient.wallet;
    await expect(submitTransfer("recipient", f.submission)).rejects.toThrow();
    deps.wallet = f.record.sender.wallet;
    await expect(
      submitTransfer("sender", {
        ...f.submission,
        outputs: [
          { ...f.submission.outputs[0], commitment: h(9) },
          f.submission.outputs[1],
        ],
      }),
    ).rejects.toThrow();
    expect(f.stats().broadcasts).toBe(0);
  });
  it("keeps an uncertain broadcast pending until reconciliation", async () => {
    const f = await prepare();
    const runtime = deps.runtime as {
      sender: { broadcast: () => Promise<void> };
    };
    runtime.sender.broadcast = async () => {
      throw new Error("network timeout");
    };
    const result = await submitTransfer("sender", f.submission);
    expect(result.phase).toBe("needsReconciliation");
    expect((await repo.get(deps.wallet, f.record.id)).status).toBe("pending");
    expect((await transferStatus("sender", f.record.id)).phase).toBe(
      "needsReconciliation",
    );
  });
});
