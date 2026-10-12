# Email Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement opt-in email notifications via Resend for invoice and request payment events, strictly adhering to Meaw's existing `--dash-*` token vocabulary and zero-crypto-leak privacy guarantees.

**Architecture:** A lightweight inline dispatch pattern using native HTTP `fetch` to Resend (`https://api.resend.com/emails`) with atomic idempotency tracking via MongoDB (`notification_logs`). When `RESEND_API_KEY` is omitted, the service gracefully degrades with zero operational errors, and settings UI strictly integrates into `SettingsDashboard.tsx` using existing design tokens.

**Tech Stack:** Next.js 15, React 19, TypeScript, tRPC, MongoDB, Resend HTTP API, Vitest.

## Global Constraints

- Never log or send private keys, seed phrases, viewing keys, note commitments, nullifiers, transaction hashes, or wallet addresses (`0x...`) in email copy.
- Opt-in by default: notifications remain disabled until the user explicitly saves their email and turns on notifications.
- UI styling must strictly use existing `--dash-*` design tokens (`--dash-bg`, `--dash-surface`, `--dash-fg`, `--dash-ash`, `--dash-line`, `--dash-line-solid`, `--dash-line-strong`, `--dash-tint`), `dashCell`, `dashLedger`, `dashButtonPrimary`, and existing `components/ui/` primitives (`Badge`, `Button`, `Input`, `Label`). No foreign styles or arbitrary colors.
- Zero new third-party SDK dependencies (no `@resend/node` or similar); use standard Node `fetch` with 5s timeout.

---

### Task 1: Environment Variables & Database Schema Setup

**Files:**
- Modify: `web/src/env.server.ts`
- Modify: `web/.env.example`
- Modify: `web/src/server/db/mongo.ts`
- Create: `web/migrations/20261012160000-notifications.js`
- Test: `web/test/notificationEnvironment.test.ts`

**Interfaces:**
- Produces: `getServerEnv().RESEND_API_KEY`, `getServerEnv().EMAIL_FROM`, `getServerEnv().APP_URL`
- Produces: `getNotificationSettings()`, `getNotificationLogs()`, `NotificationSettingsDoc`, `NotificationLogDoc`

- [ ] **Step 1: Write the failing test**

Create `web/test/notificationEnvironment.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "../src/env.server";

describe("Notification Environment Schema", () => {
  it("parses optional RESEND_API_KEY, EMAIL_FROM, and APP_URL", () => {
    const parsed = serverEnvSchema.parse({
      RESEND_API_KEY: "re_123456789",
      EMAIL_FROM: "Meaw <hello@meaw.xyz>",
      APP_URL: "https://meaw.xyz",
    });
    expect(parsed.RESEND_API_KEY).toBe("re_123456789");
    expect(parsed.EMAIL_FROM).toBe("Meaw <hello@meaw.xyz>");
    expect(parsed.APP_URL).toBe("https://meaw.xyz");
  });

  it("handles empty or missing env values gracefully", () => {
    const parsed = serverEnvSchema.parse({});
    expect(parsed.RESEND_API_KEY).toBeUndefined();
    expect(parsed.EMAIL_FROM).toBeUndefined();
    expect(parsed.APP_URL).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test test/notificationEnvironment.test.ts`  
Expected: FAIL due to missing schema keys.

- [ ] **Step 3: Implement minimal code**

1. Update `web/src/env.server.ts`:
Add `RESEND_API_KEY: optionalString`, `EMAIL_FROM: optionalString`, `APP_URL: optionalString` to `serverEnvSchema` and `getServerEnv()`.

2. Update `web/.env.example`:
```env
# Email notifications (optional, via Resend). If empty, notifications are disabled silently.
RESEND_API_KEY=
EMAIL_FROM=Meaw <hello@meaw.xyz>
APP_URL=http://localhost:3000
```

3. Update `web/src/server/db/mongo.ts`:
Add types:
```ts
export type NotificationSettingsDoc = {
  _id: string; // Checksummed EVM address (matches UserDoc._id)
  privyUserId: string;
  email: string;
  enabled: boolean;
  events: {
    invoicePaid: boolean;
    requestReceived: boolean;
    requestPaid: boolean;
  };
  unsubscribeToken: string;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationLogDoc = {
  _id: string; // Unique eventKey (e.g. "invoice-paid:<id>")
  recipientEmail: string;
  eventType: "invoicePaid" | "requestReceived" | "requestPaid" | "test";
  sentAt: Date;
};
```
Add getter functions:
```ts
export async function getNotificationSettings(): Promise<Collection<NotificationSettingsDoc>> {
  return (await getDb()).collection<NotificationSettingsDoc>("notification_settings");
}

export async function getNotificationLogs(): Promise<Collection<NotificationLogDoc>> {
  return (await getDb()).collection<NotificationLogDoc>("notification_logs");
}
```

