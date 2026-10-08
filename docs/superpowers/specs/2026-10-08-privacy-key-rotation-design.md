# Routine privacy-key rotation from Settings

Date: 2026-10-08
Stage: spec and implementation plan approved in conversation; inline execution started.
Inspected base: `monad-migration`, `ce2adf1`, matching fetched
`origin/monad-migration`; tracked working tree was clean before this spec.

## Intent and approved direction

Complete the Settings re-keying feature already described in the product docs.
An existing user can rotate the privacy keys used for new incoming payments while
retaining access to previously recoverable notes and encrypted history.

The user selected routine rotation, not compromise recovery, and approved:

- Derive generations from the existing recovery root; retain the current PIN or
  passkey and its established recovery method.
- Preserve the original derivation as generation 0. New generations have distinct
  note-owner secrets and viewing keys, derived locally with versioned domains.
- Rotate the registry's public key pair only. Do not spend, consolidate, transfer,
  or withdraw private notes as part of rotation.
- Keep old generations recoverable on another device using the same recovery.
- Select each note/record's actual key generation for scanning, proofs and receipts.
- When a later user-confirmed Send/Pay needs old-generation funds, prepare them
  privately for the operation's generation. Classify those steps as internal work,
  not income or a separate business payment.
- Activate new keys only after confirmed registry evidence, and reconcile lost
  responses/reloads without creating another rotation.

Success: a user with 15 AUSD under generation 0 rotates to generation 1 without
changing that note or its nullifier. A subsequent 5 AUSD payment uses generation 1.
The user can discover both notes, recover them on another device, cash out either,
produce the correct receipt, and pay a confirmed 20 AUSD Send/Request through
generation-aware preparation without borrowing another asset's balance.

## Current constraints

- `LocalAccount` currently holds one owner secret and viewing private key in page
  memory. The note scanner decrypts with that key and verifies one owner public key.
- `deriveNoteSecrets(master)` uses fixed owner/view domains. PIN escrow stores the
  encrypted root; passkey recovery stores public credential data and regenerates
  the root with PRF. PIN change re-wraps the same root and is not privacy-key rotation.
- Registry/relay helpers already support public-key changes. Indexer accounts have
  public key history. Settings has recovery/PIN controls but no routine rotation UI.
- Merge proves that both inputs have the same owner secret. Combining different
  generations directly would fail even when both notes belong to the same wallet.
- Transfer can spend an old-owner note into a chosen recipient key, with change
  tied to the original input owner. This enables internal key preparation using
  current circuits; zero change is internal, not a received payment.
- Existing signed request/transfer records capture participant key pairs. New
  intent creation checks current participant keys; existing records must not be
  rewritten to follow a later rotation.
- Spend claims and the durable relayer journal already protect scoped nullifiers,
  accepted steps and uncertain broadcasts. Rotation must coordinate with them.

No new circuit, proof artifact, registry contract, or pool deployment is required.
Protocol/recovery adapters may need additive versioning, with explicit legacy
decoding; do not change the meaning of already signed version-1 records.

## Key generations and recovery

Keep the recovery root and credential method unchanged. Define generation 0 as the
exact current owner/view derivation, byte for byte. For generation n > 0, use
distinct, fixed versioned HKDF domains containing the canonical generation number,
separating owner-secret and viewing-key derivation. Do not derive a new generation
from the previous generation's private key.

Versioned account metadata contains an authenticated owner/registry scope,
revision, active generation, and append-only generation records with public key
pairs and their confirmed registry evidence. The first release supports 64 total
generations, numbered 0–63. At the limit, disable another rotation with an explicit
message; never delete an old generation to make room. Increasing that bound is
separate work, not silent unbounded derivation/scanning.

The server stores no plaintext root, owner secret, viewing private key, PIN, or
decrypted historical key vault. PIN escrow retains its existing encrypted-root
format. Passkey mode adds public generation metadata only and continues to derive
private material from the existing passkey. Historical private keys are regenerated
locally, held only in the unlocked session, and cleared on lock/sign-out/identity
change. The same PIN/passkey plus verified metadata restores every retained generation.

