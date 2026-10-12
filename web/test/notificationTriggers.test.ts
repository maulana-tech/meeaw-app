import { Binary } from "mongodb";
import { formatUnits, type Hex } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SignedRequest } from "../src/features/requests/types";
import type { PaymentRequestDoc } from "../src/server/db/mongo";
import type { InvoiceDoc } from "../src/server/modules/invoices/invoices.repository";
import { notifyInvoiceSettled } from "../src/server/modules/invoices/invoices.service";
import { notifyRequestPaid } from "../src/server/modules/requests/requestOperations";
import { notifyRequestReceived } from "../src/server/modules/requests/requests.service";

const { mockDispatchNotification } = vi.hoisted(() => ({
  mockDispatchNotification: vi.fn(async () => undefined),
}));

vi.mock(
  "../src/server/modules/notifications/notifications.service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../src/server/modules/notifications/notifications.service")
      >();
    return {
      ...actual,
      dispatchNotification: mockDispatchNotification,
    };
  },
);

describe("Notification Formatting Helpers", () => {
  it("formats token units correctly for invoice notifications", () => {
    const rawAmount = "250000000"; // 250 USDC (6 decimals)
    const formatted = `${formatUnits(BigInt(rawAmount), 6)} USDC`;
    expect(formatted).toBe("250 USDC");
  });
});

