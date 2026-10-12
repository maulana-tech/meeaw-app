import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockNotificationSettings, mockNotificationLogs, mockSendEmail } =
  vi.hoisted(() => ({
    mockNotificationSettings: {
      findOne: vi.fn(),
      updateOne: vi.fn(),
    },
    mockNotificationLogs: {
      insertOne: vi.fn(),
    },
    mockSendEmail: vi.fn(),
  }));

vi.mock("../src/server/db/mongo", () => ({
  getNotificationSettings: vi.fn(async () => mockNotificationSettings),
  getNotificationLogs: vi.fn(async () => mockNotificationLogs),
}));

vi.mock("../src/server/lib/email", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/server/lib/email")>();
  return {
    ...actual,
    sendEmail: mockSendEmail,
  };
});

import {
  disableByUnsubscribeToken,
  findSettingsByPrivyUserId,
  findSettingsByWallet,
  generateUnsubscribeToken,
  recordNotificationLog,
  upsertNotificationSettings,
} from "../src/server/modules/notifications/notifications.repository";
import {
  dispatchNotification,
  formatInvoiceNotification,
  formatRequestPaidNotification,
  formatRequestReceivedNotification,
  sendTestEmail,
} from "../src/server/modules/notifications/notifications.service";

describe("Notifications Formatting", () => {
  it("formats invoice payment notification without sensitive keys", () => {
    const formatted = formatInvoiceNotification({
      invoiceNumber: "INV-2026-001",
      amountFormatted: "250 USDC",
      appUrl: "https://meaw.xyz",
      unsubscribeToken: "token123",
    });

    expect(formatted.subject).toBe("Invoice INV-2026-001 has been paid");
    expect(formatted.html).toContain("250 USDC");
    expect(formatted.html).toContain("https://meaw.xyz/invoices");
    expect(formatted.html).toContain("https://meaw.xyz/unsubscribe/token123");
    expect(formatted.html).not.toContain("0x");
    expect(formatted.text).toContain("INV-2026-001");
    expect(formatted.text).not.toContain("0x");
  });

  it("formats request received notification with requester username", () => {
    const formatted = formatRequestReceivedNotification({
      requesterUsername: "alice",
      appUrl: "https://meaw.xyz",
      unsubscribeToken: "token123",
    });

    expect(formatted.subject).toBe("New payment request from @alice");
    expect(formatted.html).toContain("@alice");
    expect(formatted.html).toContain("https://meaw.xyz/dashboard");
    expect(formatted.html).toContain("https://meaw.xyz/unsubscribe/token123");
    expect(formatted.html).not.toContain("0x");
    expect(formatted.text).toContain("@alice");
    expect(formatted.text).not.toContain("0x");
  });

  it("formats request paid notification with addressee username", () => {
    const formatted = formatRequestPaidNotification({
      addresseeUsername: "bob",
      appUrl: "https://meaw.xyz",
      unsubscribeToken: "token123",
    });

    expect(formatted.subject).toBe("Payment request to @bob has been settled");
    expect(formatted.html).toContain("@bob");
    expect(formatted.html).toContain("https://meaw.xyz/dashboard");
    expect(formatted.html).toContain("https://meaw.xyz/unsubscribe/token123");
    expect(formatted.html).not.toContain("0x");
    expect(formatted.text).toContain("@bob");
    expect(formatted.text).not.toContain("0x");
  });
});

