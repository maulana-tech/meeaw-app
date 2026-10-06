# Complete multi-asset Send, Requests, and managed links

Date: 2026-10-06
Stage: written spec approved in conversation; implementation plan awaiting review.
Inspected base: `origin/monad-migration`, `ac319b4`.

## Intent and approved direction

Complete the existing multi-asset product rather than introducing new payment
products. The dashboard, payer checkout, and cash-out already have pools for
USDC, AUSD, USDT0, and MUSD. Send, Requests, and managed-link creation still assume
USDC or the primary pool in several places.

The user approved this order: Send first, Requests second, managed links third.
Send follows the asset selected on the balance card. Each operation locks its
asset and pool at review/confirmation, never combines balances across assets,
and requires review again if selection changes. Amount labels, progress, and
History must match the asset actually transacted. Transfer capability must be
separate from request capability, preserving old configuration behavior.

Success: selecting AUSD and confirming a 20 AUSD send funds it only from the
active AUSD pool, delivers exactly 20 AUSD, and produces AUSD-labelled participant
history. The same asset binding subsequently applies to requests and managed
payment links. Existing USDC records, URLs, and encrypted signatures remain valid.

## Current evidence

- `useSelectedPool` remembers the dashboard asset and resolves its active pool.
- `PoolDescriptor` already includes asset, token, decimals, scope, and role.
- `SendTransferDialog` and `createTransfer` still resolve `requestPool()`.
  Transfer crypto/proof builders require `requestCapable` even for direct sends.
- The manifest allows several active pools but only one request-capable pool.
  Current AUSD/USDT0/MUSD entries are not request-capable.
- Deployment builds the same `MaweePool` with a Merge verifier for the new assets.
  Capability activation must nevertheless verify the configured contracts; an
  asset label alone is not evidence of contract compatibility.
- Request signatures/envelopes already bind their pool scope. The current wire
  contract has no independently mutable asset field.
- Payment-link documents and APIs store amount/description but no asset. Their
  amount conversion uses app-wide USDC decimals. Fixed checkout implicitly uses
  the first active pool, and variable-amount checkout currently offers selection.

## Shared asset and capability contract

Only the four existing `AssetSymbol` values are in scope. UI labels use `ASSETS`:
USDC, AUSD, USDT for internal USDT0, and mUSD for internal MUSD. MON, WMON, swaps,
bridges, and additional decimal regimes are excluded.

For a transfer or request, the signed scope selects one immutable on-chain pool.
Resolve the asset, token, decimals, depth, and confirmation requirement from that
scope; never infer them from the user's current selection or list ordering.
Historical records continue resolving through the manifest's retained pool entry.
Do not remap a configured pool address to another token/asset to satisfy a record.
User-facing code formats with the resolved pool's decimals and label. This work
does not relax the manifest's current requirement that all configured pools use
the existing application decimals.

Add `transferCapable` as a backward-compatible optional manifest input and a
normalized descriptor capability. Missing values inherit `requestCapable`, so
old USDC request-enabled manifests continue supporting Send; omission does not
silently enable older non-USDC or legacy pools. Legacy pools cannot advertise
transfer/request capability and remain withdrawal-only for new work.

Before enabling each non-USDC pool, verify the manifest token identity, chain,
ABI compatibility, and nonzero compatible Merge verifier. Record public evidence
for activation. Deployment candidates and public manifest guidance may advertise
the verified capabilities; do not deploy contracts or rewrite credentials merely
to enable a UI control. If verification is unavailable, leave that asset disabled
with an explanation rather than guessing. Already-authorized signed submissions
in a now-legacy pool remain reconcilable using their original scope and bytes.

Stage 1 does not enable Requests on non-USDC pools. Stage 2 relaxes the one
request-capable-pool restriction to one active pool per asset and enables only
verified compatible pools. Replace implicit-primary lookup with explicit
asset/scope lookup at new-operation boundaries; preserve the no-argument primary
helper for old callers until all relevant paths are migrated.

## Stage 1: Send follows the selected asset

The balance card's Send action passes the selected pool into the modal. There is
one asset choice: the existing dashboard selector. The input form, balance check,
review, encrypted intent creation, proof building, API authorization, and final
receipt verification use the same captured scope.

