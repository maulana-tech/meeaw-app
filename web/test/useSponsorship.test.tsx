// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { QuotaStatus } from "../src/features/sponsorship/types";

const mocks = vi.hoisted(() => ({
  uid: "alice" as string | null,
  my: vi.fn(),
  public: vi.fn(),
}));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: true,
    authenticated: Boolean(mocks.uid),
    user: mocks.uid ? { id: mocks.uid } : null,
  }),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    sponsorship: {
      myQuota: { query: mocks.my },
      availability: { query: mocks.public },
    },
  },
}));

import { useSponsorship } from "../src/features/sponsorship/useSponsorship";

const quota: QuotaStatus = {
  configured: true,
  available: true,
  reason: null,
  limit: 20,
  used: 1,
  reserved: 0,
  remaining: 19,
  resetAt: "2026-10-10T00:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.uid = "alice";
  mocks.my.mockResolvedValue(quota);
  mocks.public.mockResolvedValue({ ...quota, limit: 100 });
});
it("loads personal quota and refreshes current usage instead of caching it forever", async () => {
  const hook = renderHook(() => useSponsorship());
  await waitFor(() => expect(hook.result.current.status).toEqual(quota));
  mocks.my.mockResolvedValue({ ...quota, remaining: 18, used: 2 });
  await act(async () => {
    await hook.result.current.refresh();
  });
  expect(hook.result.current.status?.remaining).toBe(18);
  expect(mocks.my).toHaveBeenCalledTimes(2);
});
it("does not apply another account's delayed response", async () => {
  let finish: (q: QuotaStatus) => void = () => {};
  mocks.my.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const hook = renderHook(() => useSponsorship());
  mocks.uid = "bob";
  mocks.my.mockResolvedValue({ ...quota, remaining: 3 });
  hook.rerender();
  await waitFor(() => expect(hook.result.current.status?.remaining).toBe(3));
  await act(async () => {
    finish(quota);
  });
  expect(hook.result.current.status?.remaining).toBe(3);
});
it("uses public availability for guests and keeps an outage unknown", async () => {
  mocks.uid = null;
  mocks.public.mockRejectedValueOnce(Error("unavailable"));
  const hook = renderHook(() => useSponsorship());
  await waitFor(() => expect(mocks.public).toHaveBeenCalledTimes(1));
  expect(hook.result.current.status).toBeNull();
  expect(mocks.my).not.toHaveBeenCalled();
});
