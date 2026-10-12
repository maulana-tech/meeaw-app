import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../src/server/context";
import { __resetRateLimit } from "../src/server/lib/rateLimit";

const {
  mockCurrentWallet,
  mockFindSettingsByWallet,
  mockUpsertNotificationSettings,
  mockDisableByUnsubscribeToken,
  mockSendTestEmail,
} = vi.hoisted(() => ({
  mockCurrentWallet: vi.fn(),
  mockFindSettingsByWallet: vi.fn(),
  mockUpsertNotificationSettings: vi.fn(),
  mockDisableByUnsubscribeToken: vi.fn(),
  mockSendTestEmail: vi.fn(),
}));

vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: mockCurrentWallet,
}));

vi.mock("../src/server/modules/notifications/notifications.repository", () => ({
  findSettingsByWallet: mockFindSettingsByWallet,
  upsertNotificationSettings: mockUpsertNotificationSettings,
  disableByUnsubscribeToken: mockDisableByUnsubscribeToken,
}));

vi.mock("../src/server/modules/notifications/notifications.service", () => ({
  sendTestEmail: mockSendTestEmail,
}));

import { notificationsRouter } from "../src/server/modules/notifications/notifications.router";
import { appRouter } from "../src/server/root";

function createAuthContext(privyUserId: string | null = "user-123"): Context {
  return {
    ip: "127.0.0.1",
    authToken: privyUserId ? "test-token" : null,
    privyUserId,
    privyClaim: privyUserId
      ? ({ user_id: privyUserId } as Context["privyClaim"])
      : null,
    authError: null,
  };
}