Review shows recipient, exact amount, asset label, and optional encrypted note.
If the dashboard selection, wallet identity, unlock session, or active pool for
that asset changes before confirmation, invalidate review and discard stale async
results. The user must review again. Once accepted, the operation stays pinned;
switching the dashboard asset cannot change, cancel, or redirect it.

Use `transferCapable` for new direct-send eligibility throughout browser/server
code, including proof construction. Validate active role and configured token
identity; no fallback to USDC when the selected pool cannot send. Shared funding
selection, Merge/split recovery, signed-submission domains, and nullifier ownership
remain scoped. Keep version-1 signatures/envelopes unchanged: asset is already
bound through the signed chain/pool domain and metadata scope.

One nonterminal outgoing send per sender/pool remains the concurrency rule.
Pending lookup gains an optional pool filter for the selected dashboard; old
unfiltered callers retain their existing shape. A pending send in AUSD must not
block opening a USDC form merely because it is the first returned row. History
lists all applicable records and can reopen each pending send in its original
asset. The common relayer still owns cross-operation nonce coordination.

Progress, detail, errors, insufficient-balance guidance, transaction links, and
History labels derive from the record's pool. Recovery retains that pool even if
another asset is selected after reload. Receipt/export formatting must not label
an AUSD payment USDC. Where a public disclosure format needs asset metadata, add
backward-compatible optional asset/decimal fields, defaulting old bundles to
USDC, without changing their commitment verification semantics.

## Stage 2: Requests choose and pay one asset

Creating a request captures an eligible asset/pool, initially the dashboard's
selection. The standalone Requests entry uses the same selection mechanism and
shows the chosen asset clearly; it must permit choosing another eligible asset
before creation. Avoid an additional conflicting asset choice in a dashboard
modal that already has a supplied selection.

Username, fixed full amount, optional encrypted note, participant authorization,
Pending/Paid/Declined/Cancelled, cancellation/decline rules, and full-payment-only
behavior remain unchanged. A request's asset cannot be edited after creation.
The receiving user pays from the request's pinned pool, regardless of their
current dashboard selection. Review shows available balance for that pool and
does not substitute another stablecoin even if the user has sufficient total
value across all assets.

Request signatures/envelopes already bind scope and need no breaking version
bump or re-encryption. Existing documents remain USDC through their original
scope. Browser/server payment-start, consolidation, submission, recovery, and
settlement checks must stop assuming the primary request pool. Count/list/status
remain participant-only; amounts and notes never become plaintext in logs,
database projections, or query-cache keys. Paginated lists identify each asset.

Every Merge/input/output belongs to the request's pool. Legacy request behavior
remains consistent: new payment preparation is refused when no longer supported,
while previously accepted broadcasts reconcile without re-signing or relocation.

## Stage 3: Managed payment links bind an asset

Managed-link creation selects a supported asset, initially following the dashboard
selection when opened from Receive; the standalone Links editor provides the same
explicit choice. Persist the asset symbol and token-decimal snapshot alongside
integer base-unit amount and existing management fields. A missing asset on an
old document means USDC; a missing decimal snapshot uses its established USDC
precision. Do not rescale old amounts during this feature or repeat the previous
10x-decimal migration. Optional amounts remain optional, and units convert exactly
once at the server creation/update boundary.

Keep owner/slug URL uniqueness and current management-token authorization. Asset
is immutable after creation, including when the amount is unspecified. Editing
amount/description keeps that asset and precision; changing asset requires a new
link, with archive/delete semantics unchanged.

Resolve the active payment-enabled pool for the link's asset at checkout. Links
bind an asset rather than permanently pinning a deployment address, allowing pool
rotation without changing the currency owed. The payment itself captures and
signs one explicit pool/asset/token/precision snapshot. If that active pool changes
after review, require refresh/review instead of silently routing elsewhere.

A managed link never lets the payer switch currency, whether its amount is fixed
or open. A general `/pay/<username>` link keeps the current payer asset choice.
No stablecoin conversion is offered. Labels and QR/link previews show the managed
asset; balance, permit/approval, mint-test-token action, payment authorization,
deposit proof, relay input, and output note all use that pool's token.

