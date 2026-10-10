// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferRunnerPort } from "../src/features/transfers/directTransferRunner";
import { useDirectTransfer } from "../src/features/transfers/hooks/useDirectTransfer";
import type {
  SignedTransferSubmission,
  TransferOperation,
  TransferRecord,
} from "../src/features/transfers/types";

const state = vi.hoisted(() => ({
  address: "alice",
  account: {},
  signer: vi.fn(),
  status: vi.fn(),
  submit: vi.fn(),
  run: vi.fn(),
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: state.address,
    accountUnlocked: true,
    getSigner: state.signer,
  }),
}));
vi.mock("../src/lib/notes", () => ({
  getAccount: () => state.account,
  scanMyNotes: vi.fn(),
  scanKeyringNotes: vi.fn(),
}));
vi.mock("../src/lib/pools", () => ({ resolvePool: () => ({}) }));
vi.mock("../src/features/privacyKeys/session", () => ({
  getPrivacyKeyring: () => null,
}));
vi.mock("../src/features/transfers/directTransferRunner", () => ({
  runDirectTransfer: state.run,
}));
vi.mock("../src/features/transfers/transferProofs", () => ({
  buildTransferSubmission: vi.fn(),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    transfers: {
      status: { query: state.status },
      submit: { mutate: state.submit },
      resume: { mutate: vi.fn() },
    },
    sponsorship: { cancelUnsigned: { mutate: vi.fn() } },
  },
}));
const record = {
  id: "transfer",
  operationId: "operation",
  pool: "10143:pool",
  sender: {},
} as TransferRecord;
function op(phase: TransferOperation["phase"]): TransferOperation {
  return {
    id: "operation",
    transferId: "transfer",
    phase,
    nextStep: 1,
    txHash: phase === "preparing" ? null : "0x123",
    updatedAt: "2026-10-11",
  };
}
function submission(
  kind: SignedTransferSubmission["kind"],
): SignedTransferSubmission {
  return {
    operationId: "operation",
    kind,
    nullifiers: [],
    outputs: [],
    proof: {
      a: ["0", "0"],
      b: [
        ["0", "0"],
        ["0", "0"],
      ],
      c: ["0", "0"],
    },
  } as unknown as SignedTransferSubmission;
}
beforeEach(() => {
  state.address = "alice";
  state.account = {};
  state.signer.mockResolvedValue({});
  state.status.mockReset().mockResolvedValue(op("submitted"));
  state.submit.mockReset().mockResolvedValue(op("submitted"));
  state.run.mockReset();
});
afterEach(() => vi.restoreAllMocks());
describe("direct payment confirmation timing", () => {
  it("drops old status responses when the selected transfer changes", async () => {
    let finish: (value: TransferOperation) => void = () => {};
    state.status.mockReturnValueOnce(
      new Promise<TransferOperation>((resolve) => {
        finish = resolve;
      }),
    );
    const nextRecord = { ...record, id: "next", operationId: "next-operation" };
    const { result, rerender } = renderHook(
      ({ selected }) => useDirectTransfer(selected),
      { initialProps: { selected: record } },
    );
    rerender({ selected: nextRecord });
    await act(async () => {
      finish(op("confirmed"));
    });
    expect(result.current.operation).toBeNull();
    expect(result.current.settledInMs).toBeNull();
  });
  it("does not measure merge or split preparation", async () => {
    state.run.mockImplementation(
      async (_context: unknown, port: TransferRunnerPort) => {
        await port.submit(submission("split"));
        port.tick(op("confirmed"));
        return op("confirmed");
      },
    );
    const { result } = renderHook(() => useDirectTransfer(record));
    await waitFor(() =>
      expect(result.current.operation?.phase).toBe("submitted"),
    );
    await act(async () => {
      await result.current.continueSend();
    });
    expect(result.current.settledInMs).toBeNull();
  });
  it("ignores a completed submit after unmount", async () => {
    let finish: (value: TransferOperation) => void = () => {};
    let port: TransferRunnerPort | null = null;
    state.submit.mockReturnValue(
      new Promise<TransferOperation>((resolve) => {
        finish = resolve;
      }),
    );
    state.run.mockImplementation(
      async (_context: unknown, currentPort: TransferRunnerPort) => {
        port = currentPort;
        const next = await currentPort.submit(submission("payment"));
        currentPort.tick(next);
        return next;
      },
    );
    const { result, unmount } = renderHook(() => useDirectTransfer(record));
    await waitFor(() =>
      expect(result.current.operation?.phase).toBe("submitted"),
    );
    let sending: Promise<TransferOperation | null>;
    await act(async () => {
      sending = result.current.continueSend();
      await Promise.resolve();
    });
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    unmount();
    expect((port as TransferRunnerPort | null)?.isCurrent()).toBe(false);
    await act(async () => {
      finish(op("confirmed"));
      await sending;
    });
  });
  it("starts at final payment and finishes on polling confirmation", async () => {
    let time = 100;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    state.run.mockImplementation(
      async (_context: unknown, port: TransferRunnerPort) => {
        await port.submit(submission("merge"));
        time = 1000;
        const sent = await port.submit(submission("payment"));
        port.tick(sent);
        time = 2500;
        state.status.mockResolvedValue(op("confirmed"));
        return sent;
      },
    );
    const { result } = renderHook(() => useDirectTransfer(record));
    await waitFor(() =>
      expect(result.current.operation?.phase).toBe("submitted"),
    );
    await act(async () => {
      await result.current.continueSend();
    });
    await waitFor(
      () => expect(result.current.operation?.phase).toBe("confirmed"),
      { timeout: 4500 },
    );
    expect(result.current.settledInMs).toBe(1500);
  });
  it("keeps timing after a submit response is lost", async () => {
    let time = 100;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    state.submit.mockRejectedValue(new Error("response lost"));
    state.run.mockImplementation(
      async (_context: unknown, port: TransferRunnerPort) => {
        await port.submit(submission("payment"));
      },
    );
    const { result } = renderHook(() => useDirectTransfer(record));
    await waitFor(() =>
      expect(result.current.operation?.phase).toBe("submitted"),
    );
    await act(async () => {
      await result.current.continueSend();
    });
    time = 1100;
    state.status.mockResolvedValue(op("confirmed"));
    await waitFor(
      () => expect(result.current.operation?.phase).toBe("confirmed"),
      { timeout: 4500 },
    );
    expect(result.current.settledInMs).toBe(1000);
    expect(result.current.error).toBeNull();
  });
  it("does not time preparation or historical confirmations", async () => {
    state.status.mockResolvedValue(op("confirmed"));
    const { result } = renderHook(() => useDirectTransfer(record));
    await waitFor(() =>
      expect(result.current.operation?.phase).toBe("confirmed"),
    );
    expect(result.current.settledInMs).toBeNull();
  });
  it("drops old completion after account switch", async () => {
    let finish: (value: TransferOperation) => void = () => {};
    state.submit.mockReturnValue(
      new Promise<TransferOperation>((resolve) => {
        finish = resolve;
      }),
    );
    state.run.mockImplementation(
      async (_context: unknown, port: TransferRunnerPort) => {
        const sent = await port.submit(submission("payment"));
        port.tick(sent);
        return sent;
      },
    );
    const { result, rerender } = renderHook(() => useDirectTransfer(record));
    await waitFor(() =>
      expect(result.current.operation?.phase).toBe("submitted"),
    );
    let sending: Promise<TransferOperation | null>;
    await act(async () => {
      sending = result.current.continueSend();
      await Promise.resolve();
    });
    state.address = "bob";
    state.account = {};
    rerender();
    await act(async () => {
      finish(op("confirmed"));
      await sending;
    });
    expect(result.current.settledInMs).toBeNull();
    expect(result.current.operation?.phase).not.toBe("confirmed");
  });
});