describe("Notifications Repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates 48-char random hex unsubscribe tokens", () => {
    const token1 = generateUnsubscribeToken();
    const token2 = generateUnsubscribeToken();
    expect(token1).toHaveLength(48);
    expect(token2).toHaveLength(48);
    expect(token1).not.toBe(token2);
  });

  it("finds settings by wallet address", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce({
      _id: "0x1234567890123456789012345678901234567890",
      email: "user@example.com",
    });

    const res = await findSettingsByWallet(
      "0x1234567890123456789012345678901234567890",
    );
    expect(res?.email).toBe("user@example.com");
    expect(mockNotificationSettings.findOne).toHaveBeenCalledWith({
      $or: [
        { _id: "0x1234567890123456789012345678901234567890" },
        { _id: "0x1234567890123456789012345678901234567890" },
      ],
    });
  });

  it("finds settings by privy user ID", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce({
      _id: "0x1234567890123456789012345678901234567890",
      privyUserId: "did:privy:user123",
    });

    const res = await findSettingsByPrivyUserId("did:privy:user123");
    expect(res?.privyUserId).toBe("did:privy:user123");
    expect(mockNotificationSettings.findOne).toHaveBeenCalledWith({
      privyUserId: "did:privy:user123",
    });
  });

  it("upserts notification settings generating new token if none exists", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce(null);
    mockNotificationSettings.updateOne.mockResolvedValueOnce({
      acknowledged: true,
    });

    const result = await upsertNotificationSettings(
      "0xAbCdEf1234567890123456789012345678901234",
      "did:privy:123",
      "test@example.com",
      true,
      { invoicePaid: true, requestReceived: false, requestPaid: true },
    );

    expect(result._id).toBe("0xabcdef1234567890123456789012345678901234");
    expect(result.email).toBe("test@example.com");
    expect(result.unsubscribeToken).toHaveLength(48);
    expect(result.enabled).toBe(true);
    expect(mockNotificationSettings.updateOne).toHaveBeenCalledWith(
      { _id: "0xabcdef1234567890123456789012345678901234" },
      {
        $set: expect.objectContaining({
          email: "test@example.com",
          enabled: true,
        }),
      },
      { upsert: true },
    );
  });

  it("upserts notification settings preserving existing token and createdAt", async () => {
    const existingCreatedAt = new Date("2026-01-01T00:00:00Z");
    mockNotificationSettings.findOne.mockResolvedValueOnce({
      _id: "0xabcdef1234567890123456789012345678901234",
      unsubscribeToken: "existing-token-123",
      createdAt: existingCreatedAt,
    });
    mockNotificationSettings.updateOne.mockResolvedValueOnce({
      acknowledged: true,
    });

    const result = await upsertNotificationSettings(
      "0xabcdef1234567890123456789012345678901234",
      "did:privy:123",
      "new@example.com",
      false,
      { invoicePaid: false, requestReceived: false, requestPaid: false },
    );

    expect(result.unsubscribeToken).toBe("existing-token-123");
    expect(result.createdAt).toEqual(existingCreatedAt);
    expect(result.email).toBe("new@example.com");
    expect(result.enabled).toBe(false);
  });

  it("disables notification settings by unsubscribe token", async () => {
    mockNotificationSettings.updateOne.mockResolvedValueOnce({
      modifiedCount: 1,
    });
    const res = await disableByUnsubscribeToken("some-valid-token");
    expect(res).toBe(true);
    expect(mockNotificationSettings.updateOne).toHaveBeenCalledWith(
      { unsubscribeToken: "some-valid-token" },
      { $set: expect.objectContaining({ enabled: false }) },
    );

    mockNotificationSettings.updateOne.mockResolvedValueOnce({
      modifiedCount: 0,
    });
    const resNotFound = await disableByUnsubscribeToken("non-existent-token");
    expect(resNotFound).toBe(false);
  });

  it("records notification log atomically and catches duplicate key error (code 11000)", async () => {
    mockNotificationLogs.insertOne.mockResolvedValueOnce({
      acknowledged: true,
    });
    const success = await recordNotificationLog(
      "invoice-paid:inv_1",
      "user@example.com",
      "invoicePaid",
    );
    expect(success).toBe(true);
    expect(mockNotificationLogs.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "invoice-paid:inv_1",
        recipientEmail: "user@example.com",
        eventType: "invoicePaid",
      }),
    );

    // Duplicate key error simulation
    const duplicateError = new Error("E11000 duplicate key error") as Error & {
      code: number;
    };
    duplicateError.code = 11000;
    mockNotificationLogs.insertOne.mockRejectedValueOnce(duplicateError);

    const dupResult = await recordNotificationLog(
      "invoice-paid:inv_1",
      "user@example.com",
      "invoicePaid",
    );
    expect(dupResult).toBe(false);

    // Other unexpected error is thrown
    const otherError = new Error("Database connection lost");
    mockNotificationLogs.insertOne.mockRejectedValueOnce(otherError);
    await expect(
      recordNotificationLog(
        "invoice-paid:inv_2",
        "user@example.com",
        "invoicePaid",
      ),
    ).rejects.toThrow("Database connection lost");
  });
});