Public metadata alone cannot establish which keys to activate. On unlock, derive
the indicated generations and verify their public pairs against authenticated
metadata and registry evidence. A mismatching recovery root, changed pair, unknown
generation, truncated history, or inconsistent active record must fail closed.
Do not silently republish generation 0 over a rotated registry pair.

Bootstrap old accounts as generation 0 only after the current recoverable key pair
is verified. Existing key replacements made before this feature may have discarded
a different recovery root. Public registry history cannot reconstruct those lost
secrets; this feature does not promise to recover already-lost masters or notes.
An inconsistent legacy account requires explicit recovery guidance, not a guessed
generation history.

## Settings journey

Add a Privacy keys section showing the active generation, completed rotation time,
and Rotate privacy key. The action requires a claimed username, verified recovery,
an unlocked account, and a consistent current registry/key-generation state.

The dialog explains that new incoming payments will use new keys, old notes remain
accessible, and rotation does not move private funds. Re-authenticate using the
existing PIN or passkey, derive the candidate locally, and show a short key
fingerprint for review. Never display/export the recovery root or private keys.

Confirm prepares one durable rotation intent and updates the registry key pair.
Relayer sponsorship may cover the registry transaction; otherwise the user's wallet
must approve it and have ordinary gas. Distinguish signing/submitting/confirming,
confirmed, failed-before-submission, and pending reconciliation. Closing a dialog
does not cancel an accepted registry operation or permit another rotation.

On confirmed success, refresh authenticated generation metadata and the public
username cache, activate the new generation, invalidate scans/decrypted-record
caches, and refresh balances. If confirmation is known but metadata/cache projection
is incomplete, keep a recoverable synchronization state and retry that projection.
Do not ask the user to rotate again.

Switching wallet, locking, or changing recovery identity invalidates unaccepted
preparation. Already submitted work reconciles against its captured owner, registry,
nonce and candidate. No other wallet/account can continue or read the private
operation through authenticated APIs.

## Rotation coordination and durable evidence

Use one pending rotation per authenticated account and registry scope. Prepare
with compare-and-swap against the expected metadata revision and active public pair.
Persist the candidate generation/public pair and intent before requesting broadcast.
Authenticate ownership and bind generation number, current/candidate public pairs,
registry/chain, operation identity and revision to the user's authorization. The
registry authorization retains its actual nonce/deadline semantics.

Hold an account-generation fence while rotation is pending. New app-initiated
payment intents and proof preparation cannot start against an uncertain generation.
Known active outgoing Send/Request spend operations must settle, fail conclusively,
or safely abandon unsigned preparation before rotation starts. Do not drop signed
transactions, revoke their spend claims, rewrite accepted output commitments, or
silently cancel payments. Pending requests with no payment operation may remain.

App rotation and app spending must share an authenticated generation/revision guard;
checking a UI pending count alone is insufficient across devices. Preserve existing
pool/nullifier spend coordination. Anonymous already-authorized pool transactions
cannot be reliably attributed to this account by a new UI fence; their immutable
proofs remain valid and their observed effects are reconciled normally. Never
claim registry rotation revokes outstanding pool proofs.

For relayed registry writes, reuse durable journal/nonce coordination and persist
exact signed bytes before broadcast. Reconcile or rebroadcast those same bytes.
For browser-wallet writes, persist the intent before the wallet prompt and record
the public hash when available. If the wallet/provider loses the response, compare
confirmed registry owner/public pairs and tracked nonce/evidence before deciding
whether the intent succeeded or may be safely retried. No automatic fresh-nonce
rotation follows an unknown outcome.

Do not activate a candidate from a database flag, cached username row, or unconfirmed
RPC result. Verify registry owner, exact public pair, chain/registry scope, and
configured confirmation depth. Reorgs/unknown receipts remain reconciliation states.
If another action changed the registry to an unexpected pair, report conflict and
preserve every known generation; never overwrite it with a guessed retry.

