# Direct private transfers

Direct sends use the selected active eligible pool, participant-encrypted signed intent records,
and the existing transfer/Merge circuits. No new pool deployment is required.
Legacy pool balances remain withdrawal-only.

## User flow

Open **Send** on the private balance card, enter a registered username, an amount in that asset,
and optional note, then review and confirm. Notes are limited to 200 Unicode code
points. The sender and recipient can decrypt their own copy after unlocking.
Meaw combines fragmented notes without exposing note selection.

Closing the progress window does not cancel the payment. The dashboard's pending
transfer notice and History reopen it. A reload during preparation requires unlock
and **Continue transfer**; an already-submitted payment is checked by the server.
Only matching confirmed chain evidence produces **Payment confirmed**. Unknown
broadcast outcomes remain pending rather than becoming permission to pay again.

## Persistence and migration

New collections are `private_transfers`, `private_transfer_steps`, `spend_claims`, `spend_nullifiers`, and a
cache of public transaction evidence, `pool_activity_evidence`. Transfer records
embed their current operation/submission. Immutable accepted steps and confirmed
evidence live separately, uniquely keyed by operation and step, so thousands of
consolidation steps cannot grow one transfer document past MongoDB's size limit.
Participant recovery batches sender-only encrypted evidence; confirmed evidence
is cached in account-scoped browser memory. Recipient notes already discovered
from chain data need no step-evidence request. Incomplete batches retain their
cursor in browser memory so a retry continues after the completed pages.

From `web/`, run the existing migration workflow (`pnpm migrate:status`, then
`pnpm migrate:up`) in the explicitly selected environment. The new migrations are:

- `20261006100000-private-transfers.js`: participant pagination, unique commitment,
  one pending outgoing intent per sender and pool, and reconciliation indexes.
- `20261006110000-spend-reservations.js`: coordinator and scoped nullifier indexes.

Indexes are also ensured by the repository before transfer access. Rollback of the
new migrations removes their named indexes, never payment/operation records.
Do not remove uniqueness indexes while this feature is serving traffic.

## Reconciliation

The existing authenticated `/api/cron/request-payments` endpoint now runs bounded
relay, Requests, direct-transfer, and spend-reservation reconciliation. Preserve
its `Authorization: Bearer <CRON_SECRET>` configuration. The existing
`pnpm payments:local` worker invokes this endpoint and remains applicable.
Database status reads do not broadcast or generate proofs.

The common durable relay signing boundary coordinates spends for direct sends,
request payments, and ordinary cash-outs/transfers. A coordinator belongs to a
relayer wallet and pool; scoped nullifiers carry its fenced operation ownership.
This deliberately serializes relayed spending in that pool, consistent with the
existing relayer nonce coordinator. A separate transfer index enforces one pending
outgoing intent per user and pool across browser sessions.

Unsigned claims have a 60-second lease. Expiration triggers recovery, not TTL
deletion. Recovery first checks journal ownership and atomically abandons an
expired unsigned journal reservation. A delayed worker cannot persist or broadcast
its stale signature after that fence is revoked. Signed or uncertain sends stay
reserved until the journal confirms their identified transaction succeeded or
reverted. Failed status-projection writes are repaired idempotently.

Idle preparation with no accepted submission may safely end after 24 hours.
Already-confirmed Merge/split outputs remain sender-owned private funds and can be
recovered from encrypted step metadata. An accepted submission or unknown signed
transaction is never expired into a new send.

## Diagnosing a pending send

1. Check relay availability, cron execution, configured pool scope, and public
   indexing health without printing credentials or decrypted payloads.
2. Inspect the transfer's operation ID/step/phase and its relay operation key
   `transfer:<transfer-id>:<step>`.
3. If the journal has signed bytes, reconcile/rebroadcast those identical bytes.
   Do not delete reservations, replace the nonce, or create a second payment.
4. If the operation is preparing, unlock the original sender identity and Continue.
   It scans fresh scoped notes and recovers confirmed preparation outputs.
5. If chain evidence and participant projections disagree, keep it pending while
   checking tracked calldata, events, confirmation depth, and DB-write recovery.

## History and privacy

History distinguishes Received, Sent, and actual Cashed out transactions. Merge,
self-split, and sender change are not new income. A spent note alone does not
prove a cash-out. Missing public evidence remains unclassified, and complete
totals are withheld while classification is incomplete.

The public activity endpoint pages through all indexed pool transactions, not a
user's owned leaf list. It verifies transaction calldata against receipt events
and caches public evidence. RPC/indexer outages can delay classification without
changing note ownership or transfer confirmation. Historical evidence that is no
longer available from the RPC remains incomplete; restore a suitable historical
RPC/index source rather than inferring a transaction kind from spent status.

The server sees participants, pool, timing, operation status, public outputs and
transaction references. Amount, note, recipient salt, and sender-owned recovery
metadata are encrypted; private keys and decrypted history remain browser-memory
only. This does not hide public withdrawal amounts or prevent timing/amount
inference. Key rotation with historical private-key recovery is outside this flow.

## Verification boundaries

Focused tests use real cryptography, browser proving artifacts, and isolated local
MongoDB. Contract lifecycle tests use real proofs on the local Hardhat chain.
Injected receipt/transport tests exercise failures separately from real settlement.
An authenticated two-user browser/testnet demonstration is distinct evidence and
must not be inferred from unit tests, fixture screenshots, or local contract tests.
No production migration, deployment, activation, push, or merge is implied.

## Multi-asset eligibility

Each new send uses an active pool with `transferCapable`; an omitted flag inherits
`requestCapable` for older manifests. Pending lookups can filter by pool. Recovery
uses the original submitted scope even after the selected asset changes. Verify
each asset's token and Merge verifier before activation; see
[multi-asset evidence and behavior](multi-asset-payment-flows.md).
