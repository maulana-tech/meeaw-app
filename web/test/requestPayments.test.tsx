// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const deps = vi.hoisted(() => ({
  account: { ownerSecret: 9n, viewSk: new Uint8Array(32).fill(9) },
  walletAddress: "0x3333333333333333333333333333333333333333",
  unlocked: true,
  signer: {
    address: "0x3333333333333333333333333333333333333333",
    walletClient: {},
  },
  record: null as unknown,
  payload: null as unknown,
  scanMyNotes: vi.fn(),
  openRequest: vi.fn(),
  buildMergeSubmission: vi.fn(),
  buildPaymentSubmission: vi.fn(),
  buildSplitSubmission: vi.fn(),
  getRequest: vi.fn(),
  beginPayment: vi.fn(),
  paymentStatus: vi.fn(),
  submitConsolidation: vi.fn(),
  submitPayment: vi.fn(),
  invalidate: vi.fn(async () => undefined),
}));

vi.mock("../src/lib/notes", () => ({
  getAccount: () => deps.account,
  scanMyNotes: deps.scanMyNotes,
}));
vi.mock("../src/lib/pools", () => ({
  resolvePool: () => ({
    scope: "31337:0x1111111111111111111111111111111111111111",
    chainId: 31337,
    address: "0x1111111111111111111111111111111111111111",
    deployBlock: 0,
    token: "0x5555555555555555555555555555555555555555",
    tokenDecimals: 6,
    depth: 20,
    confirmations: 1,
    role: "active",
    requestCapable: true,
  }),
}));
vi.mock("../src/lib/chain", () => ({}));
vi.mock("../src/features/requests/requestCrypto", () => ({
  openRequest: deps.openRequest,
}));
vi.mock("../src/features/requests/requestProofs", () => ({
  buildMergeSubmission: deps.buildMergeSubmission,
  buildPaymentSubmission: deps.buildPaymentSubmission,
  buildSplitSubmission: deps.buildSplitSubmission,
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    requests: {
      get: { query: deps.getRequest },
      beginPayment: { mutate: deps.beginPayment },
      paymentStatus: { query: deps.paymentStatus },
      submitConsolidation: { mutate: deps.submitConsolidation },
      submitPayment: { mutate: deps.submitPayment },
    },
  },
}));
vi.mock("../src/trpc/react", () => ({
  trpc: {
    useUtils: () => ({
      requests: {
        get: { invalidate: deps.invalidate },
        pendingCount: { invalidate: deps.invalidate },
        listReceived: { invalidate: deps.invalidate },
        listSent: { invalidate: deps.invalidate },
      },
    }),
  },
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: deps.walletAddress,
    accountUnlocked: deps.unlocked,
    getSigner: async () => deps.signer,
  }),
}));

import { useRequestPayment } from "../src/features/requests/hooks/useRequestPayment";
import type {
  PaymentOperation,
  PaymentRequest,
  RequestPayload,
  SignedRequest,
  SignedSubmission,
} from "../src/features/requests/types";
import type { MyNote, ScanResult } from "../src/lib/notes";
import { testPool, wireRequestFixture } from "./helpers/requestFixtures";

const operationId = "00000000-0000-4000-8000-000000000099";
let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);
const scope = testPool.scope;
const baseRequest = {
  ...wireRequestFixture(),
  status: "pending" as const,
  revision: 0,
  operationId: null,
  updatedAt: "2026-10-05T00:00:00.000Z",
  receipt: null,
} satisfies PaymentRequest;
const payload: RequestPayload = {
  metadata: {
    version: 1,
    id: baseRequest.id,
    pool: scope,
    requester: baseRequest.requester,
    addressee: baseRequest.addressee,
    createdAt: baseRequest.createdAt,
    recipientCommitment: baseRequest.recipientCommitment,
  },
  amount: "20000000",
  note: "Dinner",
  salt: "777",
};
const pending = (patch: Partial<PaymentOperation> = {}): PaymentOperation => ({
  id: operationId,
  requestId: baseRequest.id,
  pool: scope,
  phase: "preparing",
  completedMerges: 0,
  nextStep: 0,
  txHash: null,
  updatedAt: "2026-10-05T00:00:00.000Z",
  ...patch,
});
const submission = (kind: "merge" | "payment"): SignedSubmission => ({
  version: 1,
  requestId: baseRequest.id,
  operationId,
  step: kind === "merge" ? 0 : 1,
  pool: scope,
  kind,
  root: `0x${"01".repeat(32)}`,
  nullifiers: [`0x${"02".repeat(32)}`],
  proof: {
    a: ["1", "2"],
    b: [
      ["3", "4"],
      ["5", "6"],
    ],
    c: ["7", "8"],
  },
  outputs: [
    {
      commitment: baseRequest.recipientCommitment,
      ephemeralPk: `0x${"04".repeat(32)}`,
      ciphertext: "0x1234",
    },
  ],
  signature: `0x${"05".repeat(65)}`,
});
function note(leafIndex: number, amount: bigint): MyNote {
  return {
    scope,
    leafIndex,
    amount,
    salt: BigInt(leafIndex + 1),
    spent: false,
  };
}
function scan(notes: MyNote[]): ScanResult {
  return {
    scope,
    notes,
    leaves: [1n, 2n, 3n],
    claimable: notes
      .filter((n) => !n.spent)
      .reduce((sum, n) => sum + n.amount, 0n),
    mirrorAvailable: true,
    indexedAt: "2026-10-05T00:00:00.000Z",
    health: "healthy",
  };
}

