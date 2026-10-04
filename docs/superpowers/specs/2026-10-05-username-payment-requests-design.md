# Payment requests to @username

Date: 2026-10-05
Branch: `feature/username-payment-requests`
Base: `origin/monad-migration`, commit `d2ba32cd6a68e084735b5e477856b10deb35cec1`
Stage: design for user review; implementation and deployment have not started.

## Intent and agreed decisions

Support personal payments and simple business invoices between Mawee users. A user
requests a fixed USDC amount from another registered username and includes an
optional note. The addressee pays from their private Mawee balance.

Success means a payer whose available notes in the request's pool total at least
the requested amount can complete payment without selecting individual notes.
The requester receives the full amount once. Amounts and notes remain encrypted
to the two participants.

The user approved these decisions in conversation:

- Personal and business use, starting with username, amount, and optional note.
- Payment from private balance, including combining multiple input notes.
- Amount and note encrypted; the server may know the participants and status.
- Dashboard Requests tile; a dedicated Requests page with Received and Sent tabs.
- Creation and payment confirmation use modals. No sidebar is added.
- Fixed amount, full payment, no partial payments.
- Public statuses Pending, Paid, Declined, and Cancelled.
- Only the addressee may pay or decline; only the requester may cancel.
- No editing after creation; cancel and create a replacement.
- No expiry, due date, reminder, or external notification in this release.
- Prevent repeated clicks; show Paid only after chain confirmation.
- Consolidate private notes in stages, then pay in one final transfer.

The sections below specify the technical design and defaults for written review.

## Existing implementation

`DashboardShell` provides top navigation. `DashboardSidebar` exists but is not
used by the active dashboard layout. The new feature follows the active shell.

`transfer.circom` and `MaweePool.transfer` spend one input note into recipient
and change notes. `sendTransfer` selects one note large enough to cover the
amount. There is no consolidation circuit or Requests module.

The pool is not upgradeable and its verifier addresses are immutable. Adding
consolidation requires a newly deployed pool. Existing Deposit and Spend events
already support browser discovery of encrypted output notes.

Privy authentication, recoverable viewing keys, username resolution, MongoDB,
the relayer, and public pool indexing are existing building blocks. Request
routes use authenticated participant ownership, not payment links' public
manage-token permissions.

## Product flow

The dashboard shows a Requests tile with the count of pending received requests.
It opens `/requests`. Received is the default tab; Sent contains requests created
by the user. Each row shows the other participant, decrypted amount and note,
status, and the relevant action. Lists are paginated, 20 records at a time,
newest first. Pending counts are independent of pagination.

The existing Receive dialog enables Request from a username. It and New request
on the Requests page open the same creation modal. The form asks for a registered
username, a positive amount, and a note of at most 200 characters. Self-requests
are rejected. A successfully created request opens Sent and displays confirmation.

Review opens payment confirmation with requester, amount, note, available private
balance in the request's pool, and projected balance after payment. Pay is
disabled when that balance is insufficient. No automatic top-up, bank payment,
or public-wallet fallback is included.

After Pay, show Preparing payment, Sending payment, and Payment confirmed.
Preparation may involve several consolidation transactions. Keep a visible
progress surface on the page if the modal closes. Refreshing resumes from
persisted operation metadata and a fresh scan; it never blindly resends payment.

Decline and Cancel require a brief confirmation. Loading, no requests, locked
account, unsupported pool, stale indexing, unavailable relayer, and decrypt errors
have explicit UI states. A locked account may show counts, but cannot show amounts
or notes until unlocked. An unreadable request cannot be paid.

## Request records, privacy, and integrity

Create a `payment_requests` collection, separate from payment links. A record
contains an opaque random request ID, schema version, chain ID, pool address,
requester and addressee wallet identities and usernames, public-key snapshots,
two encrypted payload envelopes, a recipient output commitment, requester
signature, status, timestamps, revision, and the current payment operation ID.

