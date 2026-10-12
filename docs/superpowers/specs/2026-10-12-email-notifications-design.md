# Email Notifications Design Specification

**Date:** 2026-10-12  
**Status:** Approved  
**Topic:** Email Notifications via Resend with Strict Token & Design System Adherence  

---

## 1. Context & Purpose

Meaw is a privacy-first payment and invoicing platform on Monad testnet. Users receive payments into shielded notes without publishing their financial history or balance.

This specification introduces **Email Notifications**, allowing users to receive non-intrusive email alerts when important financial actions occur (specifically invoice payments and payment requests), while upholding Meaw's core privacy guarantees:
1. **Opt-in by default:** Notifications are completely disabled until explicitly activated by the user.
2. **Zero privacy leaks in email copy:** Emails never disclose private note keys, viewing secrets, nullifiers, transaction hashes, wallet addresses (`0x...`), or balances.
3. **No vendor lock-in & graceful degradation:** Uses standard HTTP `fetch` to Resend API (`https://api.resend.com/emails`) without proprietary SDKs. When `RESEND_API_KEY` is omitted, the notification service degrades silently without causing operational or transaction errors.
4. **Strict design system adherence:** The UI exclusively utilizes the existing `--dash-*` token vocabulary and established component primitives (`dashCell`, `dashLedger`, `dashButtonPrimary`, `SettingsRow`, `Input`, `Badge`). No arbitrary or foreign styles are introduced.

---

## 2. Privacy Guarantees

| Event | Information Disclosed in Email | Information Withheld |
| :--- | :--- | :--- |
| **Invoice Paid** | Invoice Number (e.g. `INV-2026-001`), Total Amount & Token (e.g. `250 USDC`). *(Known publicly to both parties via invoice public view)* | Payer wallet address, recipient wallet address, transaction hash, note commitment, nullifiers. |
| **Request Received** | Requester handle (e.g. `@alice`). *(Generic alert: "You have a new payment request from @alice. Open Meaw to review and pay.")* | Requested amount, wallet addresses, note keys, payment details. |
| **Request Paid** | Addressee handle (e.g. `@bob`). *(Generic alert: "Your payment request to @bob has been settled.")* | Transaction hash, payer wallet, note commitment. |
| **Test Email** | Confirmation that the email address receives alerts correctly. | Any user metadata or account information. |

Each email contains:
- Minimalist Meaw branding (logo, clean layout matching Aileron typography).
- Primary call to action linking to the verified app (`APP_URL/dashboard` or `APP_URL/invoices`).
- Single-click unsubscribe link at the footer containing an unguessable 192-bit hex token (`APP_URL/unsubscribe/<token>`).

---

## 3. Data Model & Storage

### 3.1 Environment Variables (`env.server.ts` & `.env.example`)

Three server-side environment variables:
- `RESEND_API_KEY`: Optional string. When empty or unset, email delivery is skipped silently and the UI reflects that the email service is not configured.
- `EMAIL_FROM`: Optional string. Defaults to `Meaw <hello@meaw.xyz>`.
- `APP_URL`: Optional string. Base URL for action and unsubscribe links (defaults to `http://localhost:3000`).

### 3.2 MongoDB Collections & Migration

Migration: `web/migrations/20261012160000-notifications.js`

#### Collection 1: `notification_settings`
Stores user notification preferences keyed by their checksummed EVM address (`_id`):

```ts
export type NotificationSettingsDoc = {
  _id: string; // Checksummed EVM address of user's embedded wallet (matches UserDoc._id)
  privyUserId: string; // Privy identity DID
  email: string; // Recipient email address
  enabled: boolean; // Master toggle (default: false)
  events: {
    invoicePaid: boolean; // Alert when an invoice created by this user is paid (default: true)
    requestReceived: boolean; // Alert when someone sends a payment request to this user (default: true)
    requestPaid: boolean; // Alert when an outgoing payment request is settled (default: true)
  };
  unsubscribeToken: string; // Random 192-bit hex token for 1-click unsubscribe
  createdAt: Date;
  updatedAt: Date;
};
```

**Indexes:**
- `{ privyUserId: 1 }` (unique)
- `{ unsubscribeToken: 1 }` (unique)

#### Collection 2: `notification_logs`
Ensures idempotency across concurrent transactions, page reloads, and indexer reconciliation runs:

```ts
export type NotificationLogDoc = {
  _id: string; // Unique event key, e.g. "invoice-paid:<invoiceId>", "request-received:<requestId>"
  recipientEmail: string;
  eventType: "invoicePaid" | "requestReceived" | "requestPaid" | "test";
  sentAt: Date;
};
```

**Indexes:**
- `_id` is the primary key (automatically unique).
- `{ sentAt: 1 }` with 30-day TTL index (`expireAfterSeconds: 2592000`) for automatic log rotation.

---

## 4. Server-Side Architecture

### 4.1 Resend Client (`web/src/server/lib/email.ts`)
- Implements `sendEmail({ to, subject, html, text })` using native `fetch("https://api.resend.com/emails")`.
- Sets request timeout using `AbortController` (5000ms) to ensure slow external network requests never stall backend operations.
- Generates clean, accessible HTML and fallback plain-text messages.
- If `RESEND_API_KEY` is not present, logs an informative debug message and returns `{ ok: false, reason: "not_configured" }` without throwing.

