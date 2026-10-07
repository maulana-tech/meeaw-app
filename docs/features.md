# Interface & Features

A quick tour of what you'll actually use day to day.

## Dashboard

Your home base. See your **private balance**, your personal payment link, and
your most recent activity at a glance. Only you can see this — it's decrypted
locally in your browser, not stored on a server for anyone to peek at.

## Payment Links

Share a link or QR code and get paid. Two flavors:

* **Simple link** (`mawee/pay/username`) — the payer chooses the amount. Great as
  your general "pay me" link.
* **Managed link** (`mawee/pay/username/your-slug`) — you set an asset, a fixed or
  open amount, and a description. The payer uses that asset even when the amount
  is open. Existing links keep USDC. Perfect for invoices and products.

Every link comes with a QR code for in-person or mobile payments.

## Direct private sends

Use **Send** on your private balance card to pay another registered `@username`
without waiting for a payment request. Enter an amount in the selected eligible asset and an optional private
note, review the recipient, then confirm. Mawee combines fragmented active-pool
balance automatically. The note is encrypted for both participants.

A pending send can be reopened from the dashboard or History after closing its
modal or reloading. History distinguishes Sent, Received, and actual Cashed out
transactions; internal consolidation and change do not count as payments.
See [direct-transfer operations](direct-transfer-operations.md) for recovery and
deployment prerequisites. Legacy balances remain withdrawal-only.

## Payment Requests

Ask a registered `@username` for a fixed amount in an eligible asset with an optional private
note. The request appears in the sender's **Sent** list and the recipient's
**Received** list. The recipient can pay it from their private balance, even
when that balance is split across multiple notes, or decline it; the requester
can cancel a pending request. Amounts and notes are encrypted for both users.
See the [payment-request operations runbook](request-payments-operations.md)
for deployment and recovery requirements.

## History

A private log of the payments you've received, readable only by you. Use it to
keep track of who paid, when, and how much — and to pull up a specific payment if
you ever need to prove it (see [disclosure](practical-privacy.md#traceability-on-your-terms)).

## Receipt verification

Download PDF and JSON for one payment from History. Anyone can open `/verify` and
check the JSON without signing in. Proof details stay in the browser; historical
pool reads distinguish chain-verified, invalid, and unavailable evidence. Older
unanchored receipts remain locally checkable. See [receipt verification](receipt-verification.md).

## Settings

Manage your account: your username keys, PIN, and account recovery. This is also
where re-keying lives if you ever need to rotate your keys.

{% hint style="info" %}
**Receiving needs nothing up front.** You don't need to hold any USDC or do any
setup to *receive* a payment — just your Mawee account. You only interact with the
chain when you decide to cash out.
{% endhint %}
