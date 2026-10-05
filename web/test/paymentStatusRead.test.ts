import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  getDb: vi.fn(async () => ({
    collection: () => ({ updateOne: vi.fn(), findOne: mocks.history }),
  })),
  sender: vi.fn(),
  doc: {
    _id: "r",
    operationId: "op" as string | null,
    scope: "pool",
    addresseeWallet: "alice",
    reservation: {
      phase: "submitted",
      updatedAt: new Date(),
      completedMerges: 0,
      nextStep: 0,
      txHash: "0xhash",
      currentSubmission: null,
    },
  },
}));
vi.mock("../src/server/db/mongo", () => ({
  getDb: mocks.getDb,
  getPaymentRequests: async () => ({ findOne: async () => mocks.doc }),
}));
vi.mock("../src/server/modules/requests/requests.service", () => ({
  callerWallet: async () => "alice",
  enforceRequestLimit: vi.fn(),
}));
vi.mock("../src/server/modules/requests/requests.repository", () => ({
  findForParticipant: async () => mocks.doc,
  toPaymentRequest: vi.fn(),
}));
vi.mock("../src/server/lib/durableRelayer", () => ({
  runtimeSender: mocks.sender,
}));
vi.mock("../src/server/lib/relayer", () => ({
  relayerAddress: vi.fn(),
  relayerConfigured: vi.fn(),
}));
vi.mock("../src/server/modules/requests/requestSettlement", () => ({
  encodeSubmission: vi.fn(),
  verifyRequestReceipt: vi.fn(),
}));

import { paymentStatus } from "../src/server/modules/requests/requestOperations";
beforeEach(() => vi.clearAllMocks());

it("reads the owned operation without blockchain reconciliation or database writes", async () => {
  const result = await paymentStatus("alice", { id: "r" });
  expect(result?.phase).toBe("submitted");
  expect(mocks.getDb).not.toHaveBeenCalled();
  expect(mocks.sender).not.toHaveBeenCalled();
});
it("returns the failed operation after the worker releases its reservation", async () => {
  mocks.doc.operationId = null;
  mocks.history.mockResolvedValue({
    id: "op",
    requestId: "r",
    pool: "pool",
    phase: "failed",
    completedMerges: 0,
    nextStep: 0,
    txHash: null,
    updatedAt: new Date().toISOString(),
  });
  try {
    expect((await paymentStatus("alice", { id: "r" }))?.phase).toBe("failed");
    expect(mocks.sender).not.toHaveBeenCalled();
  } finally {
    mocks.doc.operationId = "op";
  }
});
