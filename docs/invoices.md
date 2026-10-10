# Invoices

Create a USDC or AUSD invoice from **Invoices → New invoice**. Add an invoice
number, client name, one or more lines, due date and optional notes. Quantities
are whole numbers; prices support six decimal places. The total is calculated
exactly. Invoice numbers are unique for your registered wallet.

Creation publishes the invoice immediately. Its amount, asset, recipient and
lines are immutable. Copy the link or show its QR to your client. The client
uses the existing browser-wallet or email checkout to fund a private note.
Balances on testnet are mock funds with no real value.

The dashboard lists invoices for the signed-in owner. Older invoices are
available through pagination. **Overdue** is derived after the due date ends
in UTC; an overdue invoice can still be paid.

## Payment status

**Pending** means no matching canonical payment has been verified yet. **Paid**
requires a successful transaction at the pinned pool, the exact invoice note
and encrypted payload, sufficient confirmations and a canonical block hash.
An unrelated tx hash or an indexer row alone cannot mark an invoice paid.

**Void invoice** closes checkout for a pending invoice and preserves its record.
It cannot cancel a transaction already submitted to the network. If such a
payment is later verified, the invoice becomes Paid and retains its void time.
Paid invoices cannot be voided. A replacement needs a new invoice number.

Closing the payer tab does not prevent verification: the existing pool-indexer
cron also reconciles bounded batches of invoices from public deposits and their
canonical receipts. It must be running for automatic closed-tab recovery.

## Uncertain transactions

Before broadcast, the payer app retains an attempt marker in session storage.
Direct-wallet hashes are saved before waiting for their receipt; a receipt hash
is also saved after gasless confirmation. These values contain no spending key.
If submission or receipt waiting has an uncertain outcome, checkout stays closed
and **Check payment status** verifies the existing payment. With no hash, the
server looks for the invoice commitment in the mirror and validates its receipt.
There is no automatic new payment or background transaction replay.

An empty mirror is not proof that no transaction exists: unresolved attempts
remain blocked. Keep the tab/session state and let the indexer catch up; seek
operator help for a persistently uncertain attempt. Do not clear browser state
to bypass that guard. Rejected wallet requests, canonical reverted receipts bound
to this invoice, explicit fresh pre-send rejection and unsigned-release signals
can reopen checkout. If session storage is unavailable, payment
stops before broadcast and asks for another browser.

## Privacy

The server and anyone holding the public link can read invoice details and
correlate its deposit with the invoice. The link is a sharing capability: do not
post it publicly unless those details may be public. Public pages use no-referrer
and no-index policies; those policies do not authenticate a link holder.

The server generates a salt and encrypted note from public receiving keys. It
never receives private spending or viewing keys. Invoice key/pool snapshots are
pinned, and the existing retained keyring handles ordinary key rotation. Retired
or removed pools disable checkout; create a replacement invoice in an eligible
pool. The feature retains the existing pool's privacy properties and does not
claim complete anonymity or bank cash-out.

## Operations

Migration `20261010150000-invoices.js` creates invoice uniqueness/owner/recovery
indexes and a scoped commitment lookup on the deposits mirror. Creation also
ensures invoice indexes before accepting a record. Migration down removes its
indexes and preserves financial records.

Use the existing migration and pool-indexer commands:

```powershell
pnpm --filter web migrate:up
pnpm --filter web indexer:local
```

The indexer uses the configured `CRON_SECRET` to call `/api/cron/pool-indexer`.
Invoice reconciliation checks at most 20 records, four concurrently, and rotates
unmatched records with checkedAt ordering. RPC failures retain existing status.
The public status-check endpoint uses the mirror as a locator and revalidates
canonical evidence; it cannot move funds.

No PDF, email, fractional quantities, editable drafts or additional assets are
included in this release. Physical-device checkout and funded testnet settlement
must be tested separately from local component, Mongo and RPC-boundary tests.
