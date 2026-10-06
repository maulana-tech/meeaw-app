# Send private USDC directly to @username

Date: 2026-10-06
Stage: approved in conversation; implemented locally with inline execution. Deployment and remote delivery remain separate.
Repository inspected on branch: `feature/username-payment-requests`.

## Intent and agreed scope

Complete the direct shielded-transfer capability already described in the README.
A signed-in Mawee user sends USDC from their private balance to another registered
username, without the recipient first creating a payment request.

The user approved a Send button on the balance card, modal input and confirmation,
an optional encrypted note, automatic consolidation of fragmented private balance,
reload-safe progress, and incoming/outgoing History integration. The first release
uses the active USDC pool and rejects self-transfers. This spec supplies technical
defaults for written review; it is not an expansion into new payment products.

Success: a sender with sufficient spendable balance in the active pool sends the
exact amount once, retains private change, and both participants can recover the
confirmed transfer amount and note after unlocking on another supported device.

## Current foundation and recommended approach

`web/src/lib/transfer.ts` exposes `sendTransfer`, but it has no application caller
and selects one input note large enough for the entire amount. Wiring this helper
to a modal alone would not deliver the approved consolidation and recovery flow.

Requests already provide funding selection, Merge/split proof construction,
participant-encrypted envelopes, signed submissions, durable relayer journaling,
receipt reconciliation, and scoped note recovery. The active dashboard uses
`DashboardShell`; `BalanceCard` currently offers Receive, Add funds, and Cash out.
`ActivityFeed` derives activity from private notes and is not a complete transfer
ledger: spending a note is not necessarily a cash-out or a business expense.

Use a dedicated transfers module and record lifecycle, reusing small common
funding, encryption, submission, and reconciliation primitives where appropriate.
Do not create artificial payment requests to represent sends. Keep request
authorization, states, and APIs intact. Extract shared primitives only where both
flows need them, with request regression checks.

Alternative: use the old one-note helper and client-only tracking. Rejected
because it loses cross-device metadata and cannot safely resume staged funding.

Existing Merge and transfer circuits/contracts are sufficient. No contract,
verifier, circuit, trusted-setup, or pool deployment change is planned. The flow
requires a manifest-selected active pool with the capabilities used by Requests;
legacy balances remain discoverable and withdrawal-only.

## User flow

1. Send beside Receive opens a modal matching the current dashboard appearance.
2. Enter registered username, positive USDC amount, and optional note.
3. Resolve the username from the canonical registry-backed lookup and display the
   normalized handle. Unknown usernames, self-transfer, missing recipient keys,
   unsupported pool, unhealthy scan, unavailable relay, and insufficient active
   balance produce actionable states. Unlock is required before preparing a send.
4. Review recipient, amount, and note before final confirmation. Re-resolve the
   recipient and check the selected pool/account before creating the signed
   transfer. If recipient keys changed since review, require a new review rather
   than silently replacing the recipient snapshot.
5. Show Preparing, Sending, and Confirmed. Confirmed means matching on-chain
   evidence at the pool's configured confirmation depth. Unknown broadcast
   outcomes remain pending and block retry as a new send.
6. The modal may close during processing. A dashboard pending-send notice offers
   reopening the operation; History also exposes its status. This must work after
   reload/login, using authenticated server records rather than plaintext local
   persistence. Preparation can require unlock and an explicit Continue action;
   submitted transactions reconcile without browser proof generation.
7. Confirmed completion refreshes private balance and activity. A failed operation
   explains whether it can be resumed or whether a fresh send is safe.

No new navigation destination is required. History provides the persistent list
and detail entry point. The pending-send notice must remain available even if the
account is locked; amount and note stay hidden until unlock.

## Input and recipient rules

- Accept a handle with or without a leading `@`; apply existing username rules.
- Parse USDC using the pool's token decimals and integer base units, never floats.
  Accept amounts from 1 base unit through `2^64 - 1`; reject excessive precision,
  exponent notation, negatives, zero, and overflow.
- Optional note: trim surrounding whitespace, maximum 200 Unicode code points,
  empty string permitted. Render as text, never HTML.