The browser generates a fresh random note salt and computes the final recipient
commitment from amount, requester note public key, and salt. Both encrypted
envelopes contain the same amount in token base units, note, salt, request ID,
chain/pool scope, participant identities, and key snapshots. Each envelope uses
independent ephemeral keys and nonces and is decryptable by one participant's
viewing key. Use a request-specific encryption domain, not the fixed 48-byte
note ciphertext format. Authenticate version, request ID, chain/pool, participant
identities, and output commitment as associated data.

The requester signs the immutable record's canonical digest using their
registered wallet. The server checks that wallet belongs to the authenticated
requester and owns the username. Both clients verify the signature and their
decrypted payload's scope, identities, amount limits, and computed commitment
before displaying payment controls. This prevents server-side envelope swapping
or a client paying a payload whose amount differs from its settlement commitment.

Do not put plaintext amount, note, salt, or decrypted payloads in MongoDB, logs,
analytics, browser persistent storage, or error messages. Private keys and
decrypted request data remain in page memory. Explicitly pad encrypted payloads
to a fixed envelope capacity for the bounded note length so text length is not
directly exposed. Return generic decrypt failures without logging payloads.

The server sees participants, status, timestamps, envelopes, and the expected
output commitment. Matching that commitment to a confirmed pool event lets the
server associate this request with its final recipient output. This association
is a deliberate limitation: encryption hides amounts and notes, not relationship
metadata or this settlement correlation from Mawee. Request identities and
plaintext never appear in public indexer entities or chain events.

A key snapshot is immutable. If a participant's locally recovered keys no longer
match the snapshot, show that payment cannot proceed and offer cancellation and
replacement where authorized. Key rotation with historical key recovery is a
separate feature; do not silently substitute new keys.

## API and authorization

Add a `requests` server module and router with create, listReceived, listSent,
pendingCount, get, decline, cancel, beginPayment, submitConsolidation,
submitPayment, and paymentStatus operations. All are protected procedures.

Resolve the caller's wallet through the existing verified Privy mapping and check
it against immutable participant identities. Never trust a submitted username
as evidence of ownership. Nonparticipants receive a generic not-found response.
Decline and cancellation are conditional updates against Pending plus the record
revision and absence of an active payment reservation.

Create is idempotent by authenticated requester plus client-generated request ID.
Identical retries return the existing record; changed immutable content conflicts.
Bound request envelope sizes, use cursor pagination, and rate-limit creation
(20 requests per user per 10 minutes), payment operations (10 starts per user per
10 minutes), and participant queries (120 per user per minute).

Use indexes for each participant plus created time and status. Uniquely index
chain/pool/output commitment and payment-operation idempotency keys. IDs and
request records are private even though username lookup is already public.

## Private note consolidation

Add a dedicated two-input, one-output Merge circuit. It proves ownership of two
distinct input notes under the same owner secret, membership in the same known
Merkle root, both correct nullifiers, and an output commitment owned by that same
secret. The output amount equals the exact sum of the two input amounts.
Range-constrain input and output amounts and reject sums above the existing
uint64 amount range. Distinct input indices and nullifiers are mandatory.

Add a merge verifier and `MaweePool.merge`. Public signals are root, nullifier A,
nullifier B, and output commitment. Check root, field elements, pause state,
distinct/unspent nullifiers, and proof. Atomically spend both inputs and insert
the encrypted output. Emit the existing Deposit and two Spend events.

If an existing single note covers payment, use it immediately. Otherwise select
unspent positive notes in descending amount order and merge the running combined
note with the next selected note until one note covers the amount. Rescan after
each confirmed merge and validate the newly discovered output before continuing.
Zero-valued transfer change notes are never selected as funding inputs.

Never merge notes across pools. Preparation has no arbitrary note-count cap:
it may take multiple transactions, while each proof remains a fixed two-input
operation. Users see progress, not internal note selection. If interrupted,
confirmed consolidation outputs remain recoverable through ordinary note scanning.

Fresh output salts are generated before broadcast; encrypted output metadata is
durably stored in the operation before sending. Existing note encryption and
Deposit-event recovery continue to work. Failure cannot remove funds from the
pool or send partial payment to the requester.