Changing recovery PIN re-wraps the same root and preserves generation history.
Coordinate its revision with pending rotations so a lost recovery update cannot
strand a confirmed generation. Replacing recovery methods/roots is outside this
release. Existing account-setup repair paths must not implicitly reset an account
with established generation history.

## Scanning, spending, records and receipts

Introduce an unlocked key-ring abstraction with an active generation and historical
accounts. Preserve the existing one-account interface where a caller needs the
active pair, but route ownership-sensitive work through generation selection.

For each pool, scan one complete public prefix and try the retained viewing keys.
Verify a decrypted note's commitment using its matching owner public key. Attach
that generation to the local owned note; calculate nullifiers and spent checks with
that generation's owner secret. Deduplicate by pool/leaf and commitment. A note
cannot count twice because multiple keys were tried. Keep asset totals separate.

Resolve encrypted request/transfer records by their captured participant public
pairs, not today's registry keys. Both sides can decrypt old records and recover
their owned outputs after rotation. New intent creation uses the confirmed active
pair; already accepted records keep their original keys, signatures, timestamps,
recipient commitments and reconciliation identities.

Cash-out and receipt generation choose the owning note's account. Do not prove an
old note with the current secret merely because it appears in the same balance.
The receipt's disclosed owner public key must open that note; its existing anchored
verification format remains valid without exposing generation secrets.

## Send/Pay preparation across generations

Funding plans group input notes by pool and owning generation. Merge only within
one group. If a confirmed operation needs funds from another generation, use the
existing Transfer circuit for an internal self-output to the operation's captured
funding generation, then rescan and continue Merge/payment as required.

For a new operation, the funding generation is the active sender/payer generation
captured when creating or beginning it. An already accepted operation keeps its
captured generation even after a registry update; resolve it from retained keys.
Request recipient output remains the signed request's immutable commitment. Direct
Send recipient keys remain the reviewed/accepted record's immutable pair.

Internal preparation starts only after the user confirms that payment. Do not
migrate all old notes on rotation, unlock, background refresh, or balance display.
Do not mix pools/assets, transfer funds out of the shielded pool, or impose a
general-purpose key-migration product outside the existing payment journey.

Persist each preparation step and encrypted recovery metadata before/with acceptance,
using the existing signed operation identity, fenced spend claims, durable journal
and receipt validation. Bind its destination to the captured funding generation,
not a mutable current-generation lookup. Changes to amount, outputs or generation
require a new unaccepted review, never replacement of an accepted step.

Encrypted recovery metadata must identify the output's owning generation without
storing private roots/keys or decrypted note data server-side. Additive private-frame
or submission versions must retain legacy decoders and signature verification;
do not relabel old signed packets. Prefer reuse of the existing preparation kinds
when their semantics fit, and extend narrowly where ownership context requires it.

If migration confirms and final payment fails, the migrated note remains the user's
private funds and must be discovered after reload/unlock. Unknown broadcasts keep
their reservations and may not become permission to pay twice. Legacy pools retain
their current withdrawal-only behavior; no self-transfer preparation is allowed
there merely to make an old key eligible for active-pool funding.

History/classification must recognize self-preparation and old/current owned outputs
through the key ring. Internal migrations, Merge, splits and change are not new
income or business sends. Show one final recipient payment, and count only matching
confirmed chain evidence as settled. Extend existing locked/stale-index behavior.

## Privacy and compatibility

Private keys and decrypted history remain browser-memory only. Server-side metadata
contains public generation pairs, revision and authorized operation/chain evidence;
recovery fields retain the established credential/escrow model. Bound schemas,
generation derivation/scanning, pagination, retries and public-history reads.

Do not put root material, owner secrets, viewing private keys, PINs, decrypted note
amounts/salts or key-ring contents in logs, analytics, URLs or plaintext storage.
Record-specific encrypted recovery remains allowed under its existing privacy model.
Lock/sign-out must clear all generations, not only the active one.