- Sender must own the authenticated registered wallet and match the local
  spending/viewing keys. Recipient snapshot contains username, wallet, note public
  key, and viewing public key. Reject the sender's own wallet or identity.
- All funding inputs and outputs use one pinned active pool scope. Never aggregate
  legacy or other-pool balances into the usable amount.
- Permit one nonterminal outgoing send per sender and pool, enforced on the server
  across devices. Incoming transfers do not block receiving additional payments.

## Encrypted transfer records and authorization

Use a separate MongoDB collection for immutable signed transfer intents plus
mutable operation state. Intent metadata includes version, random transfer ID,
pool scope, sender and recipient public-key snapshots, creation time, fixed
recipient commitment, two encrypted envelopes, and the sender's signature.

Each participant envelope contains the amount, optional note, recipient salt, and
bound immutable metadata. Use the existing padded-envelope construction with a
distinct transfer domain and participant roles, not the request signing domain.
Payload/envelope sizes stay fixed and bounded. Encrypt separately to sender and
recipient viewing keys. Check sender signature, AEAD/AAD bindings, public-key
snapshots, and reconstructed recipient commitment before using decrypted content.
Signing domains bind chain/pool and version; submissions additionally bind
transfer ID, operation ID, step, kind, proof, inputs, and encrypted outputs.

The server sees participants, timing, pool, commitments, operation status, and
transaction references. It does not receive plaintext amount, note, recipient
salt, viewing secrets, or spending secrets. Merge/proof artifacts and chain data
can still support amount/timing inference; this feature does not claim hidden
withdrawal amounts or complete relationship privacy from the application server.
Decrypted fields remain in browser memory and are not logged or cached on disk.

Both participants may list/get their records; only the sender may begin, submit,
or resume a transfer. Authenticate via the existing verified wallet mapping.
Nonparticipants receive a generic 404, and errors/logs never echo envelope
contents. Sender authority is checked on every state transition, not just intent
creation. Historical records use their stored key snapshot; current keys must not
be substituted to make an old envelope appear readable. Historical key rotation
and key-history recovery remain outside this feature.

Suggested API surface: create signed intent and begin operation, list participant
transfers with stable cursor pagination, get transfer/status, submit a funding or
payment step, and resume preparation. Status reads are database reads; the
scheduled reconciler performs chain recovery. Exact names belong in the plan.

## Funding, concurrency, and settlement

Persist the signed intent before spending any notes. Select fresh unspent notes
in the pinned scope using existing funding rules. Prefer a single covering note;
otherwise Merge selected owned notes until one covers the amount. Use the existing
split strategy when combining values would exceed the uint64 circuit bound.
After each confirmed preparatory step, refresh/recover its output before proving
the next step. Preparation outputs belong to the sender; the final output has the
fixed recipient commitment and exact amount, plus sender change.

Reserve input nullifiers in a shared spend-reservation mechanism used by sends,
request payments, and withdrawals. MongoDB's standalone configuration requires
single-document CAS/unique-key ownership and explicit compensating cleanup, not
assumed cross-collection transactions. Partial reservation failure releases only
this operation's safely unsubmitted claims. Request/withdraw submission paths
must honor these reservations; client button disabling alone is insufficient.
The immutable pool remains the final double-spend guard.

Serialize relayer nonce allocation through the existing durable journal. Persist
the authorized submission and signed transaction bytes before broadcast. Retry an
uncertain broadcast using the identical signed bytes; never create a new final
payment or re-sign under a different nonce merely because a receipt is missing.
Submission retries for the same operation/step/body are idempotent; changed bodies
after acceptance are conflicts. The fixed output commitment and existing pool
uniqueness guard also prevent two successful final transfers for one intent.

Verify tracked transaction calldata, pool/chain, successful receipt, expected Spend
inputs, exact output commitments/encrypted output bytes, and confirmation depth.
Unrelated deposits or arbitrary client hashes cannot confirm a transfer. Journal
and transfer-record writes may fail independently: reconciliation repeats them
idempotently after confirmed chain evidence.

