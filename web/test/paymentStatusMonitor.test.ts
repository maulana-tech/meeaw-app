import { afterEach, expect, it, vi } from "vitest";

const status = vi.hoisted(() => vi.fn());
vi.mock("../src/trpc/client", () => ({
  api: { requests: { paymentStatus: { query: status } } },
}));

import { watchPaymentStatus } from "../src/features/requests/paymentStatusMonitor";

afterEach(() => {
  vi.useRealTimers();
  status.mockReset();
});
it("shares one poll across two subscribers and slows down after 30 seconds", async () => {
  vi.useFakeTimers();
  status.mockResolvedValue({
    requestId: "shared",
    phase: "submitted",
    updatedAt: new Date().toISOString(),
  });
  const a = watchPaymentStatus("alice", "shared", vi.fn());
  const b = watchPaymentStatus("alice", "shared", vi.fn());
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    const calls = status.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(status).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(status).toHaveBeenCalledTimes(calls + 1);
    a();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(status).toHaveBeenCalledTimes(calls + 2);
  } finally {
    a();
    b();
  }
});
it("stops on confirmation and after the last subscriber leaves", async () => {
  vi.useFakeTimers();
  status.mockResolvedValue({ requestId: "done", phase: "confirmed" });
  const stop = watchPaymentStatus("alice", "done", vi.fn());
  await vi.advanceTimersByTimeAsync(30_000);
  expect(status).toHaveBeenCalledTimes(1);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});