### 4.2 Dispatcher Service (`web/src/server/modules/notifications/notifications.service.ts`)
- `dispatchNotification({ eventKey, recipientWallet, eventType, buildEmail })`:
  1. Checks if email service is configured. If not, returns immediately.
  2. Looks up `NotificationSettingsDoc` for `recipientWallet`.
  3. Validates that `enabled === true` and `events[eventType] === true`.
  4. Performs an atomic `insertOne` into `notification_logs` with `_id: eventKey`. If MongoDB returns duplicate key error (`E11000`), aborts dispatch (event was already sent).
  5. Asynchronously executes `sendEmail` with error handling (`.catch(console.error)`).

### 4.3 Triggers & Integration Points
1. **Invoice Paid:**
   - Hooked into `confirmInvoicePayment` and `checkInvoicePayment` in `invoices.service.ts`, as well as invoice reconciliation in `pool-indexer`.
   - Event key: `invoice-paid:<invoice._id.toString()>`.
2. **Request Received:**
   - Hooked into `createRequest` in `requests.service.ts` when the recipient is a registered username.
   - Event key: `request-received:<request._id.toString()>`.
3. **Request Settled:**
   - Hooked into `verifyRequestReceipt` in `requests.service.ts` when a request is marked paid.
   - Event key: `request-paid:<request._id.toString()>`.

### 4.4 tRPC Router (`notificationsRouter`)
Mounted on `server/root.ts`:
- `getSettings`: `protectedProcedure` -> returns current settings and boolean `serviceAvailable` (whether `RESEND_API_KEY` is present).
- `updateSettings`: `protectedProcedure` -> validates email format, updates toggles and email.
- `sendTest`: `protectedProcedure` -> sends an immediate verification email to the saved address, rate-limited to 3 tests per 10 minutes.
- `unsubscribe`: `publicProcedure` -> accepts `token: string`, marks `enabled = false` in `notification_settings`, rate-limited by IP.

---

## 5. UI & Design System Specifications

### 5.1 Settings Row (`EmailNotificationsRow.tsx`)
Rendered inside `<div className={`${dashLedger} max-w-3xl`}>` in `SettingsDashboard.tsx`:

- **Container:** `<SettingsRow title="Email notifications" description="..." aside={...}>`
  - Uses existing `dashCell` (`min-w-0 bg-(--dash-surface)`).
- **Badge (Aside):**
  - Not configured: `<Badge variant="outline" className="border-(--dash-line) text-(--dash-ash)">Service not configured</Badge>`
  - Active: `<Badge className="gap-1.5 border border-(--dash-line) bg-transparent text-(--dash-fg)"><span className="size-1.5 rounded-full bg-(--dash-accent)" />Active</Badge>`
  - Disabled: `<Badge variant="outline" className="border-(--dash-line) text-(--dash-ash)">Disabled</Badge>`
- **Email Input Field:**
  - Standard `<Input appearance="linen" type="email" />` with `<Label>` from `components/ui/`.
  - Automatically prefilled from Privy (`user?.email?.address` or `user?.google?.email`) if not yet stored in MongoDB.
  - Informative helper text in `text-xs text-(--dash-ash)`.
- **Event Checkboxes / Toggles:**
  - Styled list with borders using `border border-(--dash-line-solid) bg-(--dash-tint)`.
  - Checkboxes styled with standard accessible controls adhering to `--dash-fg` and `--dash-line-strong`.
  - 3 options:
    1. *Invoice settled:* "When a client pays an invoice you created"
    2. *Payment request received:* "When someone sends a payment request to you"
    3. *Payment request settled:* "When a request you sent is settled"
- **Buttons:**
  - Save: `<button type="submit" className={dashButtonPrimary}>Save preferences</button>`
  - Test: `<Button variant="outline" onClick={handleTest} disabled={!savedEmail || testing}>Send test email</Button>`
  - Feedback handled via `toast.success` and `toast.error` from `sonner`.

### 5.2 Unsubscribe Page (`web/src/app/unsubscribe/[token]/page.tsx`)
- Public page at `/unsubscribe/[token]`.
- Styled using `--dash-bg`, `--dash-surface`, `--dash-line`, and `--dash-fg`.
- Card container with `rounded-(--dash-radius)` and `border border-(--dash-line)`.
- Clean confirmation text: "You have been unsubscribed from Meaw payment notifications."
- Action button `<Link href="/dashboard" className={dashButtonPrimary}>Go to dashboard</Link>`.

---

## 6. Testing & Verification

1. **Unit Tests:**
   - `email.test.ts`: Validates payload formatting, HTML generation, timeout handling, and no-key bypass.
   - `notifications.service.test.ts`: Tests idempotency (duplicate event key prevention), disabled preferences check, and rate-limiting.
2. **tRPC Router Tests:**
   - `notifications.router.test.ts`: Verifies `getSettings`, `updateSettings`, `sendTest`, and `unsubscribe`.
3. **Integration Verification:**
   - Verify invoice payment dispatches single email and logs event key.
   - Verify closed-tab reconciliation by cron does not produce duplicate emails.
   - Verify unconfigured environment behaves smoothly without errors.
