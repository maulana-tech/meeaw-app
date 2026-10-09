import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { AccountSpendGate } from "../src/server/modules/privacyKeys/spendGate";
import {
  operationSponsorLedger,
  resetOperationSponsorLedger,
} from "./helpers/operationSponsorLedger";

vi.mock("../src/server/modules/sponsorship/sponsorship.service", () => ({
  sponsorshipLedger: async () =>
    operationSponsorLedger(deps.db as import("mongodb").Db),
}));

const deps = vi.hoisted(() => ({
  db: null as unknown,
  wallets: new Map<string, string>(),
  pool: null as unknown,
  simulationCalls: 0,
  prepareCalls: 0,
  simulationFails: false,
  journalSigned: false,
}));
vi.mock("../src/server/db/mongo", () => ({
  getDb: async () => deps.db,
  getPaymentRequests: async () =>
    (deps.db as import("mongodb").Db).collection("payment_requests"),
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: async (id: string) =>
    deps.wallets.has(id) ? { address: deps.wallets.get(id) } : null,
}));
vi.mock("../src/server/modules/usernames/usernames.service", () => ({
  resolveUsername: async () => null,
}));
vi.mock("../src/lib/pools", () => ({
  requestPool: () => deps.pool,
  resolvePool: () => deps.pool,
}));
vi.mock("../src/server/lib/relayer", () => ({
  relayerConfigured: () => true,
  relayerAddress: () => "0x1111111111111111111111111111111111111111",
}));
vi.mock("../src/server/lib/durableRelayer", () => ({
  runtimeSender: async () => ({
    sender: {
      prepare: async () => {
        deps.prepareCalls++;
        deps.journalSigned = true;
        return { txHash: `0x${"11".repeat(32)}` };
      },
      broadcast: async () => {
        throw Error("RPC timeout");
      },
      reconcile: async () => ({
        state: "unknown",
        txHash: `0x${"11".repeat(32)}`,
        receipt: null,
      }),
    },
    reader: {
      call: async () => {
        deps.simulationCalls++;
        if (deps.simulationFails) throw Error("proof simulation reverted");
        return { data: "0x" };
      },
    },
    journal: {
      read: async () =>
        deps.journalSigned
          ? { serializedTransaction: "0x1234", txHash: `0x${"11".repeat(32)}` }
          : null,
    },
    account: { address: "0x1111111111111111111111111111111111111111" },
  }),
}));

import {
  requestDigest,
  submissionTypedData,
} from "../src/features/requests/requestTypedData";
import type { SignedSubmission } from "../src/features/requests/types";
import { __resetRateLimit } from "../src/server/lib/rateLimit";
import {
  beginPayment,
  reconcilePendingRequests,
  reconcileRequestOperation,
  submitPayment,
} from "../src/server/modules/requests/requestOperations";
import { toRequestDoc } from "../src/server/modules/requests/requests.repository";
import { cancelRequest } from "../src/server/modules/requests/requests.service";
import { openIsolatedRequestDb } from "./helpers/requestDb";
import { makeRequestFixture, testSigner } from "./helpers/requestFixtures";