Unavailable asset/pool yields a clear unavailable state; never fall back to USDC.
Old links preserve URLs and management capabilities. Reusable/open-amount link
status semantics are not redesigned; this feature does not claim new invoice
settlement or receipt-verification guarantees for the link database.

## History, summaries, and privacy

Account-wide history may contain multiple currencies. Every row, transfer detail,
request, disclosure, and CSV export identifies the asset and uses its decimals.
Do not combine nominal amounts from different stablecoins into one USD total or
assume a live 1:1 exchange rate. Dashboard/History asset filters and summaries
aggregate only the selected asset; switching filters does not alter records.

Pool scope remains part of all note/leaf/transaction identities. Two pools with
leaf 0 are distinct. Sender change, Merge, and preparatory split remain internal;
spent status alone is not a cash-out. Pending attempts do not become income.
Locked/unreadable content keeps amount/note hidden and is never displayed as zero.
This extension does not expand the privacy guarantee: participants/pool/timing
and status remain visible to the application server, and withdrawals remain
public on-chain.

## Compatibility and migration

- Old public manifests: derive transfer capability conservatively from existing
  request capability; unknown/legacy pools never gain write permission implicitly.
- Old direct transfers/requests: preserve signatures, envelopes, scope, commitment,
  operation IDs, and persisted signed transaction bytes. No record re-encryption.
- Old managed links: USDC defaults on read and an additive, repeatable migration
  if backfill is required. Amounts and management-token hashes remain untouched.
- New link inputs may omit asset for backward compatibility, defaulting to USDC.
  New UI always supplies an explicit asset. Reject unsupported symbols/precision.
- Changes to manifest/deployment candidates preserve other active assets and
  retain old scopes for read/recovery/withdrawal; no credential changes.
- No contract/circuit/verifier modification is planned. If actual deployed pool
  compatibility disproves that assumption, stop and revise deployment scope.

## Acceptance and validation

1. Select each supported asset; Send review, funding, confirmation, participant
   history, and change use only that asset's verified active pool.
2. Fragmented AUSD notes 10 + 15 send 20 AUSD and retain 5 AUSD; USDC notes cannot
   contribute. Equal leaf indexes and identical nominal amounts in separate pools
   do not cause reservations, recovery, or rows to collide.
3. Switching asset/account or locking during lookup/proving invalidates stale
   results. Changing selection after acceptance leaves the original operation
   intact. Pending operations for different pools reopen correctly after reload.
4. Existing signed USDC requests/transfers still decrypt and reconcile. Invalid
   scope, asset capability, signature, pool, token, output, or receipt is rejected.
5. Create a request in each eligible asset; a payer with insufficient requested
   asset but sufficient other assets cannot pay it. Matching confirmed chain
   evidence alone sets Paid, with existing decline/cancel/concurrency semantics.
6. Managed fixed/open-amount links bind one asset; payer cannot switch it. General
   username links retain choice. Labels, minting, balances, permits, and deposit
   proofs target the correct token. Edits do not alter currency.
7. Old links remain USDC with unchanged amounts/URLs/manage tokens; conversion is
   exact once. Cover zero, excessive precision, uint64 bounds, and 10x regressions.
8. Histories/exports identify currency and never sum assets as USD. Verify Merge/
   change exclusion, actual withdrawals, locked content, and stale-index states.
9. Focused tests for selection/capability, crypto/submission, server authorization,
   recovery, links conversion/management, and UI; affected old-flow regressions,
   typecheck, scoped lint, and the supported local production build.
10. Real proofs/local-chain evidence for multiple token pools and exact asset
    settlement. Clearly distinguish injected boundary tests and isolated UI
    fixtures from authenticated two-user browser/testnet evidence.

## Delivery process

Review this written spec before producing an implementation plan. Preserve the
three stage boundaries in that plan so each has a testable end-to-end deliverable.
The existing preference is inline execution; preserve it at the plan handoff
unless the user changes it, and obtain review of the written plan before code.
Do not commit/push/create a PR, deploy, or activate live capabilities without
authorization for this new work. Prior feature delivery authorization does not
automatically authorize another remote delivery.