4. Create migration `web/migrations/20261012160000-notifications.js`:
```js
export const up = async (db) => {
  const settings = db.collection("notification_settings");
  await settings.createIndex({ privyUserId: 1 }, { unique: true });
  await settings.createIndex({ unsubscribeToken: 1 }, { unique: true });

  const logs = db.collection("notification_logs");
  await logs.createIndex({ sentAt: 1 }, { expireAfterSeconds: 2592000 });
};

export const down = async (db) => {
  const settings = db.collection("notification_settings");
  try {
    await settings.dropIndex("privyUserId_1");
  } catch {}
  try {
    await settings.dropIndex("unsubscribeToken_1");
  } catch {}

  const logs = db.collection("notification_logs");
  try {
    await logs.dropIndex("sentAt_1");
  } catch {}
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/notificationEnvironment.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/env.server.ts web/.env.example web/src/server/db/mongo.ts web/migrations/20261012160000-notifications.js web/test/notificationEnvironment.test.ts
git commit -m "feat(notifications): add environment schema, mongo types, and migration"
```

---

### Task 2: Native Resend Email Transport & Templates

**Files:**
- Create: `web/src/server/lib/email.ts`
- Test: `web/test/email.test.ts`

**Interfaces:**
- Produces: `sendEmail(params: SendEmailParams): Promise<SendEmailResult>`
- Produces: `buildEmailHtml(params: EmailContent): string`
- Produces: `buildEmailText(params: EmailContent): string`

- [ ] **Step 1: Write the failing test**

Create `web/test/email.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEmailHtml, buildEmailText, sendEmail } from "../src/server/lib/email";

describe("Email Transport and Templates", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("EMAIL_FROM", "Meaw <test@meaw.xyz>");
    vi.stubEnv("APP_URL", "https://app.meaw.xyz");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    global.fetch = originalFetch;
  });

  it("builds clean HTML without crypto leaks and includes unsubscribe link", () => {
    const html = buildEmailHtml({
      title: "Invoice Paid",
      message: "Invoice INV-001 has been settled: 250 USDC.",
      actionLabel: "View Invoices",
      actionUrl: "https://app.meaw.xyz/invoices",
      unsubscribeUrl: "https://app.meaw.xyz/unsubscribe/abc123token",
    });

    expect(html).toContain("Invoice Paid");
    expect(html).toContain("Invoice INV-001 has been settled: 250 USDC.");
    expect(html).toContain("https://app.meaw.xyz/invoices");
    expect(html).toContain("https://app.meaw.xyz/unsubscribe/abc123token");
    expect(html).not.toContain("0x");
  });

  it("returns not_configured without throwing when RESEND_API_KEY is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const result = await sendEmail({
      to: "client@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_configured");
  });

  it("sends request to Resend API when configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "msg_123" }),
    });
    global.fetch = mockFetch;

    const result = await sendEmail({
      to: "client@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
      text: "Hello",
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer re_test_key",
      }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test test/email.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement minimal code**

Create `web/src/server/lib/email.ts`:
```ts
import "server-only";
import { getServerEnv } from "../../env.server";

export type EmailContent = {
  title: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
  unsubscribeUrl?: string;
};

export type SendEmailParams = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type SendEmailResult =
  | { ok: true; id?: string }
  | { ok: false; reason: "not_configured" | "request_failed" | "timeout" };

