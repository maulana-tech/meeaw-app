# Multi-asset payment flows

Send, Requests, and managed payment links support the four existing assets:
USDC, AUSD, USDT0, and mUSD. Each pool remains independent. Balances, inputs,
pending operations, proofs, receipts, and recovery use the original pool scope.
There is no swap or conversion between assets.

## Capabilities and activation

An active pool may advertise `transferCapable` and `requestCapable` separately.
Missing `transferCapable` inherits `requestCapable` for older manifests; an
unconfigured legacy fallback advertises neither capability. Legacy pools stay
withdrawal-only. There may be one active pool per asset and multiple
request-capable assets. All pools must still use `NEXT_PUBLIC_USDC_DECIMALS`
precision. Adding an 18-decimal asset is outside this change.

Before enabling a capability, confirm the RPC chain, token address, deployed
MaweePool ABI, and nonzero compatible Merge verifier. Reuse the scoped indexer
and workers in [request operations](request-payments-operations.md) and
[transfer operations](direct-transfer-operations.md). Review manifest flags and
rebuild client and server together. Reading compatibility does not activate
capabilities. This implementation did not deploy contracts or change the
environment manifest.

New pools constructed by the deployment script use the current Merge verifier
and advertise both capabilities. Arbitrary deployment candidates retain explicit
flags, with conservative defaults for assets other than USDC.

## Payment behavior

- Send uses the selected asset and rechecks account/selection after asynchronous
  work. Pending sends are looked up by wallet and pool. Submitted operations
  continue to reconcile against their captured scope.
- Request creation accepts an eligible asset; payment and funding use the signed
  request's pool. Changing a dropdown cannot change an existing request's currency.
- Managed links store immutable `asset` and `tokenDecimals`, including links with
  an open amount. General `/pay/username` links continue to offer currency choice.
- Missing/unsupported managed assets fail closed. Wallet preparation, proof,
  approval, permit, and deposit use the captured pool. Account/selection changes
  or active pool rotation abort work before submission.
- History, CSV, PDF, QR captions, and checkout statistics display the record's
  asset. Totals remain specific to the selected asset.

Amounts are positive uint64 base units. The API schema converts human decimal
input once; the service stores integer units unchanged. Edits can update amount
and description but cannot mutate the asset.

## Existing links and migration

The additive `20261006130000-payment-link-assets.js` migration fills missing
asset metadata with USDC and its configured precision. It never rescales an
amount or replaces a management token. It is repeatable; down intentionally
keeps additive metadata. Reads also default old documents to USDC before the
migration runs. Follow [local setup](local-setup.md) for the normal migration
workflow. No application database migration was run during implementation.

## Verification on 2026-10-06

The complete web suite passed 419 tests in 109 files before final validation
fixes. Subsequent focused regressions cover actual Send/Request/checkout
components, limits/immutability, migration repeatability, and scoped receipts.
The final checkout/request/link/receipt run passed 30 tests; a separate affected
UI/migration run passed 21 tests. These overlap and are not a new full-suite count.
The complete contract suite passed 45 tests, including real AUSD proofs that
merge 10 + 15, pay 20, return 5, and leave USDC nullifiers unspent. Replaying the
AUSD transfer against the separate USDC pool is rejected.

Public read-only Monad testnet checks verified matching tokens and Merge
verifier bytecode for AUSD, USDT0, and mUSD. See
[public compatibility evidence](multi-asset-pool-compatibility.json). The USDC
getter reverted; USDC compatibility was not confirmed by that check. Resolve
that separately before any new activation decision.

Component tests use controlled wallets/transport; real proofs run on local
Hardhat. No authenticated Privy browser journey or live testnet payment was
executed. The fresh reviewer could not run because of the agent usage limit;
self-review was performed instead. Windows `build:local` verifies normal Next
build, not standalone packaging. The implementation uses branch
`feature/multi-asset-payment-flows`.

Production smoke returned 200 for public/dashboard HTML and 401 for the protected
request-count API. An anonymous browser was redirected from dashboard to home.
Final `build:local`, TypeScript, and scoped source Biome checks passed; Biome
reported non-null assertion/optional-chain warnings. Diff whitespace checks passed.
The authenticated feature screens have component-test coverage; desktop/mobile
visual acceptance still needs a real session.