describe("Invoice Settled Notification Trigger", () => {
  const dummyWallet = "0x1111111111111111111111111111111111111111" as Hex;
  const mockInvoice: InvoiceDoc = {
    _id: "inv-uuid-123",
    token: "invoice-token-abc",
    ownerPrivyUserId: "user-privy-1",
    ownerWallet: dummyWallet,
    username: "alice",
    number: "INV-2026-001",
    clientName: "Acme Corp",
    asset: "USDC",
    amount: "250000000",
    items: [],
    notes: "Thanks",
    dueDate: "2026-11-01",
    pool: {
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
      transferCapable: true,
    },
    salt: "12345",
    commitment: `0x${"11".repeat(32)}` as Hex,
    ephemeralPk: `0x${"22".repeat(32)}` as Hex,
    ciphertext: `0x${"33".repeat(64)}` as Hex,
    notePubkey: `0x${"44".repeat(32)}` as Hex,
    viewPubkey: `0x${"55".repeat(32)}` as Hex,
    createdBlock: 100,
    status: "paid",
    createdAt: new Date(),
    updatedAt: new Date(),
    checkedAt: null,
    paidAt: new Date(),
    paidTx: `0x${"99".repeat(32)}` as Hex,
    paidBlock: 101,
    leafIndex: 0,
    voidedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchNotification.mockResolvedValue(undefined);
  });

  it("dispatches invoice-paid notification with eventKey invoice-paid:<id> to invoice.ownerWallet", () => {
    notifyInvoiceSettled(mockInvoice);

    expect(mockDispatchNotification).toHaveBeenCalledTimes(1);
    const callArgs = mockDispatchNotification.mock.calls[0][0];

    expect(callArgs.eventKey).toBe("invoice-paid:inv-uuid-123");
    expect(callArgs.recipientWallet).toBe(dummyWallet);
    expect(callArgs.eventType).toBe("invoicePaid");

    // Verify email payload built
    const email = callArgs.buildEmail({
      appUrl: "https://meaw.xyz",
      unsubscribeToken: "unsub-token-789",
    });

    expect(email.subject).toBe("Invoice INV-2026-001 has been paid");
    expect(email.html).toContain("250 USDC");
    expect(email.html).toContain("INV-2026-001");
    expect(email.html).toContain("https://meaw.xyz/invoices");
    expect(email.html).toContain(
      "https://meaw.xyz/unsubscribe/unsub-token-789",
    );
    expect(email.html).not.toContain(dummyWallet);
    expect(email.html).not.toContain(mockInvoice.paidTx);
    expect(email.text).toContain("250 USDC");
  });

  it("handles dispatch failure gracefully without throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDispatchNotification.mockRejectedValueOnce(new Error("Network failed"));

    expect(() => notifyInvoiceSettled(mockInvoice)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("Request Received Notification Trigger", () => {
  const addresseeWallet = "0x3333333333333333333333333333333333333333";
  const mockSignedRequest: SignedRequest = {
    version: 1,
    id: "req-uuid-456",
    pool: "31337:0x1111111111111111111111111111111111111111",
    requester: {
      username: "alice",
      wallet: "0x2222222222222222222222222222222222222222",
      notePubkey: `0x${"11".repeat(32)}`,
      viewPubkey: `0x${"22".repeat(32)}`,
    },
    addressee: {
      username: "bob",
      wallet: addresseeWallet,
      notePubkey: `0x${"33".repeat(32)}`,
      viewPubkey: `0x${"44".repeat(32)}`,
    },
    createdAt: "2026-10-12T00:00:00.000Z",
    recipientCommitment: `0x${"55".repeat(32)}`,
    requesterEnvelope: {
      ephemeralPk: `0x${"66".repeat(32)}`,
      ciphertext: `0x${"00".repeat(64)}`,
    },
    addresseeEnvelope: {
      ephemeralPk: `0x${"77".repeat(32)}`,
      ciphertext: `0x${"11".repeat(64)}`,
    },
    signature: `0x${"88".repeat(65)}`,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchNotification.mockResolvedValue(undefined);
  });

  it("dispatches request-received notification with eventKey request-received:<id> to addressee.wallet", () => {
    notifyRequestReceived(mockSignedRequest);

    expect(mockDispatchNotification).toHaveBeenCalledTimes(1);
    const callArgs = mockDispatchNotification.mock.calls[0][0];

    expect(callArgs.eventKey).toBe("request-received:req-uuid-456");
    expect(callArgs.recipientWallet).toBe(addresseeWallet);
    expect(callArgs.eventType).toBe("requestReceived");

    const email = callArgs.buildEmail({
      appUrl: "https://meaw.xyz",
      unsubscribeToken: "unsub-token-xyz",
    });

    expect(email.subject).toBe("New payment request from @alice");
    expect(email.html).toContain("@alice");
    expect(email.html).toContain("https://meaw.xyz/dashboard");
    expect(email.html).toContain(
      "https://meaw.xyz/unsubscribe/unsub-token-xyz",
    );
    expect(email.html).not.toContain(addresseeWallet);
    expect(email.html).not.toContain("0x");
    expect(email.text).toContain("@alice");
  });

  it("handles dispatch failure gracefully without throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDispatchNotification.mockRejectedValueOnce(new Error("Network failed"));

    expect(() => notifyRequestReceived(mockSignedRequest)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe("Request Paid Notification Trigger", () => {
  const requesterWallet = "0x2222222222222222222222222222222222222222";
  const mockRequestDoc: PaymentRequestDoc = {
    _id: "req-uuid-789",
    version: 1,
    scope: "31337:0x1111111111111111111111111111111111111111",
    requesterWallet: requesterWallet,
    addresseeWallet: "0x3333333333333333333333333333333333333333",
    requester: {
      username: "alice",
      wallet: requesterWallet,
      notePubkey: `0x${"11".repeat(32)}`,
      viewPubkey: `0x${"22".repeat(32)}`,
    },
    addressee: {
      username: "bob",
      wallet: "0x3333333333333333333333333333333333333333",
      notePubkey: `0x${"33".repeat(32)}`,
      viewPubkey: `0x${"44".repeat(32)}`,
    },
    createdAt: new Date(),
    recipientCommitment: `0x${"55".repeat(32)}`,
    requesterEnvelope: {
      ephemeralPk: new Binary(Buffer.alloc(32)),
      ciphertext: new Binary(Buffer.alloc(64)),
    },
    addresseeEnvelope: {
      ephemeralPk: new Binary(Buffer.alloc(32)),
      ciphertext: new Binary(Buffer.alloc(64)),
    },
    signature: `0x${"88".repeat(65)}`,
    digest: `0x${"99".repeat(32)}`,
    status: "paid",
    revision: 2,
    operationId: "op-123",
    reservation: null,
    receipt: {
      txHash: `0x${"aa".repeat(32)}`,
      leafIndex: 1,
      block: 102,
    },
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatchNotification.mockResolvedValue(undefined);
  });

  it("dispatches request-paid notification with eventKey request-paid:<id> to requester.wallet", () => {
    notifyRequestPaid(mockRequestDoc);

    expect(mockDispatchNotification).toHaveBeenCalledTimes(1);
    const callArgs = mockDispatchNotification.mock.calls[0][0];

    expect(callArgs.eventKey).toBe("request-paid:req-uuid-789");
    expect(callArgs.recipientWallet).toBe(requesterWallet);
    expect(callArgs.eventType).toBe("requestPaid");

    const email = callArgs.buildEmail({
      appUrl: "https://meaw.xyz",
      unsubscribeToken: "unsub-token-paid",
    });

    expect(email.subject).toBe("Payment request to @bob has been settled");
    expect(email.html).toContain("@bob");
    expect(email.html).toContain("https://meaw.xyz/dashboard");
    expect(email.html).toContain(
      "https://meaw.xyz/unsubscribe/unsub-token-paid",
    );
    expect(email.html).not.toContain(requesterWallet);
    expect(email.html).not.toContain("0x");
    expect(email.text).toContain("@bob");
  });

  it("handles dispatch failure gracefully without throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDispatchNotification.mockRejectedValueOnce(new Error("Network failed"));

    expect(() => notifyRequestPaid(mockRequestDoc)).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