Retain generation-0 derivation, existing PIN/passkey accounts, version-1 request and
transfer decoding/settlement, current receipt versions, old balances and pool scopes.
Account-generation metadata is additive and protected against lost-update/conflicting
device writes. Retain old history on rollback; never reset registry keys or erase
recoverable versions as an automatic rollback shortcut.

Routine rotation does not revoke leaked historical keys or secure a compromised
recovery root. Compromise response and deliberate root replacement are separate
features. Avoid product copy implying otherwise.

## Verification and acceptance

1. Fetch/check the actual default base before implementation; isolate feature work
   from the default checkout while preserving approved documents and local changes.
2. Golden vectors: generation 0 exactly equals current derivation; owner/view domains
   and generation IDs produce distinct deterministic keys; PIN and passkey recovery
   rebuild identical generations across fresh sessions/devices.
3. Rotation changes only registry key state. Existing commitment/nullifier/fund balances
   remain unchanged. No pool spend, Merge, withdrawal or self-transfer is initiated.
4. Lost response, dialog close, reload, stale metadata revision, two-device race,
   wrong wallet, failed signature, reorg, stale public cache and unconfirmed registry
   evidence do not create duplicate rotation or activate a false generation.
5. Old/current notes are both discoverable, never double-counted, and use the matching
   secrets for spent checks/cash-out/receipts. A lock clears every private generation.
6. Existing pending request/transfer envelopes still decrypt under their captured
   pairs. A late payment to an old key remains discoverable; outputs/commitments
   cannot be substituted with the current key. Requests without spend operations
   do not require cancellation just to rotate.
7. Real local proofs: old-generation 15 AUSD plus current-generation 5 AUSD can fund
   one 20 AUSD confirmed payment through internal same-pool preparation, with exact
   conservation and no USDC note consumption. Direct cross-owner Merge fails.
8. Preparation recovery survives a confirmed migration plus failed final payment.
   Unknown transactions retain claims; retries reconcile identical accepted bytes.
   History shows one payment and excludes internal outputs from income totals.
9. Legacy-pool old-generation notes remain cash-out/receipt eligible without becoming
   active Send funding. Different generations/pools with equal leaf indices do not
   collide in ownership, caches, operations or classification.
10. PIN re-wrap preserves root/history; passkey unlock uses the same credential;
    tampered/missing generation metadata cannot trigger a silent registry reset.
    Already-lost legacy roots are not fabricated from public key history.
11. Invalid/bounded API inputs, unsupported generation limits, unauthorized users,
    stale revisions and active-spend/rotation races fail predictably before writes.
    No new private material appears in requests, persistent stores or logs.
12. Actual Settings UI tests cover re-auth, review, pending/reconcile, success,
    failure, wallet/lock switches and cross-device conflicts. Verify desktop/mobile
    presentation and distinguish controlled transport from authenticated/live evidence.
13. Run affected crypto, recovery, scan, proof, service, coordinator, history/receipt
    and UI regressions; real local-contract evidence; complete web/contracts suites,
    TypeScript, scoped lint and supported local production build. Report timeout
    tuning, skipped optional traces and verification limits explicitly.

## Delivery and review boundaries

This spec records the approved conversational direction and awaits written-spec
review. The next stage is an implementation plan, its review, then inline execution
using the existing preference. No product source has been changed while writing
this spec. Previous receipt-feature commit/merge authorization does not authorize
new remote delivery, live registry rotation, migrations or deployment here.

Self-review: deterministic recovery/public metadata preserves the accepted storage
model; generation 0 and immutable old records remain compatible; cross-generation
funding uses supported circuit behavior rather than a false cross-owner Merge;
rotating never spends notes. Confirmation, concurrency, recovery, classification
and compromise limits have explicit acceptance coverage. No new payment product,
automatic background migration, new cryptographic artifact or root replacement is
included.