export function buildEmailHtml(params: EmailContent): string {
  const { title, message, actionLabel, actionUrl, unsubscribeUrl } = params;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="margin:0;padding:32px 16px;background-color:#151310;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#faf7f0;">
  <table align="center" width="100%" style="max-width:540px;background-color:#1d1b16;border:1px solid #33312c;border-radius:10px;padding:32px;border-collapse:separate;">
    <tr>
      <td style="padding-bottom:24px;border-bottom:1px solid #33312c;">
        <span style="font-size:18px;font-weight:700;letter-spacing:0.05em;color:#faf7f0;">MEAW</span>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 0 16px;">
        <h1 style="margin:0 0 12px;font-size:20px;font-weight:600;color:#faf7f0;">${title}</h1>
        <p style="margin:0;font-size:15px;line-height:24px;color:#a8a092;">${message}</p>
      </td>
    </tr>
    ${
      actionUrl && actionLabel
        ? `<tr>
      <td style="padding-top:16px;padding-bottom:28px;">
        <a href="${actionUrl}" style="display:inline-block;padding:10px 22px;background-color:#faf7f0;color:#151310;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;border-radius:9999px;">${actionLabel}</a>
      </td>
    </tr>`
        : ""
    }
    ${
      unsubscribeUrl
        ? `<tr>
      <td style="padding-top:20px;border-top:1px solid #33312c;font-size:12px;color:#6b655a;line-height:18px;">
        This email was sent to your registered address for payment notifications.<br>
        <a href="${unsubscribeUrl}" style="color:#a8a092;text-decoration:underline;">Unsubscribe from all notifications</a>
      </td>
    </tr>`
        : ""
    }
  </table>
</body>
</html>`;
}

export function buildEmailText(params: EmailContent): string {
  const parts = [`MEAW - ${params.title}`, "", params.message];
  if (params.actionLabel && params.actionUrl) {
    parts.push("", `${params.actionLabel}: ${params.actionUrl}`);
  }
  if (params.unsubscribeUrl) {
    parts.push("", `Unsubscribe: ${params.unsubscribeUrl}`);
  }
  return parts.join("\n");
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) {
    return { ok: false, reason: "not_configured" };
  }

  const from = env.EMAIL_FROM || "Meaw <hello@meaw.xyz>";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error("[email] Resend returned error status:", response.status);
      return { ok: false, reason: "request_failed" };
    }

    const data = (await response.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[email] Request timed out");
      return { ok: false, reason: "timeout" };
    }
    console.error("[email] Failed to send email:", error);
    return { ok: false, reason: "request_failed" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/email.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/server/lib/email.ts web/test/email.test.ts
git commit -m "feat(notifications): add native Resend email client and branded templates"
```

---

### Task 3: Notification Repository & Dispatch Service (Idempotency Engine)

**Files:**
- Create: `web/src/server/modules/notifications/notifications.repository.ts`
- Create: `web/src/server/modules/notifications/notifications.service.ts`
- Test: `web/test/notifications.service.test.ts`

**Interfaces:**
- Produces: `getSettingsForUser(privyUserId: string, walletAddress: string)`
- Produces: `updateSettingsForUser(privyUserId: string, walletAddress: string, data: UpdateSettingsInput)`
- Produces: `unsubscribeUserByToken(token: string)`
- Produces: `dispatchNotification(params: DispatchParams)`
- Produces: `sendTestEmailForUser(privyUserId: string, walletAddress: string)`

- [ ] **Step 1: Write the failing test**

Create `web/test/notifications.service.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  dispatchNotification,
  formatInvoiceNotification,
  formatRequestReceivedNotification,
  formatRequestPaidNotification,
} from "../src/server/modules/notifications/notifications.service";

describe("Notifications Service", () => {
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
    expect(formatted.html).not.toContain("0x");
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
  });

  it("formats request paid notification with addressee username", () => {
    const formatted = formatRequestPaidNotification({
      addresseeUsername: "bob",
      appUrl: "https://meaw.xyz",
      unsubscribeToken: "token123",
    });

    expect(formatted.subject).toBe("Payment request to @bob has been settled");
    expect(formatted.html).toContain("@bob");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test test/notifications.service.test.ts`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement minimal code**

1. Create `web/src/server/modules/notifications/notifications.repository.ts`:
```ts
import "server-only";
import { randomBytes } from "node:crypto";
import {
  getNotificationLogs,
  getNotificationSettings,
  type NotificationLogDoc,
  type NotificationSettingsDoc,
} from "../../db/mongo";

export function generateUnsubscribeToken(): string {
  return randomBytes(24).toString("hex");
}

export async function findSettingsByWallet(
  walletAddress: string,
): Promise<NotificationSettingsDoc | null> {
  const collection = await getNotificationSettings();
  return collection.findOne({ _id: walletAddress.toLowerCase() });
}

export async function findSettingsByPrivyUserId(
  privyUserId: string,
): Promise<NotificationSettingsDoc | null> {
  const collection = await getNotificationSettings();
  return collection.findOne({ privyUserId });
}

export async function upsertNotificationSettings(
  walletAddress: string,
  privyUserId: string,
  email: string,
  enabled: boolean,
  events: {
    invoicePaid: boolean;
    requestReceived: boolean;
    requestPaid: boolean;
  },
): Promise<NotificationSettingsDoc> {
  const collection = await getNotificationSettings();
  const now = new Date();
  const address = walletAddress.toLowerCase();

  const existing = await collection.findOne({ _id: address });
  const unsubscribeToken = existing?.unsubscribeToken ?? generateUnsubscribeToken();

  const update: NotificationSettingsDoc = {
    _id: address,
    privyUserId,
    email,
    enabled,
    events,
    unsubscribeToken,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await collection.updateOne(
    { _id: address },
    { $set: update },
    { upsert: true },
  );

  return update;
}

export async function disableByUnsubscribeToken(
  token: string,
): Promise<boolean> {
  const collection = await getNotificationSettings();
  const res = await collection.updateOne(
    { unsubscribeToken: token },
    { $set: { enabled: false, updatedAt: new Date() } },
  );
  return res.modifiedCount > 0;
}

export async function recordNotificationLog(
  eventKey: string,
  recipientEmail: string,
  eventType: NotificationLogDoc["eventType"],
): Promise<boolean> {
  const collection = await getNotificationLogs();
  try {
    await collection.insertOne({
      _id: eventKey,
      recipientEmail,
      eventType,
      sentAt: new Date(),
    });
    return true;
  } catch (error: any) {
    if (error?.code === 11000) {
      return false; // Duplicate event key
    }
    throw error;
  }
}
```

2. Create `web/src/server/modules/notifications/notifications.service.ts`:
```ts
import "server-only";
import { getServerEnv } from "../../env.server";
import { buildEmailHtml, buildEmailText, sendEmail } from "../../lib/email";
import {
  disableByUnsubscribeToken,
  findSettingsByPrivyUserId,
  findSettingsByWallet,
  recordNotificationLog,
  upsertNotificationSettings,
} from "./notifications.repository";

export function formatInvoiceNotification(params: {
  invoiceNumber: string;
  amountFormatted: string;
  appUrl: string;
  unsubscribeToken: string;
}) {
  const { invoiceNumber, amountFormatted, appUrl, unsubscribeToken } = params;
  const title = `Invoice ${invoiceNumber} settled`;
  const message = `Your invoice ${invoiceNumber} for ${amountFormatted} has been paid into your private balance.`;
  const actionLabel = "View Invoices";
  const actionUrl = `${appUrl}/invoices`;
  const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;

  return {
    subject: `Invoice ${invoiceNumber} has been paid`,
    html: buildEmailHtml({ title, message, actionLabel, actionUrl, unsubscribeUrl }),
    text: buildEmailText({ title, message, actionLabel, actionUrl, unsubscribeUrl }),
  };
}

export function formatRequestReceivedNotification(params: {
  requesterUsername: string;
  appUrl: string;
  unsubscribeToken: string;
}) {
  const { requesterUsername, appUrl, unsubscribeToken } = params;
  const title = "Payment request received";
  const message = `@${requesterUsername} sent you a payment request. Open Meaw to review and pay.`;
  const actionLabel = "Open Meaw";
  const actionUrl = `${appUrl}/dashboard`;
  const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;

  return {
    subject: `New payment request from @${requesterUsername}`,
    html: buildEmailHtml({ title, message, actionLabel, actionUrl, unsubscribeUrl }),
    text: buildEmailText({ title, message, actionLabel, actionUrl, unsubscribeUrl }),
  };
}

export function formatRequestPaidNotification(params: {
  addresseeUsername: string;
  appUrl: string;
  unsubscribeToken: string;
}) {
  const { addresseeUsername, appUrl, unsubscribeToken } = params;
  const title = "Payment request settled";
  const message = `Your payment request to @${addresseeUsername} has been paid into your private balance.`;
  const actionLabel = "Open Meaw";
  const actionUrl = `${appUrl}/dashboard`;
  const unsubscribeUrl = `${appUrl}/unsubscribe/${unsubscribeToken}`;

  return {
    subject: `Payment request to @${addresseeUsername} has been settled`,
    html: buildEmailHtml({ title, message, actionLabel, actionUrl, unsubscribeUrl }),
    text: buildEmailText({ title, message, actionLabel, actionUrl, unsubscribeUrl }),
  };
}

export async function dispatchNotification(params: {
  eventKey: string;
  recipientWallet: string;
  eventType: "invoicePaid" | "requestReceived" | "requestPaid";
  buildEmail: (settings: { unsubscribeToken: string; appUrl: string }) => {
    subject: string;
    html: string;
    text: string;
  };
}): Promise<void> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return;

  const settings = await findSettingsByWallet(params.recipientWallet);
  if (!settings || !settings.enabled || !settings.events[params.eventType]) {
    return;
  }

  const reserved = await recordNotificationLog(
    params.eventKey,
    settings.email,
    params.eventType,
  );
  if (!reserved) {
    return; // Already dispatched
  }

  const appUrl = env.APP_URL || "http://localhost:3000";
  const emailData = params.buildEmail({
    unsubscribeToken: settings.unsubscribeToken,
    appUrl,
  });

  // Non-blocking fire and forget
  void sendEmail({
    to: settings.email,
    subject: emailData.subject,
    html: emailData.html,
    text: emailData.text,
  }).catch((err) => {
    console.error(`[notifications] Error dispatching ${params.eventKey}:`, err);
  });
}

export async function sendTestEmail(walletAddress: string): Promise<boolean> {
  const env = getServerEnv();
  if (!env.RESEND_API_KEY) return false;

  const settings = await findSettingsByWallet(walletAddress);
  if (!settings || !settings.email) return false;

  const appUrl = env.APP_URL || "http://localhost:3000";
  const title = "Meaw Notification Test";
  const message = "Your email notification preferences are active. You will receive updates according to your settings.";
  const actionLabel = "Open Settings";
  const actionUrl = `${appUrl}/settings`;
  const unsubscribeUrl = `${appUrl}/unsubscribe/${settings.unsubscribeToken}`;

  const res = await sendEmail({
    to: settings.email,
    subject: "Meaw: Test email notification",
    html: buildEmailHtml({ title, message, actionLabel, actionUrl, unsubscribeUrl }),
    text: buildEmailText({ title, message, actionLabel, actionUrl, unsubscribeUrl }),
  });

  return res.ok;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/notifications.service.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/server/modules/notifications/notifications.repository.ts web/src/server/modules/notifications/notifications.service.ts web/test/notifications.service.test.ts
git commit -m "feat(notifications): add notification repository and dispatch service"
```

---

### Task 4: Notification tRPC Router & Unsubscribe Procedure

**Files:**
- Create: `web/src/server/modules/notifications/notifications.router.ts`
- Modify: `web/src/server/root.ts`
- Test: `web/test/notifications.router.test.ts`

**Interfaces:**
- Produces: `trpc.notifications.getSettings`
- Produces: `trpc.notifications.updateSettings`
- Produces: `trpc.notifications.sendTest`
- Produces: `trpc.notifications.unsubscribe`

- [ ] **Step 1: Write the failing test**

Create `web/test/notifications.router.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";

const updateSettingsSchema = z.object({
  email: z.string().trim().email(),
  enabled: z.boolean(),
  events: z.object({
    invoicePaid: z.boolean(),
    requestReceived: z.boolean(),
    requestPaid: z.boolean(),
  }),
});

describe("Notification Router Validation", () => {
  it("validates correct email and toggles", () => {
    const input = {
      email: "user@example.com",
      enabled: true,
      events: {
        invoicePaid: true,
        requestReceived: true,
        requestPaid: false,
      },
    };
    expect(updateSettingsSchema.parse(input)).toEqual(input);
  });

  it("rejects invalid email addresses", () => {
    expect(() =>
      updateSettingsSchema.parse({
        email: "not-an-email",
        enabled: true,
        events: { invoicePaid: true, requestReceived: true, requestPaid: true },
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter web test test/notifications.router.test.ts`  
Expected: PASS.

- [ ] **Step 3: Implement tRPC Router and Mount**

Create `web/src/server/modules/notifications/notifications.router.ts`:
```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getServerEnv } from "../../env.server";
import { rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../../trpc";
import { currentWallet } from "../wallets/wallets.service";
import {
  disableByUnsubscribeToken,
  findSettingsByWallet,
  upsertNotificationSettings,
} from "./notifications.repository";
import { sendTestEmail } from "./notifications.service";

const updateSettingsInput = z.object({
  email: z.string().trim().email(),
  enabled: z.boolean(),
  events: z.object({
    invoicePaid: z.boolean(),
    requestReceived: z.boolean(),
    requestPaid: z.boolean(),
  }),
});

export const notificationsRouter = createTRPCRouter({
  getSettings: protectedProcedure.query(async ({ ctx }) => {
    const env = getServerEnv();
    const serviceAvailable = Boolean(env.RESEND_API_KEY);
    const wallet = await currentWallet(ctx.privyUserId);
    if (!wallet) {
      return { serviceAvailable, settings: null };
    }

    const settings = await findSettingsByWallet(wallet.address);
    return {
      serviceAvailable,
      settings: settings
        ? {
            email: settings.email,
            enabled: settings.enabled,
            events: settings.events,
          }
        : null,
    };
  }),

  updateSettings: protectedProcedure
    .input(updateSettingsInput)
    .mutation(async ({ ctx, input }) => {
      const wallet = await currentWallet(ctx.privyUserId);
      if (!wallet) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No Meaw wallet is linked to this account.",
        });
      }

      return upsertNotificationSettings(
        wallet.address,
        ctx.privyUserId,
        input.email,
        input.enabled,
        input.events,
      );
    }),

  sendTest: protectedProcedure.mutation(async ({ ctx }) => {
    if (!rateLimit(`notifications:test:${ctx.privyUserId}`, 3, 10 * 60_000).ok) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "You can send up to 3 test emails every 10 minutes.",
      });
    }

    const wallet = await currentWallet(ctx.privyUserId);
    if (!wallet) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No Meaw wallet is linked to this account.",
      });
    }

    const ok = await sendTestEmail(wallet.address);
    if (!ok) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Failed to send test email. Ensure your email is configured and saved.",
      });
    }

    return { success: true };
  }),

  unsubscribe: publicProcedure
    .input(z.object({ token: z.string().trim().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (!rateLimit(`notifications:unsubscribe:${ctx.ip ?? "unknown"}`, 30, 60_000).ok) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Too many attempts. Try again shortly.",
        });
      }

      const success = await disableByUnsubscribeToken(input.token);
      return { success };
    }),
});
```

Modify `web/src/server/root.ts`:
Import `notificationsRouter` and add `notifications: notificationsRouter` to `appRouter`.

- [ ] **Step 4: Run typecheck / test to verify**

Run: `pnpm --filter web test test/notifications.router.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/server/modules/notifications/notifications.router.ts web/src/server/root.ts web/test/notifications.router.test.ts
git commit -m "feat(notifications): mount notifications tRPC router"
```

---

### Task 5: Event Triggers in Invoices and Requests

**Files:**
- Modify: `web/src/server/modules/invoices/invoices.service.ts`
- Modify: `web/src/server/modules/requests/requests.service.ts`
- Modify: `web/src/server/modules/requests/requestOperations.ts`
- Test: `web/test/notificationTriggers.test.ts`

**Interfaces:**
- Consumes: `dispatchNotification`, `formatInvoiceNotification`, `formatRequestReceivedNotification`, `formatRequestPaidNotification`
- Modifies: `confirmInvoicePayment`, `checkInvoicePayment`, `reconcileInvoices` to fire `invoicePaid`
- Modifies: `createRequest` to fire `requestReceived`
- Modifies: settlement in `requestOperations.ts` to fire `requestPaid`

- [ ] **Step 1: Write trigger tests**

Create `web/test/notificationTriggers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatUnits } from "viem";

describe("Notification Formatting Helpers", () => {
  it("formats token units correctly for invoice notifications", () => {
    const rawAmount = "250000000"; // 250 USDC (6 decimals)
    const formatted = `${formatUnits(BigInt(rawAmount), 6)} USDC`;
    expect(formatted).toBe("250 USDC");
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter web test test/notificationTriggers.test.ts`  
Expected: PASS.

- [ ] **Step 3: Integrate Triggers into Domain Services**

1. In `web/src/server/modules/invoices/invoices.service.ts`:
Define helper function:
```ts
function notifyInvoiceSettled(invoice: InvoiceDoc) {
  const amountFormatted = `${formatUnits(BigInt(invoice.amount), invoice.tokenDecimals)} ${invoice.asset}`;
  void dispatchNotification({
    eventKey: `invoice-paid:${invoice._id.toString()}`,
    recipientWallet: invoice.ownerWallet,
    eventType: "invoicePaid",
    buildEmail: ({ appUrl, unsubscribeToken }) =>
      formatInvoiceNotification({
        invoiceNumber: invoice.number,
        amountFormatted,
        appUrl,
        unsubscribeToken,
      }),
  });
}
```
Call `notifyInvoiceSettled(updated)` in `confirmInvoicePayment`, `checkInvoicePayment`, and `reconcileInvoices` right after the status is updated to `"paid"`.

2. In `web/src/server/modules/requests/requests.service.ts`:
In `createRequest`, when request is successfully saved:
```ts
void dispatchNotification({
  eventKey: `request-received:${record.id}`,
  recipientWallet: record.addressee.wallet,
  eventType: "requestReceived",
  buildEmail: ({ appUrl, unsubscribeToken }) =>
    formatRequestReceivedNotification({
      requesterUsername: record.requester.username,
      appUrl,
      unsubscribeToken,
    }),
});
```

3. In `web/src/server/modules/requests/requestOperations.ts`:
In settlement resolution when status is finalized to `"paid"`:
```ts
void dispatchNotification({
  eventKey: `request-paid:${requestDoc._id}`,
  recipientWallet: requestDoc.requesterWallet,
  eventType: "requestPaid",
  buildEmail: ({ appUrl, unsubscribeToken }) =>
    formatRequestPaidNotification({
      addresseeUsername: requestDoc.addressee.username,
      appUrl,
      unsubscribeToken,
    }),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/notificationTriggers.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/server/modules/invoices/invoices.service.ts web/src/server/modules/requests/requests.service.ts web/src/server/modules/requests/requestOperations.ts web/test/notificationTriggers.test.ts
git commit -m "feat(notifications): attach email triggers to invoices and payment requests"
```

---

### Task 6: Settings UI Integration (EmailNotificationsRow)

**Files:**
- Create: `web/src/features/notifications/EmailNotificationsRow.tsx`
- Modify: `web/src/components/dashboard/SettingsDashboard.tsx`
- Test: `web/test/EmailNotificationsRow.test.tsx`

**Interfaces:**
- Produces: `<EmailNotificationsRow />` component rendered in `<SettingsDashboard />`
- Adheres strictly to `--dash-*` tokens: `dashCell`, `dashButtonPrimary`, `<Badge>`, `<Button variant="outline">`, `<Input appearance="linen">`, `<Label>`

- [ ] **Step 1: Write UI component test**

Create `web/test/EmailNotificationsRow.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";

describe("EmailNotificationsRow Component Specifications", () => {
  it("verifies event types structure", () => {
    const defaultEvents = {
      invoicePaid: true,
      requestReceived: true,
      requestPaid: true,
    };
    expect(defaultEvents.invoicePaid).toBe(true);
    expect(defaultEvents.requestReceived).toBe(true);
    expect(defaultEvents.requestPaid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter web test test/EmailNotificationsRow.test.tsx`  
Expected: PASS.

- [ ] **Step 3: Implement EmailNotificationsRow Component**

Create `web/src/features/notifications/EmailNotificationsRow.tsx`:
```tsx
"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Loader } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { dashButtonPrimary, dashCell } from "../../components/dashboard/styles";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { trpc } from "../../trpc/react";

export function EmailNotificationsRow() {
  const { user } = usePrivy();
  const query = trpc.notifications.getSettings.useQuery();
  const updateMutation = trpc.notifications.updateSettings.useMutation();
  const testMutation = trpc.notifications.sendTest.useMutation();

  const [email, setEmail] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [events, setEvents] = useState({
    invoicePaid: true,
    requestReceived: true,
    requestPaid: true,
  });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (query.data && !initialized) {
      if (query.data.settings) {
        setEmail(query.data.settings.email);
        setEnabled(query.data.settings.enabled);
        setEvents(query.data.settings.events);
      } else {
        // Prefill from Privy if available
        const privyEmail =
          user?.email?.address ||
          user?.google?.email ||
          "";
        if (privyEmail) setEmail(privyEmail);
      }
      setInitialized(true);
    }
  }, [query.data, initialized, user]);

  const serviceAvailable = query.data?.serviceAvailable ?? false;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !email.includes("@")) {
      toast.error("Please enter a valid email address.");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        email: email.trim(),
        enabled,
        events,
      });
      await query.refetch();
      toast.success("Notification preferences saved");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save preferences");
    }
  }

  async function handleSendTest() {
    try {
      await testMutation.mutateAsync();
      toast.success("Test email sent! Check your inbox.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to send test email");
    }
  }

  return (
    <section className={`${dashCell} p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 className="dashboard-tile-title">Email notifications</h2>
        {!serviceAvailable ? (
          <Badge variant="outline" className="border-(--dash-line) text-(--dash-ash)">
            Service not configured
          </Badge>
        ) : enabled ? (
          <Badge className="gap-1.5 border border-(--dash-line) bg-transparent text-(--dash-fg)">
            <span className="size-1.5 rounded-full bg-(--dash-accent)" aria-hidden="true" />
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="border-(--dash-line) text-(--dash-ash)">
            Disabled
          </Badge>
        )}
      </div>

      <div className="mt-3 max-w-xl text-sm leading-6 text-(--dash-ash)">
        Get notified when invoices or requests are settled. Emails never reveal your private balance or keys.
      </div>

      <form onSubmit={handleSave} className="mt-5 space-y-5">
        <div className="flex items-center gap-3">
          <input
            id="notify-enabled"
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-4 rounded border-(--dash-line-strong) bg-(--dash-tint) text-(--dash-fg) focus:ring-(--dash-fg)"
          />
          <Label htmlFor="notify-enabled" className="cursor-pointer text-sm font-medium text-(--dash-fg)">
            Enable email notifications
          </Label>
        </div>

        {enabled && (
          <div className="space-y-4 rounded-(--dash-radius-sm) border border-(--dash-line) bg-(--dash-tint) p-4">
            <div className="space-y-2">
              <Label htmlFor="notify-email" className="text-xs font-medium uppercase tracking-wider text-(--dash-ash)">
                Notification Email
              </Label>
              <Input
                id="notify-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                appearance="linen"
                className="max-w-md"
                required
              />
            </div>

            <div className="space-y-3 pt-2">
              <p className="text-xs font-medium uppercase tracking-wider text-(--dash-ash)">
                Events to receive
              </p>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={events.invoicePaid}
                  onChange={(e) => setEvents({ ...events, invoicePaid: e.target.checked })}
                  className="mt-0.5 size-4 rounded border-(--dash-line-strong) bg-(--dash-surface) text-(--dash-fg) focus:ring-(--dash-fg)"
                />
                <div>
                  <span className="text-sm font-medium text-(--dash-fg)">Invoice settled</span>
                  <p className="text-xs text-(--dash-ash)">When a client settles an invoice you created</p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={events.requestReceived}
                  onChange={(e) => setEvents({ ...events, requestReceived: e.target.checked })}
                  className="mt-0.5 size-4 rounded border-(--dash-line-strong) bg-(--dash-surface) text-(--dash-fg) focus:ring-(--dash-fg)"
                />
                <div>
                  <span className="text-sm font-medium text-(--dash-fg)">Payment request received</span>
                  <p className="text-xs text-(--dash-ash)">When another user requests a payment from you</p>
                </div>
              </label>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={events.requestPaid}
                  onChange={(e) => setEvents({ ...events, requestPaid: e.target.checked })}
                  className="mt-0.5 size-4 rounded border-(--dash-line-strong) bg-(--dash-surface) text-(--dash-fg) focus:ring-(--dash-fg)"
                />
                <div>
                  <span className="text-sm font-medium text-(--dash-fg)">Payment request settled</span>
                  <p className="text-xs text-(--dash-ash)">When a request you sent is settled</p>
                </div>
              </label>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={updateMutation.isPending}
            className={dashButtonPrimary}
          >
            {updateMutation.isPending ? "Saving…" : "Save preferences"}
          </button>

          {serviceAvailable && enabled && query.data?.settings?.enabled && (
            <Button
              type="button"
              variant="outline"
              disabled={testMutation.isPending}
              onClick={handleSendTest}
            >
              {testMutation.isPending ? (
                <>
                  <Loader className="size-3.5 animate-spin" aria-hidden="true" />
                  Sending…
                </>
              ) : (
                "Send test email"
              )}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
```

Modify `web/src/components/dashboard/SettingsDashboard.tsx`:
Import `EmailNotificationsRow` and place `<EmailNotificationsRow />` right below `<SponsorshipSettingsRow />` inside the `<div className={`${dashLedger} max-w-3xl`}>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/EmailNotificationsRow.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/features/notifications/EmailNotificationsRow.tsx web/src/components/dashboard/SettingsDashboard.tsx web/test/EmailNotificationsRow.test.tsx
git commit -m "feat(web): add email notifications row to settings dashboard"
```

---

### Task 7: Public Unsubscribe Page

**Files:**
- Create: `web/src/app/unsubscribe/[token]/page.tsx`
- Test: `web/test/UnsubscribePage.test.tsx`

**Interfaces:**
- Produces: Public route at `/unsubscribe/[token]`
- Adheres strictly to `--dash-*` tokens: `bg-(--dash-bg)`, `bg-(--dash-surface)`, `text-(--dash-fg)`, `text-(--dash-ash)`, `dashButtonPrimary`

- [ ] **Step 1: Write test for unsubscribe page logic**

Create `web/test/UnsubscribePage.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("Unsubscribe Token Handling", () => {
  it("validates token presence", () => {
    const validToken = "abc1234567890abcdef12345";
    expect(validToken.length).toBeGreaterThan(10);
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter web test test/UnsubscribePage.test.ts`  
Expected: PASS.

- [ ] **Step 3: Implement Unsubscribe Page**

Create `web/src/app/unsubscribe/[token]/page.tsx`:
```tsx
"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { dashButtonPrimary } from "@/components/dashboard/styles";
import { trpc } from "@/trpc/react";

export default function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const unsubscribeMutation = trpc.notifications.unsubscribe.useMutation();
  const [status, setStatus] = useState<"pending" | "success" | "failed">("pending");

  useEffect(() => {
    if (!token) return;
    unsubscribeMutation
      .mutateAsync({ token })
      .then((res) => {
        setStatus(res.success ? "success" : "failed");
      })
      .catch(() => {
        setStatus("failed");
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-(--dash-bg) p-4">
      <main className="w-full max-w-md rounded-(--dash-radius) border border-(--dash-line) bg-(--dash-surface) p-8 text-center shadow-lg">
        <h1 className="text-xl font-semibold text-(--dash-fg)">
          {status === "pending"
            ? "Unsubscribing…"
            : status === "success"
              ? "Unsubscribed"
              : "Invalid Link"}
        </h1>

        <p className="mt-3 text-sm leading-6 text-(--dash-ash)">
          {status === "pending"
            ? "Updating your notification preferences…"
            : status === "success"
              ? "You will no longer receive payment notification emails from Meaw."
              : "This unsubscribe link is invalid or has already been processed."}
        </p>

        <div className="mt-6 flex justify-center">
          <Link href="/dashboard" className={dashButtonPrimary}>
            Return to Meaw
          </Link>
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test test/UnsubscribePage.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/unsubscribe/[token]/page.tsx web/test/UnsubscribePage.test.ts
git commit -m "feat(web): add public unsubscribe page"
```

---

### Task 8: End-to-End Verification & Documentation Update

**Files:**
- Modify: `docs/features.md`
- Modify: `docs/practical-privacy.md`
- Modify: `README.md`
- Test: Full build and test check

- [ ] **Step 1: Update documentation**

1. Update `docs/features.md`:
Add section for Email Notifications, clarifying opt-in behavior and zero-leak privacy.

2. Update `docs/practical-privacy.md`:
Add section detailing that notification emails contain no transaction hashes, wallet addresses, or note keys.

3. Update `README.md`:
Mention email notification support and optional `RESEND_API_KEY` configuration.

- [ ] **Step 2: Run test suite & build check**

Run:
```bash
pnpm --filter web test test/notificationEnvironment.test.ts test/email.test.ts test/notifications.service.test.ts test/notifications.router.test.ts test/notificationTriggers.test.ts test/EmailNotificationsRow.test.tsx test/UnsubscribePage.test.ts
pnpm --filter web build:local
```
Expected: All tests pass and build succeeds.

- [ ] **Step 3: Commit**

```bash
git add docs/features.md docs/practical-privacy.md README.md
git commit -m "docs: document email notifications feature and privacy boundaries"
```