## Settlement and duplicate-payment prevention

The final transfer uses the requester's fixed commitment, exact requested amount,
and salt from the verified encrypted payload. Its second output returns change
to the payer. The server validates the recipient output commitment against the
immutable request record without needing to decrypt the amount.

The new pool tracks inserted commitments and rejects duplicate insertion on all
entry points. Because one request has one immutable recipient commitment, even
competing valid transfers using different inputs cannot both pay that request's
output. Reverts roll back input spending and output insertion together. This
new-pool invariant requires adversarial contract tests; it is not a UI-only lock.

Existing transfer proofs bind output commitments but not encrypted note bytes.
For request payments, validate that the recipient note ciphertext decrypts to
the expected amount and salt in the payer browser and sign the complete payment
submission, including ciphertext hashes. The authenticated request relay checks
the payer signature over that submission and forwards those exact bytes. The
requester can also reconstruct the payment from the immutable encrypted request
salt and verified commitment if note delivery fails. Request-aware discovery
must attach that reconstructed owned note to its verified leaf and run ordinary
nullifier/spent checks before making its amount spendable. Merge ciphertext delivery
uses the same signed-submission integrity check for the merged output.

Confirm Paid only from a successful receipt from the configured chain/pool
for the request's authenticated, tracked final transfer, with matching transaction
calldata, input Spend event, and expected recipient Deposit commitment. A direct
deposit or unrelated receipt is not a request-payment confirmation. Never accept an arbitrary hash,
a client assertion, or a merely broadcast transaction as evidence of payment.
Use the pool's configured confirmation requirement, defaulting to one receipt
confirmation on testnet. Reconcile submitted operations after server restarts
and when either participant reads the request.

Cancellation and decline govern acceptance through the Mawee request API. They
are not on-chain revocation of somebody's ability to send an unsolicited note.
They are blocked while payment is reserved or broadcast. An unsolicited transfer
after a terminal cancellation is ordinary received activity, not a reopened
request. A receipt for an already authorized in-flight request is reconciled
before allowing any conflicting terminal transition.

## Durable payment operations and failure recovery

Persist payment operations with preparing, submitting, submitted, confirmed,
failed, and needsReconciliation phases. These are execution phases; request
business status remains Pending until confirmed or explicitly terminated.

beginPayment atomically reserves a Pending request for its authenticated
addressee. Only one active operation per request is permitted. A preparation
reservation expires after 10 minutes of inactivity if no transaction could
have been broadcast; confirmed merge progress is retained. Starting a new attempt
requires a fresh note scan and can reuse the consolidated balance.

For each merge or final transfer, persist the signed transaction, deterministic
transaction hash, nonce, chain/pool, expected outputs, and phase before broadcast.
Use a durable relayer nonce reservation rather than relying solely on the existing
process-local queue. Serialize these sends with other transactions from the same
relayer wallet. Restart retries rebroadcast the identical signed transaction
instead of creating a new spend. Never store note secrets in operation records.

A broadcast timeout or missing receipt enters needsReconciliation and blocks a
new final payment, decline, and cancellation. Poll or rebroadcast the same signed
transaction. Release the reservation only on confirmed success, an explicit
revert, or verified pre-broadcast failure. Do not treat a missing receipt, elapsed
lease, or HTTP timeout as proof that payment failed.

If the chain confirmed but the database update failed, reconciliation transitions
the request to Paid once and restores the receipt reference. If a proof root has
expired or an input was spent elsewhere before submission, rescan and retry
preparation. Do not reuse an old proof for new inputs.

Gasless request payment requires the configured relayer. If it is unavailable,
show a retryable availability message before reserving or merging funds.

## Pool deployment and legacy balances

Build new merge artifacts and verifier alongside existing deposit, withdrawal,
and transfer artifacts. Preserve existing circuit artifact compatibility and
track artifact hashes. The merge circuit may require a larger powers-of-tau
capacity; determine that from its compiled constraint count, not the existing
script's hardcoded capacity. Testnet setup remains explicitly developmental.

