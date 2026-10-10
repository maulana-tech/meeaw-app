# Minimal private invoices

Approved product scope: the hackathon roadmap and the in-chat invoice proposal,
followed by the user's instruction to continue implementation.

## Journey

A signed-in freelancer creates a numbered USDC/AUSD invoice with client name,
line items, notes and due date. Creation publishes an immutable invoice and a
random public link. A client connects a supported payer wallet or uses the
existing email checkout, pays the exact total, and sees verified Paid status.
The owner lists invoices and can void a pending invoice. Overdue is derived from
the due date, not a stored payment state.

## Contract

- USDC/AUSD only; an active configured pool with six decimals is required.
- At most 25 lines; integer quantity 1..10000; nonnegative decimal unit price
  with at most six fractional digits. Server calculates the total with BigInt,
  rejects zero and totals above uint64, and stores prices/total in base units.
- Number is normalized uppercase and unique per verified owner wallet. Client
  name, description and notes have length bounds. Due date must be a real ISO
  calendar date; overdue means the UTC calendar date is later than the due date.
- Create verifies the authenticated Privy user's linked wallet against the
  username registry. List/get/void filter by authenticated Privy user ID;
  cross-owner IDs return the same not-found result as missing IDs.
- Mongo records have unique token and commitment indexes. Public tokens contain
  192 bits of randomness. Invoice content cannot be edited after publication.
- Creation pins the recipient's public keys and pool, chooses a random field
  salt, computes the commitment and encrypts one canonical note to the viewing
  key. Payer uses these exact salt/envelope values with the existing deposit
  proof and signer flow. Existing payment links keep random per-payment notes.
- Confirmation requires the correct chain, successful receipt, correct pool,
  exact commitment and encrypted envelope, sufficient confirmations, canonical
  block hash and matching log metadata. Mirror rows only locate a candidate
  hash; they cannot authorize Paid. RPC failure keeps the prior state.
- Paid is an idempotent atomic transition. Paid invoices cannot be voided.
  Voiding closes checkout; it cannot cancel an already-broadcast transaction.
  A valid late payment changes Void to Paid while retaining voidedAt.
- Contracts are unchanged. Existing unique-commitment enforcement prevents two
  accepted deposits for the same invoice; UI/session guards also avoid retries
  after a confirmed transaction whose server confirmation is pending.
- Pool-indexer cron checks bounded batches of pending/void invoices using the
  mirror plus canonical receipt verification. checkedAt ordering rotates through
  unresolved records. A closed payer tab does not prevent reconciliation.

## Interface

Protected `/invoices` provides a real list, empty/loading/error states, a create
dialog, public-link copy/QR and Void. The public `/i/[token]` page shows invoice
lines/total/date, polling status and the existing payer checkout. Paid/Void have
no payment form. A pre-broadcast attempt marker and submitted receipt hash are
kept only in payer session storage to retry verification. An uncertain attempt
keeps checkout closed, even when its hash is unavailable. Only explicit fresh
pre-send rejection, unsigned release or a canonical reverted transaction bound
to this invoice can reopen checkout; an absent mirror row cannot do so.
Navigation accommodates seven mobile destinations with horizontal overflow and
minimum-sized touch targets. The public route is excluded from indexing and
uses no-referrer policy.

## Privacy and limits

Server and link holders can read invoice details and correlate its deposit.
Private spending/viewing secrets never reach the invoice server. The feature
preserves the existing pool's privacy properties; it does not claim complete
anonymity or bank cash-out. Pending invoices with retired pools disable checkout
and require a replacement invoice. Recipient key snapshots survive ordinary
key rotation through the existing retained keyring.

No PDF, email, fractional quantities, editable drafts, additional assets or new
contracts/circuits in this stage. No funded chain operation or live database
migration is required to implement and verify locally.

## Required evidence

Real isolated Mongo tests cover ownership, unique numbers, exact total, concurrent
Paid/Void, duplicate confirmations and late settlement. Encoded event receipts
exercise wrong pool/chain/commitment/envelope, reverted/unconfirmed/reorg cases.
Reconciliation works without payer notification and rotates bounded batches.
Client tests prove fixed-salt deposit, invoice status and no second payment after
confirmation failure. Source types, scoped format checks and local production
build must pass. Physical-device and funded-testnet results are reported only
when actually performed.