describe("Notifications Dispatch Service", () => {
  const dummyWallet = "0x1111111111111111111111111111111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("APP_URL", "https://meaw.xyz");
    mockSendEmail.mockResolvedValue({ ok: true, id: "msg_ok" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("silently skips dispatch when RESEND_API_KEY is not configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await dispatchNotification({
      eventKey: "invoice-paid:1",
      recipientWallet: dummyWallet,
      eventType: "invoicePaid",
      buildEmail: () => ({ subject: "Test", html: "<p>Hi</p>", text: "Hi" }),
    });

    expect(mockNotificationSettings.findOne).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips dispatch when recipient has no notification settings", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce(null);

    await dispatchNotification({
      eventKey: "invoice-paid:1",
      recipientWallet: dummyWallet,
      eventType: "invoicePaid",
      buildEmail: () => ({ subject: "Test", html: "<p>Hi</p>", text: "Hi" }),
    });

    expect(mockNotificationLogs.insertOne).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips dispatch when notifications are disabled globally", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce({
      _id: dummyWallet.toLowerCase(),
      email: "user@example.com",
      enabled: false,
      events: { invoicePaid: true, requestReceived: true, requestPaid: true },
      unsubscribeToken: "token123",
    });

    await dispatchNotification({
      eventKey: "invoice-paid:1",
      recipientWallet: dummyWallet,
      eventType: "invoicePaid",
      buildEmail: () => ({ subject: "Test", html: "<p>Hi</p>", text: "Hi" }),
    });

    expect(mockNotificationLogs.insertOne).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("skips dispatch when specific event type is disabled in user preferences", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce({
      _id: dummyWallet.toLowerCase(),
      email: "user@example.com",
      enabled: true,
      events: { invoicePaid: false, requestReceived: true, requestPaid: true },
      unsubscribeToken: "token123",
    });

    await dispatchNotification({
      eventKey: "invoice-paid:1",
      recipientWallet: dummyWallet,
      eventType: "invoicePaid",
      buildEmail: () => ({ subject: "Test", html: "<p>Hi</p>", text: "Hi" }),
    });

    expect(mockNotificationLogs.insertOne).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("aborts dispatch immediately on duplicate event key (idempotency)", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce({
      _id: dummyWallet.toLowerCase(),
      email: "user@example.com",
      enabled: true,
      events: { invoicePaid: true, requestReceived: true, requestPaid: true },
      unsubscribeToken: "token123",
    });

    const dupError = new Error("E11000 duplicate") as Error & { code: number };
    dupError.code = 11000;
    mockNotificationLogs.insertOne.mockRejectedValueOnce(dupError);

    await dispatchNotification({
      eventKey: "invoice-paid:duplicate",
      recipientWallet: dummyWallet,
      eventType: "invoicePaid",
      buildEmail: () => ({ subject: "Test", html: "<p>Hi</p>", text: "Hi" }),
    });

    expect(mockNotificationLogs.insertOne).toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("successfully dispatches email when opt-in and not duplicate", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce({
      _id: dummyWallet.toLowerCase(),
      email: "user@example.com",
      enabled: true,
      events: { invoicePaid: true, requestReceived: true, requestPaid: true },
      unsubscribeToken: "token_abc",
    });
    mockNotificationLogs.insertOne.mockResolvedValueOnce({
      acknowledged: true,
    });

    const buildEmailMock = vi.fn().mockReturnValue({
      subject: "Invoice Settled",
      html: "<p>Settled</p>",
      text: "Settled",
    });

    await dispatchNotification({
      eventKey: "invoice-paid:success_1",
      recipientWallet: dummyWallet,
      eventType: "invoicePaid",
      buildEmail: buildEmailMock,
    });

    expect(mockNotificationLogs.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: "invoice-paid:success_1",
        recipientEmail: "user@example.com",
        eventType: "invoicePaid",
      }),
    );
    expect(buildEmailMock).toHaveBeenCalledWith({
      unsubscribeToken: "token_abc",
      appUrl: "https://meaw.xyz",
    });
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: "user@example.com",
      subject: "Invoice Settled",
      html: "<p>Settled</p>",
      text: "Settled",
    });
  });

  it("handles sendEmail rejection gracefully without throwing", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    mockNotificationSettings.findOne.mockResolvedValueOnce({
      _id: dummyWallet.toLowerCase(),
      email: "user@example.com",
      enabled: true,
      events: { invoicePaid: true, requestReceived: true, requestPaid: true },
      unsubscribeToken: "token_abc",
    });
    mockNotificationLogs.insertOne.mockResolvedValueOnce({
      acknowledged: true,
    });
    mockSendEmail.mockRejectedValueOnce(new Error("Network failed"));

    await expect(
      dispatchNotification({
        eventKey: "invoice-paid:err_1",
        recipientWallet: dummyWallet,
        eventType: "invoicePaid",
        buildEmail: () => ({ subject: "Test", html: "<p>Hi</p>", text: "Hi" }),
      }),
    ).resolves.not.toThrow();

    // Give microtasks a turn
    await new Promise((r) => setTimeout(r, 10));
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("Notifications Send Test Email", () => {
  const dummyWallet = "0x1111111111111111111111111111111111111111";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("APP_URL", "https://meaw.xyz");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns false if RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const res = await sendTestEmail(dummyWallet);
    expect(res).toBe(false);
  });

  it("returns false if settings or email are not found", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce(null);
    const res = await sendTestEmail(dummyWallet);
    expect(res).toBe(false);
  });

  it("sends test email and returns true on success", async () => {
    mockNotificationSettings.findOne.mockResolvedValueOnce({
      _id: dummyWallet.toLowerCase(),
      email: "test@example.com",
      unsubscribeToken: "token_xyz",
    });
    mockSendEmail.mockResolvedValueOnce({ ok: true, id: "msg_test" });

    const res = await sendTestEmail(dummyWallet);
    expect(res).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "test@example.com",
        subject: "Meaw: Test email notification",
      }),
    );
  });
});