describe("request payment browser orchestration", () => {
  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    vi.clearAllMocks();
    deps.walletAddress = baseRequest.addressee.wallet;
    deps.unlocked = true;
    deps.signer = { address: baseRequest.addressee.wallet, walletClient: {} };
    deps.record = baseRequest;
    deps.payload = payload;
    deps.openRequest.mockResolvedValue(payload);
    deps.getRequest.mockResolvedValue(baseRequest);
    deps.beginPayment.mockResolvedValue(pending());
    deps.paymentStatus.mockResolvedValue(pending());
    deps.submitConsolidation.mockResolvedValue(
      pending({ completedMerges: 1, nextStep: 1 }),
    );
    deps.submitPayment.mockResolvedValue(
      pending({ phase: "confirmed", completedMerges: 1, nextStep: 2 }),
    );
    deps.buildMergeSubmission.mockResolvedValue(submission("merge"));
    deps.buildPaymentSubmission.mockResolvedValue(submission("payment"));
    deps.buildSplitSubmission.mockResolvedValue(submission("payment"));
  });

  it("merges fragmented notes, rescans, and sends one final payment", async () => {
    deps.scanMyNotes
      .mockResolvedValueOnce(scan([note(0, 10_000_000n), note(1, 15_000_000n)]))
      .mockResolvedValueOnce(scan([note(2, 25_000_000n)]));
    const { result } = renderHook(() => useRequestPayment(baseRequest), {
      wrapper,
    });

    await act(async () => {
      await result.current.pay();
    });

    expect(deps.beginPayment).toHaveBeenCalledOnce();
    expect(deps.buildMergeSubmission).toHaveBeenCalledOnce();
    expect(deps.submitConsolidation).toHaveBeenCalledOnce();
    expect(deps.scanMyNotes).toHaveBeenCalledTimes(2);
    expect(deps.buildPaymentSubmission).toHaveBeenCalledOnce();
    expect(deps.submitPayment).toHaveBeenCalledOnce();
    expect(result.current.operation?.phase).toBe("confirmed");
  });

  it("resumes a prepared operation after reload without beginning or repeating its merge", async () => {
    const resumed = pending({ completedMerges: 1, nextStep: 1 });
    const request = { ...baseRequest, operationId };
    deps.record = request;
    deps.getRequest.mockResolvedValue(request);
    deps.paymentStatus.mockResolvedValue(resumed);
    deps.scanMyNotes.mockResolvedValue(scan([note(2, 25_000_000n)]));
    const { result } = renderHook(() => useRequestPayment(request), {
      wrapper,
    });

    await act(async () => {
      await result.current.pay();
    });

    expect(deps.paymentStatus).toHaveBeenCalledWith({ id: request.id });
    expect(deps.beginPayment).not.toHaveBeenCalled();
    expect(deps.buildMergeSubmission).not.toHaveBeenCalled();
    expect(deps.buildPaymentSubmission).toHaveBeenCalledOnce();
    expect(deps.submitPayment).toHaveBeenCalledOnce();
    expect(result.current.operation?.phase).toBe("confirmed");
  });

  it("does not submit a proof that finishes after the account changes", async () => {
    deps.scanMyNotes.mockResolvedValue(
      scan([note(0, 10_000_000n), note(1, 15_000_000n)]),
    );
    let finishProof: ((value: SignedSubmission) => void) | undefined;
    deps.buildMergeSubmission.mockReturnValue(
      new Promise<SignedSubmission>((resolve) => {
        finishProof = resolve;
      }),
    );
    const { result, rerender } = renderHook(
      () => useRequestPayment(baseRequest),
      { wrapper },
    );
    let inFlight!: Promise<PaymentOperation | null>;
    act(() => {
      inFlight = result.current.pay();
    });
    await waitFor(() =>
      expect(deps.buildMergeSubmission).toHaveBeenCalledOnce(),
    );

    act(() => {
      deps.walletAddress = "0x4444444444444444444444444444444444444444";
      rerender();
    });
    await act(async () => {
      finishProof?.(submission("merge"));
      await inFlight;
    });

    expect(deps.submitConsolidation).not.toHaveBeenCalled();
    expect(deps.submitPayment).not.toHaveBeenCalled();
  });
  it("starts a fresh attempt after a stored failure has released the request", async () => {
    deps.paymentStatus.mockResolvedValue(pending({ phase: "failed" }));
    deps.scanMyNotes.mockResolvedValue(scan([note(2, 25_000_000n)]));
    const { result } = renderHook(() => useRequestPayment(baseRequest), {
      wrapper,
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.operation?.phase).toBe("failed");
    await act(async () => {
      await result.current.pay();
    });
    expect(deps.beginPayment).toHaveBeenCalledOnce();
    expect(result.current.operation?.phase).toBe("confirmed");
  });
});