describe("notificationsRouter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetRateLimit();
    vi.stubEnv("RESEND_API_KEY", "re_test_key_123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("Authentication boundaries", () => {
    it("rejects unauthenticated caller for getSettings", async () => {
      const caller = notificationsRouter.createCaller(createAuthContext(null));
      await expect(caller.getSettings()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("rejects unauthenticated caller for updateSettings", async () => {
      const caller = notificationsRouter.createCaller(createAuthContext(null));
      await expect(
        caller.updateSettings({
          email: "test@example.com",
          enabled: true,
          events: {
            invoicePaid: true,
            requestReceived: true,
            requestPaid: true,
          },
        }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("rejects unauthenticated caller for sendTest", async () => {
      const caller = notificationsRouter.createCaller(createAuthContext(null));
      await expect(caller.sendTest()).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });

    it("allows unauthenticated caller for unsubscribe", async () => {
      mockDisableByUnsubscribeToken.mockResolvedValue(true);
      const caller = notificationsRouter.createCaller(createAuthContext(null));
      const res = await caller.unsubscribe({ token: "valid-token-123" });
      expect(res).toEqual({ success: true });
      expect(mockDisableByUnsubscribeToken).toHaveBeenCalledWith(
        "valid-token-123",
      );
    });
  });

  describe("Input validation", () => {
    it("rejects invalid email formats on updateSettings", async () => {
      const caller = notificationsRouter.createCaller(createAuthContext());
      await expect(
        caller.updateSettings({
          email: "not-an-email",
          enabled: true,
          events: {
            invoicePaid: true,
            requestReceived: true,
            requestPaid: true,
          },
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(mockCurrentWallet).not.toHaveBeenCalled();
    });

    it("rejects empty token on unsubscribe", async () => {
      const caller = notificationsRouter.createCaller(createAuthContext(null));
      await expect(caller.unsubscribe({ token: "" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(caller.unsubscribe({ token: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });

  describe("getSettings procedure", () => {
    it("returns serviceAvailable: false when RESEND_API_KEY is not configured", async () => {
      vi.stubEnv("RESEND_API_KEY", "");
      mockCurrentWallet.mockResolvedValue({
        address: "0x1111111111111111111111111111111111111111",
      });
      mockFindSettingsByWallet.mockResolvedValue(null);

      const caller = notificationsRouter.createCaller(createAuthContext());
      const res = await caller.getSettings();

      expect(res).toEqual({
        serviceAvailable: false,
        settings: null,
      });
    });

    it("returns null settings if user has no wallet linked", async () => {
      mockCurrentWallet.mockResolvedValue(null);

      const caller = notificationsRouter.createCaller(createAuthContext());
      const res = await caller.getSettings();

      expect(res).toEqual({
        serviceAvailable: true,
        settings: null,
      });
      expect(mockFindSettingsByWallet).not.toHaveBeenCalled();
    });

    it("returns settings when user has wallet and saved preferences", async () => {
      mockCurrentWallet.mockResolvedValue({
        address: "0x1111111111111111111111111111111111111111",
      });
      mockFindSettingsByWallet.mockResolvedValue({
        _id: "0x1111111111111111111111111111111111111111",
        privyUserId: "user-123",
        email: "alice@example.com",
        enabled: true,
        events: {
          invoicePaid: true,
          requestReceived: false,
          requestPaid: true,
        },
        unsubscribeToken: "token-abc",
      });

      const caller = notificationsRouter.createCaller(createAuthContext());
      const res = await caller.getSettings();

      expect(res).toEqual({
        serviceAvailable: true,
        settings: {
          email: "alice@example.com",
          enabled: true,
          events: {
            invoicePaid: true,
            requestReceived: false,
            requestPaid: true,
          },
        },
      });
    });
  });

  describe("updateSettings procedure", () => {
    it("throws PRECONDITION_FAILED if no wallet is linked", async () => {
      mockCurrentWallet.mockResolvedValue(null);

      const caller = notificationsRouter.createCaller(createAuthContext());
      await expect(
        caller.updateSettings({
          email: "alice@example.com",
          enabled: true,
          events: {
            invoicePaid: true,
            requestReceived: true,
            requestPaid: true,
          },
        }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(mockUpsertNotificationSettings).not.toHaveBeenCalled();
    });

    it("upserts settings for current wallet and user", async () => {
      mockCurrentWallet.mockResolvedValue({
        address: "0x1111111111111111111111111111111111111111",
      });
      const returnedDoc = {
        _id: "0x1111111111111111111111111111111111111111",
        privyUserId: "user-123",
        email: "alice@example.com",
        enabled: true,
        events: {
          invoicePaid: true,
          requestReceived: false,
          requestPaid: true,
        },
        unsubscribeToken: "tok-123",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUpsertNotificationSettings.mockResolvedValue(returnedDoc);

      const caller = notificationsRouter.createCaller(
        createAuthContext("user-123"),
      );
      const res = await caller.updateSettings({
        email: "  alice@example.com  ",
        enabled: true,
        events: {
          invoicePaid: true,
          requestReceived: false,
          requestPaid: true,
        },
      });

      expect(res).toEqual(returnedDoc);
      expect(mockUpsertNotificationSettings).toHaveBeenCalledWith(
        "0x1111111111111111111111111111111111111111",
        "user-123",
        "alice@example.com",
        true,
        {
          invoicePaid: true,
          requestReceived: false,
          requestPaid: true,
        },
      );
    });
  });

  describe("sendTest procedure", () => {
    it("throws PRECONDITION_FAILED if no wallet is linked", async () => {
      mockCurrentWallet.mockResolvedValue(null);

      const caller = notificationsRouter.createCaller(createAuthContext());
      await expect(caller.sendTest()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(mockSendTestEmail).not.toHaveBeenCalled();
    });

    it("sends test email and returns success: true", async () => {
      mockCurrentWallet.mockResolvedValue({
        address: "0x1111111111111111111111111111111111111111",
      });
      mockSendTestEmail.mockResolvedValue(true);

      const caller = notificationsRouter.createCaller(createAuthContext());
      const res = await caller.sendTest();

      expect(res).toEqual({ success: true });
      expect(mockSendTestEmail).toHaveBeenCalledWith(
        "0x1111111111111111111111111111111111111111",
      );
    });

    it("throws BAD_REQUEST when sendTestEmail returns false", async () => {
      mockCurrentWallet.mockResolvedValue({
        address: "0x1111111111111111111111111111111111111111",
      });
      mockSendTestEmail.mockResolvedValue(false);

      const caller = notificationsRouter.createCaller(createAuthContext());
      await expect(caller.sendTest()).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("enforces rate limit of 3 tests per 10 minutes per user", async () => {
      mockCurrentWallet.mockResolvedValue({
        address: "0x1111111111111111111111111111111111111111",
      });
      mockSendTestEmail.mockResolvedValue(true);

      const caller = notificationsRouter.createCaller(
        createAuthContext("user-rate-test"),
      );

      // 3 successful attempts
      await expect(caller.sendTest()).resolves.toEqual({ success: true });
      await expect(caller.sendTest()).resolves.toEqual({ success: true });
      await expect(caller.sendTest()).resolves.toEqual({ success: true });

      // 4th attempt blocked
      await expect(caller.sendTest()).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    });
  });

  describe("unsubscribe procedure", () => {
    it("calls disableByUnsubscribeToken and returns result", async () => {
      mockDisableByUnsubscribeToken.mockResolvedValue(false);

      const caller = notificationsRouter.createCaller(createAuthContext(null));
      const res = await caller.unsubscribe({ token: "invalid-token" });

      expect(res).toEqual({ success: false });
      expect(mockDisableByUnsubscribeToken).toHaveBeenCalledWith(
        "invalid-token",
      );
    });

    it("enforces rate limit of 30 per minute per IP", async () => {
      mockDisableByUnsubscribeToken.mockResolvedValue(true);

      const ctx: Context = {
        ip: "203.0.113.195",
        authToken: null,
        privyUserId: null,
        privyClaim: null,
        authError: null,
      };
      const caller = notificationsRouter.createCaller(ctx);

      for (let i = 0; i < 30; i++) {
        await expect(
          caller.unsubscribe({ token: `tok-${i}` }),
        ).resolves.toEqual({ success: true });
      }

      // 31st call blocked
      await expect(
        caller.unsubscribe({ token: "tok-overflow" }),
      ).rejects.toMatchObject({
        code: "TOO_MANY_REQUESTS",
      });
    });
  });

  describe("appRouter mounting", () => {
    it("has notifications router mounted on appRouter", () => {
      expect(appRouter._def.procedures).toHaveProperty(
        "notifications.getSettings",
      );
      expect(appRouter._def.procedures).toHaveProperty(
        "notifications.updateSettings",
      );
      expect(appRouter._def.procedures).toHaveProperty(
        "notifications.sendTest",
      );
      expect(appRouter._def.procedures).toHaveProperty(
        "notifications.unsubscribe",
      );
    });
  });
});
