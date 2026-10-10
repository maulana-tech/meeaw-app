import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../src/server/context";
import { __resetRateLimit } from "../src/server/lib/rateLimit";

const state = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  publicGet: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("../src/server/modules/invoices/invoices.service", () => ({
  createInvoice: vi.fn(),
  voidInvoice: vi.fn(),
  getInvoice: state.get,
  listInvoices: state.list,
  getPublicInvoice: state.publicGet,
  confirmInvoicePayment: state.confirm,
  checkInvoicePayment: vi.fn(),
}));

import { invoicesRouter } from "../src/server/modules/invoices/invoices.router";

const context = (auth: boolean): Context => ({
  ip: "test",
  authToken: auth ? "test-token" : null,
  privyUserId: auth ? "verified-owner" : null,
  privyClaim: auth
    ? ({ user_id: "verified-owner" } as Context["privyClaim"])
    : null,
  authError: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimit();
});
describe("invoice API boundaries", () => {
  it("requires authentication for owner endpoints", async () => {
    const caller = invoicesRouter.createCaller(context(false));
    await expect(caller.list({})).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.get({ id: "00000000-0000-4000-8000-000000000001" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.get).not.toHaveBeenCalled();
    expect(state.list).not.toHaveBeenCalled();
  });
  it("uses the verified context identity rather than an owner in the request", async () => {
    state.list.mockResolvedValue({ items: [], nextCursor: null });
    await invoicesRouter.createCaller(context(true)).list({});
    expect(state.list).toHaveBeenCalledWith("verified-owner", undefined);
  });
  it("allows token holders to read the public invoice without signing in", async () => {
    state.publicGet.mockResolvedValue({ status: "pending" });
    await invoicesRouter
      .createCaller(context(false))
      .publicGet({ token: "a".repeat(32) });
    expect(state.publicGet).toHaveBeenCalledWith("a".repeat(32));
  });
  it("does not expose internal store errors to a public caller", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    state.publicGet.mockRejectedValue(new Error("private database detail"));
    await expect(
      invoicesRouter
        .createCaller(context(false))
        .publicGet({ token: "a".repeat(32) }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "Invoice could not be processed. Try again.",
    });
    vi.restoreAllMocks();
  });
  it("rejects malformed receipt hashes before reading chain evidence", async () => {
    await expect(
      invoicesRouter
        .createCaller(context(false))
        .confirmPayment({ token: "a".repeat(32), txHash: "not-a-hash" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.confirm).not.toHaveBeenCalled();
  });
});