Business states: Pending, Confirmed, Failed. Internal phases include preparing,
submitting, submitted, and needs reconciliation. Unknown outcomes are Pending.
Mark Failed only for a verified terminal failure, never a timeout. Preparatory
steps that succeeded remain valid private sender funds even if final payment
fails. Release reservations only after confirmed consumption or verified safe
termination; abandoned unsigned preparation claims require bounded expiration and
CAS-safe cleanup. Signed/broadcast or uncertain submissions never expire into
permission to spend again. There is no user cancellation after send confirmation
in this release; a stalled preparation can be continued or safely terminated by
the recovery lifecycle.

## Recovery and participant history

Server reconciliation runs alongside the existing scheduled request recovery and
uses the common relay journal. It never needs private keys. Browser resume checks
account identity/session after every account-sensitive async action and stops if
the user changes account or locks it. Never resume an operation under a different
identity or scope.

Encrypted intent payload includes the salt needed to reconstruct the recipient
note if output delivery is corrupted or missing. Participant recovery verifies the
signed intent, fixed commitment, matching confirmed transaction, and correct scoped
leaf before adding an owned note; it cannot fabricate receipt or spend evidence.
Persist encrypted sender-only recovery information for accepted preparatory/change
outputs before broadcast so staged consolidation can resume on another supported
device if those outputs cannot be decrypted from chain data. Extend the existing
note-recovery pattern rather than relying solely on the open modal's memory.

History merges confirmed transfer records with note-derived activity by pool and
commitment/leaf/transaction identity. Show sender Sent and recipient Received rows
with the actual transfer amount, counterparty handle, decrypted optional note,
status, and transaction reference. Pending/failed attempts are labeled attempts,
not income or completed expenses. Do not show Merge, preparatory split, zero-value
outputs, or change as new payments. Do not classify every spent note as Cashed out.
Preserve actual deposits, withdrawal history, request payments, receipt access,
and dashboard summaries. Use confirmation block time for completed transaction
ordering, with deterministic stable IDs for pagination and deduplication.

Locked or unreadable rows expose only permissible metadata/status and an Unlock or
unreadable state; never a fabricated zero amount. Received/Sent/Cashed out filters
must correspond to actual event semantics. CSV exports, if they include transfers,
use decrypted business rows with direction and correctly escaped user text, not
internal consolidation rows. Receipt generation retains its current meaning; this
feature adds neither public receipt verification nor a claim that a spent-note
disclosure alone proves who authorized a transfer.

## Boundaries and verification

Exclude payment requests generated as a send side effect, partial payment,
recurring transfers, group payments, attachments, multiple assets, bank off-ramp,
external notifications, recipient acceptance, key-rotation UI, and public receipt
verification. Existing Requests behavior must remain compatible.

Acceptance evidence required:

1. Two registered accounts send a positive amount with and without a note; both
   decrypt matching metadata after unlock and on a fresh supported browser profile.
2. Single-note and fragmented funding: 10 + 15 sends 20, recipient gets exactly 20,
   sender retains 5. Cover several merges, uint64-bound split, and legacy exclusion.
3. Real proofs against the existing pool verify the final transfer and prevent
   duplicate fixed outputs; final status requires matching confirmed chain evidence.
4. Repeated clicks, duplicate API submissions, two sender devices, and concurrent
   request/withdraw attempts cannot spend reserved inputs or complete a send twice.
5. Reload after a confirmed Merge, close modal during submission, broadcast
   timeout, relay restart, and DB failure after confirmation recover correctly.
   Fresh login discovers pending operations and can continue preparation after unlock.
6. Wrong participant, signature, envelope binding, pool, recipient keys, output,
   receipt, or account session fails safely without leaking plaintext.
7. Missing encrypted output delivery recovers only verified owned recipient and
   sender preparation/change notes using persisted encrypted recovery material.
8. History and balance contain no duplicated receipt, internal Merge income,
   change income, or falsely classified cash-out. Locked views hide amounts/notes.
9. Mobile/desktop modal, review/back, validation, unlock, keyboard/focus, progress,
   pending notice, and History details work in the active dashboard theme.
10. Focused transfer/funding/recovery/server tests, affected Requests/withdrawal
    regressions, typecheck, and build pass. Report local-chain evidence separately
    from real testnet/browser evidence; do not claim unperformed tests.

Implementation does not authorize production deployment, pool activation, remote
push, or merging. After written-spec approval, create an implementation plan and
agree its execution method before product changes.