Support an explicit pool manifest with one active request-capable pool and
optional legacy pools. Keep legacy balance/history discovery and withdrawal
available under each pool's chain/address/deploy-block scope. Separate mirrored
leaves and nullifiers by pool; changing the active address must not destroy the
legacy mirror. Legacy pools are withdrawal-only in this feature.

Requests and merge operations target the active request-capable pool. Dashboard
and payment confirmation distinguish available active-pool balance from legacy
balances so a combined display cannot falsely promise spendability. There is no
automatic transfer of legacy balances. A user may explicitly withdraw and
redeposit; that route is public and has different privacy properties, so it must
be explained before use.

Preparing deployment scripts, migration support, and a runbook belongs to this
implementation. Deploying contracts, changing live environment variables,
resetting pool data, moving funds, or pushing a branch is a separate operational
action and is not authorized by this design review.

## Component boundaries and affected surfaces

- `requestCrypto`: immutable payload encoding, bounded padded envelopes,
  signatures, local decryption, and payload/commitment consistency.
- `requests` server module: participant authorization, encrypted records,
  state transitions, pagination, counts, and reservations.
- `requestPayments`: note selection, merge orchestration, final transfer,
  signed submissions, and resume behavior.
- Durable relayer operation store: nonce reservations, signed transaction
  persistence, broadcast, receipt reconciliation, and idempotency.
- New Merge circuit/verifier and pool commitment uniqueness invariant.
- Requests page, shared creation/confirmation dialogs, dashboard tile,
  Receive dialog entry, and active-shell labels and auth route protection.
- Pool manifest and scoped mirrors for legacy discovery/withdrawal and new
  active-pool indexing. Envio schema/handlers and fallback MongoDB indexer
  must both understand merge Spend events and pool scope.

Do not implement independent KYC, key-rotation UI, off-ramp, stablecoin support,
reminders, or general transfer UI as part of this feature.

## Verification and acceptance criteria

1. Two signed-in users create, decrypt, list, and pay a real request against a
   local test chain; both see Paid only after the matching confirmed receipt.
2. 10 + 15 USDC pays a 20 USDC request, delivering exactly 20 and retaining 5.
   Test larger fragmented balances requiring several merges, including reload
   after a confirmed merge.
3. Circuit and real-proof contract tests cover wrong owner, wrong root/path,
   duplicate input, incorrect nullifier, altered outputs, overflow, reused
   nullifier, duplicate recipient commitment, pause, and tree capacity.
4. Two valid final proofs from separate notes targeting the same request output
   allow at most one payment, with the rejected transaction preserving its funds.
5. Only the two participants decrypt envelopes; tampered signatures, envelopes,
   metadata, amounts, keys, and pool scope cannot enable payment. Plaintext is
   absent from persistent request/operation records and logs.
6. Authorization tests cover impersonation, self-request, nonparticipants,
   terminal mutations, create retries, reservations, and cancel/pay races.
7. Recovery tests cover uncertain broadcast, restart after signing, receipt
   followed by database failure, nonce concurrency, and indexer lag.
8. UI tests cover locked accounts, modal keyboard focus, fixed-amount review,
   insufficient active balance, statuses, retry/recovery, badge counts,
   pagination, and responsive mobile layout. Browser smoke tests use real
   implementations; mocked UI evidence is reported separately.
9. Legacy notes remain discoverable and withdrawable after a new active pool is
   configured, and they are excluded from request payment eligibility.
10. Run relevant web tests, lint/build, circuit proof checks, and contract tests.
    Report local-chain and testnet evidence separately. Do not claim testnet
    deployment or production readiness from a local test pass.

## Review handoff

The interactive preview established page and modal placement using example data.
It does not demonstrate encryption, consolidation, or blockchain settlement.
This written design needs user review before an implementation plan is written.
The implementation plan should be ordered around cryptographic/contract and
recovery invariants before UI integration, with explicit deployment boundaries.