describe("request reservations and uncertain submissions", () => {
  let db: Awaited<ReturnType<typeof openIsolatedRequestDb>>,
    f: Awaited<ReturnType<typeof makeRequestFixture>>;
  const attempt = "00000000-0000-4000-8000-000000000099";
  beforeAll(async () => {
    db = await openIsolatedRequestDb();
    f = await makeRequestFixture();
    deps.db = db.db;
    deps.pool = f.pool;
    deps.wallets.set("payer", f.record.addressee.wallet);
    deps.wallets.set("requester", f.record.requester.wallet);
  }, 15000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await resetOperationSponsorLedger(db.db);
    __resetRateLimit();
    deps.simulationCalls = 0;
    deps.prepareCalls = 0;
    deps.simulationFails = false;
    deps.journalSigned = false;
    await db.requests.deleteMany({});
    await db.db.collection("request_operations").deleteMany({});
    await db.db.collection("request_payment_steps").deleteMany({});
    await db.requests.insertOne(
      toRequestDoc(f.record, requestDigest(f.record), new Date()),
    );
  });
  it("rotates past twenty unresolved operations even when validation throws", async () => {
    const base = toRequestDoc(f.record, requestDigest(f.record), new Date());
    const rows = Array.from({ length: 21 }, (_, i) => ({
      ...base,
      _id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      recipientCommitment: `0x${(i + 1).toString(16).padStart(64, "0")}`,
      digest: "invalid",
      operationId: `op-${i}`,
      reservation: {
        attemptId: `op-${i}`,
        phase: "needsReconciliation" as const,
        updatedAt: new Date(i),
        completedMerges: 0,
        nextStep: 0,
        txHash: null,
        relayWallet: null,
        currentSubmission: {} as SignedSubmission,
        currentDigest: "invalid",
      },
    }));
    await db.requests.insertMany(rows);
    expect((await reconcilePendingRequests({ limit: 20 })).examined).toBe(20);
    const lastId = rows[20]._id;
    expect(
      (
        await db.requests.findOne({ _id: lastId })
      )?.reservation?.updatedAt.getTime(),
    ).toBe(20);
    await reconcilePendingRequests({ limit: 20 });
    expect(
      (
        await db.requests.findOne({ _id: lastId })
      )?.reservation?.updatedAt.getTime(),
    ).toBeGreaterThan(20);
    expect(deps.prepareCalls).toBe(0);
  });
  it("reserves atomically for the addressee and blocks competing cancellation", async () => {
    await expect(
      beginPayment("requester", {
        id: f.record.id,
        revision: 0,
        attemptId: attempt,
      }),
    ).rejects.toThrow();
    const op = await beginPayment("payer", {
      id: f.record.id,
      revision: 0,
      attemptId: attempt,
    });
    expect(op.phase).toBe("preparing");
    expect(
      (
        await beginPayment("payer", {
          id: f.record.id,
          revision: 0,
          attemptId: attempt,
        })
      ).id,
    ).toBe(attempt);
    await expect(
      cancelRequest("requester", { id: f.record.id, revision: 1 }),
    ).rejects.toThrow();
    await expect(
      beginPayment("payer", {
        id: f.record.id,
        revision: 1,
        attemptId: "00000000-0000-4000-8000-000000000098",
      }),
    ).rejects.toThrow();
  });
  it("retains sponsored idle request quota and account capture across an elapsed timer", async () => {
    await beginPayment("payer", {
      id: f.record.id,
      revision: 0,
      attemptId: attempt,
    });
    await db.requests.updateOne(
      { _id: f.record.id },
      { $set: { "reservation.updatedAt": new Date(Date.now() - 601000) } },
    );
    const finish = vi
      .spyOn(AccountSpendGate.prototype, "finish")
      .mockResolvedValue();
    try {
      expect((await reconcileRequestOperation(attempt))?.phase).toBe(
        "preparing",
      );
      expect(finish).not.toHaveBeenCalled();
      expect(
        (await db.requests.findOne({ _id: f.record.id }))?.operationId,
      ).toBe(attempt);
    } finally {
      finish.mockRestore();
    }
  });
  it("keeps Pending and the reservation after an uncertain broadcast", async () => {
    await beginPayment("payer", {
      id: f.record.id,
      revision: 0,
      attemptId: attempt,
    });
    const body = {
      version: 1 as const,
      requestId: f.record.id,
      operationId: attempt,
      step: 0,
      pool: f.pool.scope,
      kind: "payment" as const,
      root: f.record.recipientCommitment,
      nullifiers: [f.record.recipientCommitment],
      proof: {
        a: ["1", "2"] as const,
        b: [
          ["3", "4"],
          ["5", "6"],
        ] as const,
        c: ["7", "8"] as const,
      },
      outputs: [
        {
          commitment: f.record.recipientCommitment,
          ephemeralPk: f.record.requester.viewPubkey,
          ciphertext: "0x1234" as const,
        },
        {
          commitment: `0x${"01".repeat(32)}` as const,
          ephemeralPk: f.record.addressee.viewPubkey,
          ciphertext: "0x5678" as const,
        },
      ],
    };
    const signer = testSigner(2);
    const signature = await signer.walletClient.signTypedData({
      account: signer.walletClient.account ?? signer.address,
      ...submissionTypedData(body),
    });
    const op = await submitPayment("payer", {
      ...body,
      signature,
    } as SignedSubmission);
    expect(deps.simulationCalls).toBe(1);
    expect(deps.prepareCalls).toBe(1);
    expect(op.phase).toBe("needsReconciliation");
    const stored = await db.requests.findOne({ _id: f.record.id });
    expect(stored?.status).toBe("pending");
    expect(stored?.operationId).toBe(attempt);
    await expect(
      cancelRequest("requester", {
        id: f.record.id,
        revision: stored?.revision ?? 0,
      }),
    ).rejects.toThrow();
    const stepId = `${attempt}:0`,
      steps = db.db.collection("request_payment_steps");
    const saved = await steps.findOne({ _id: stepId });
    expect(saved?.digest).toBeTruthy();
    await steps.updateOne(
      { _id: stepId },
      { $set: { digest: `0x${"ff".repeat(32)}` } },
    );
    deps.simulationFails = true;
    const retry = await submitPayment("payer", {
      ...body,
      signature,
    } as SignedSubmission);
    expect(retry.phase).toBe("needsReconciliation");
    expect(deps.simulationCalls).toBe(1);
    expect((await steps.findOne({ _id: stepId }))?.digest).toBe(
      `0x${"ff".repeat(32)}`,
    );
    const substituted = {
      ...body,
      outputs: [
        { ...body.outputs[0], ciphertext: "0x9999" as const },
        body.outputs[1],
      ],
    };
    const substitutedSignature = await signer.walletClient.signTypedData({
      account: signer.walletClient.account ?? signer.address,
      ...submissionTypedData(substituted),
    });
    await expect(
      submitPayment("payer", {
        ...substituted,
        signature: substitutedSignature,
      } as SignedSubmission),
    ).rejects.toThrow();
  });
  it("simulates the proof before reserving a nonce and fails safely when it reverts", async () => {
    await beginPayment("payer", {
      id: f.record.id,
      revision: 0,
      attemptId: attempt,
    });
    const body = {
      version: 1 as const,
      requestId: f.record.id,
      operationId: attempt,
      step: 0,
      pool: f.pool.scope,
      kind: "payment" as const,
      root: f.record.recipientCommitment,
      nullifiers: [f.record.recipientCommitment],
      proof: {
        a: ["1", "2"] as const,
        b: [
          ["3", "4"],
          ["5", "6"],
        ] as const,
        c: ["7", "8"] as const,
      },
      outputs: [
        {
          commitment: f.record.recipientCommitment,
          ephemeralPk: f.record.requester.viewPubkey,
          ciphertext: "0x1234" as const,
        },
        {
          commitment: `0x${"01".repeat(32)}` as const,
          ephemeralPk: f.record.addressee.viewPubkey,
          ciphertext: "0x5678" as const,
        },
      ],
    };
    const signer = testSigner(2);
    const signature = await signer.walletClient.signTypedData({
      account: signer.walletClient.account ?? signer.address,
      ...submissionTypedData(body),
    });
    deps.simulationFails = true;
    const op = await submitPayment("payer", {
      ...body,
      signature,
    } as SignedSubmission);
    expect(deps.simulationCalls).toBe(1);
    expect(deps.prepareCalls).toBe(0);
    expect(op.phase).toBe("failed");
    const stored = await db.requests.findOne({ _id: f.record.id });
    expect(stored?.status).toBe("pending");
    expect(stored?.operationId).toBeNull();
  });
});
