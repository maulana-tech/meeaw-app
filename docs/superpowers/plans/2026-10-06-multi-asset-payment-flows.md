# Multi-Asset Payment Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task inline, as selected by the user. Steps use checkbox (`- [ ]`) syntax for tracking. A fresh whole-feature review follows implementation; no per-task implementer delegation.

**Goal:** Complete asset-correct Send, Requests, and managed links for the four existing stablecoin pools.

**Architecture:** Make asset selection explicit at new-operation boundaries and keep signed operations bound to their existing pool scope. Separate transfer capability from request capability, derive display metadata from pinned scopes, and add immutable managed-link asset/precision metadata with USDC defaults for old records. Ship Send first, then Requests, then managed links.

**Tech Stack:** Existing Next.js/React, TypeScript, tRPC, MongoDB, viem, Noble, snarkjs, Vitest/Testing Library, Hardhat. No dependency, contract, circuit, or verifier update is planned.

**Spec:** `docs/superpowers/specs/2026-10-06-multi-asset-payment-flows-design.md` (written spec approved in conversation).

## Global Constraints

- Order: Send -> Requests -> managed links. Each stage has a testable end-to-end boundary.
- Scope is USDC, AUSD, USDT0, MUSD; labels are USDC, AUSD, USDT, mUSD.
- No MON/WMON, swaps, bridges, new assets, or relaxation of the current common-decimals manifest constraint.
- No aggregation of nominal amounts across assets as USD.
- Active pool per asset for new work; legacy pools remain withdrawal-only, while previously accepted signed submissions remain reconcilable.
- Selection changes before confirmation require review again; accepted operations keep their original scope.
- Existing version-1 signatures, encrypted payloads, commitments, IDs, and signed relay bytes remain unchanged.
- Amount/note/private keys remain hidden from logs and persistent plaintext caches.
- Old managed links remain USDC with their established precision, integer amounts, URLs, and management tokens untouched.
- Managed-link asset is immutable, even when amount is unspecified; general username checkout retains asset selection.
- Preserve current lease fences, exact receipt verification, per-pool reservations, step storage, and batched recovery.
- No commit/push/PR, contract deployment, credential change, or live capability activation without authorization for this work.
- Read relevant current library documentation through Context7 before library-specific implementation.

## Review Focus

1. Asset changes during asynchronous lookup/signing: stale results must not submit a different currency (Tasks 2, 3, 5, 7).
2. Equal leaf indexes in different pools: reservations, receipts, recovery, and history must remain distinct (Tasks 2, 3, 4, 8).
3. Old manifests/records with missing fields: conservative write capability and unchanged USDC signatures/amounts (Tasks 1, 2, 4, 6).
4. Pool rotation between review and submission: require review for new work; preserve original signed bytes for accepted work (Tasks 2, 4, 7).
5. Open-amount managed links: currency stays fixed despite the existing payer-selector behavior (Tasks 6, 7).

## Setup and file boundaries

Inspect status, fetch the actual default branch, and verify the intended base before
execution. At planning time the checkout matches `origin/monad-migration` at
`ac319b4`; only this feature's spec is untracked. Preserve both local documents if
execution moves to another checkout. Use a new `feature/` branch for this work
after choosing the execution checkout; do not repurpose a merged PR branch for
remote delivery. Use the worktree skill to honor the user's checkout preference.

Record task results/rulings in this plan's ignored execution ledger. Commands in
the tasks run from `web/`, unless a contracts command explicitly says otherwise.
RED requires seeing the named assertion fail; GREEN requires a real passing exit.
Isolated Mongo tests use the existing verified test DB helper, never the app DB.
Source changes do not authorize migrations against remote/application data.

| Unit | Files | Responsibility |
| --- | --- | --- |
| Pool capabilities/formatting | `web/src/lib/pools.ts`, new `web/src/lib/paymentAsset.ts`, request `types.ts` | Explicit eligibility and scope-derived currency metadata |
| Shared asset picker | new `web/src/components/dashboard/PaymentAssetSelect.tsx` | Existing asset vocabulary for standalone forms |
| Send binding | SendTransferDialog, Dashboard, transfer crypto/proofs/service/operations/hooks/router/repository | Selected scope from input through confirmed receipt |
| Displays/receipts | activity types/rows, ActivityFeed, transfer detail/progress, DiscloseDialog, disclosure/PDF | Correct currency, scoped leaf action, no mixed totals |
| Requests | request hooks/crypto, request service/operations, creation/payment/list dialogs | Explicit request asset and original pool funding |
| Managed links | Mongo PaymentLinkDoc, paymentLinks schema/service, LinkEditorDialog/ReceiveDialog/LinksDashboard | Immutable asset/precision, exact units, old defaults |
| Checkout | `web/src/app/pay/[username]/PayForm.tsx`, username/slug pages, payment QR | Managed asset lock, correct token and scope |
| Deployment metadata | deploy/deployment-config, README public manifests | Capability candidates preserving existing pools |
| Fixtures | new `web/test/helpers/multiAssetFixtures.ts` | Canonical descriptors and real participant keys |

### Task 1: Conservative capability model and asset helpers

**Files:** Modify `web/src/lib/pools.ts`, `web/src/features/requests/types.ts`,
`contracts/scripts/{deploy,deployment-config}.ts`; create
`web/src/lib/paymentAsset.ts`, `web/test/paymentAsset.test.ts`, and fixture file;
extend `web/test/pools.test.ts` and `contracts/test/deploymentConfig.test.ts`.

**Interfaces:** Add normalized `PoolDescriptor.transferCapable:boolean` and optional
manifest/candidate input `transferCapable`. Default to `requestCapable` when absent.
Export `paymentAsset(scope:PoolScope):{symbol:AssetSymbol;label:string;decimals:number}`,
`formatPaymentAmount(units:bigint,scope:PoolScope):string`, and
`requirePaymentPool(scope:PoolScope,kind:'transfer'|'request'):PoolDescriptor`.
The last helper resolves only configured active pools with the requested capability.
Do not relax the one-request-pool constraint until Task 4.

- [ ] Write a failing manifest test: old USDC request-capable entry derives
  transfer capability; omitted capability on AUSD stays false; legacy true flags
  are rejected. Define fixture `assetPool(asset:AssetSymbol,flags?:{transfer?:boolean;
  request?:boolean}):PoolDescriptor` by copying `testPool`, adding asset/mintable,
  and giving each asset a distinct deterministic address/scope. Update old
  fixture descriptors with explicit USDC/mintable fields where type changes require.

```ts
it('keeps old non-request-capable pools write-disabled', () => {
  const parsed = parsePoolManifest(oldMultiAssetManifestFixture());
  expect(parsed.find(p => p.asset === 'AUSD')?.transferCapable).toBe(false);
});
```

- [ ] Run `pnpm test -- test/pools.test.ts test/paymentAsset.test.ts` to RED.
- [ ] Normalize capability and implement helpers using configured scope, ASSETS,
  and integer base units. Candidate builders preserve other assets and demote
  legacy scopes with both flags false. New compatible deployment candidates can
  carry transfer=true while request remains false for non-USDC in Stage 1.
  `oldMultiAssetManifestFixture()` supplies parser input, not a parsed descriptor.
- [ ] Add explicit transfer-enabled AUSD and rejected unknown/legacy scope cases;
  a 20_000_001 base-unit AUSD amount formats as `20.000001 AUSD`. Verify mainnet
  canonical-token and common-decimal guards remain intact.
- [ ] GREEN: those web suites and `pnpm exec hardhat test test/deploymentConfig.test.ts`
  from `contracts/`. Checkpoint only these files; commit only if authorized.

### Task 2: Bind direct-send protocol and API to the selected pool

**Files:** Modify transfer `transferCrypto.ts`, `transferProofs.ts`,
`hooks/useDirectTransfer.ts`, server transfers service/operations/repository/router;
extend `transferCrypto`, `transferProofs`, `transfers.service`, `transferOperations`,
`transfers.repository`, and `directTransfer` tests.

**Interfaces:** Keep SignedTransfer and SignedTransferSubmission wire versions
unchanged. New create/submit checks use `requirePaymentPool(record.pool,'transfer')`.
`pendingTransfer(user:string,pool?:PoolScope)` and repository
`pending(wallet:string,pool?:PoolScope)` add an optional scope filter;
`api.transfers.pending({pool?})` accepts omitted input for old clients.
`useTransfers(direction,pool?:PoolScope)` uses scope in pending queries/cache keys.

- [ ] Write a failing real-crypto test using AUSD transfer-enabled/request-disabled
  descriptor and existing test signer/accounts. Export fixture helper
  `makeAssetTransfer(asset:AssetSymbol):Promise<Awaited<ReturnType<typeof makeTransferFixture>>>`
  with a locally signed record in the selected descriptor; keep participant roles.

```ts
it('allows direct AUSD send without enabling requests', async () => {
  const f = await makeAssetTransfer('AUSD');
  expect((await openTransfer(f.record, f.recipient, f.pool)).amount).toBe('20000000');
});
```

- [ ] Run `pnpm test -- test/transferCrypto.test.ts test/transfers.service.test.ts`
  to RED. Replace every direct-send requestCapable guard and implicit requestPool
  lookup with explicit transfer capability/scope. Never select a fallback USDC pool.
- [ ] Keep signed domain/AAD fields identical. Driver resolves record.pool after
  reload and scans only that pool. New signatures require active capability;
  existing signed journal recovery does not require relocating to the current pool.
- [ ] Add sender pending records in two pools; scoped pending returns the matching
  one. Equal leaf 0 and amount 20 in USDC/AUSD cannot supply each other's proof,
  signature, submission or reservation. Keep unknown broadcasts idempotent.
- [ ] GREEN: all six affected transfer suites plus `selectFunding`, `spendReservations`,
  `durableRelayer`, and `requestCrypto`; no new replica-set transaction dependency.

### Task 3: Finish selected-asset Send UI, history, and receipts

**Files:** Modify Dashboard, SendTransferDialog, TransferProgress,
TransferDetailsDialog, PendingTransfersNotice, ActivityFeed, HistoryDashboard,
payment activity types/rows, DiscloseDialog, `lib/disclosure.ts`, and
`lib/disclosurePdf.ts`. Add `multiAssetSend.test.tsx` and
`multiAssetDisclosure.test.ts`; extend existing UI/activity/disclosure suites.

**Interfaces:** `SendTransferDialog` adds required `pool:PoolDescriptor`; review
snapshot includes its scope. `ActivityRow` adds `asset:AssetSymbol` and
`tokenDecimals:number` derived through `paymentAsset(row.scope)`.
`DiscloseDialog` adds `pool?:PoolDescriptor`, preserving its default call.
`DisclosureBundle` adds optional `asset`/`tokenDecimals`; old bundles default USDC.
`buildDisclosure` verifies note/scan/pool agreement and uses the scan's pool address.

- [ ] RED: mount actual Send dialog with injected registry/scan/signing boundaries;
  re-render it with another pool after review. Capture submitted records, not
  merely button presence.

```ts
it('requires new review after asset selection changes', async () => {
  const f = await renderAssetSendFixture('AUSD');
  await f.review('bob', '20', 'Lunch');
  f.selectAsset('USDC');
  await f.confirmIfAvailable();
  expect(f.createdRecords).toHaveLength(0);
});
```

- [ ] Run `pnpm test -- test/multiAssetSend.test.tsx test/multiAssetDisclosure.test.ts`
  to RED. Define `renderAssetSendFixture` in the fixture file to render with the
  existing providers and return review/select/confirm actions plus accepted records.
- [ ] Pass Dashboard's selected pool to Send, filter its pending lookup, include
  scope in async session guards, and snapshot it in review. Use scope-derived
  labels for amounts, progress, errors, detail, CSV and PDF. Reuse current styling.
  Remove the active-pool-only receipt restriction only once disclosure uses the
  row's resolved pool; never open leaf 0 in the wrong scope.
- [ ] Test USDC and AUSD rows of equal amount retain different currencies/IDs;
  selected-asset totals exclude the other. Old disclosure bundles still verify;
  a new AUSD receipt's pool/label/decimals match the note. Keep append-only evidence
  semantics and consolidation/change exclusion.
- [ ] GREEN: new suites, SendTransferDialog, multiAssetDashboard, activityRows,
  disclosure, disclosurePdf, page, and BalanceCard suites. Stage 1 ends with all
  four verified transfer-capable assets working without enabling extra Requests.

### Task 4: Requests protocol resolves each request's asset

**Files:** Modify pool manifest guard/helpers, request crypto/hooks,
`requests.service.ts`, `requestOperations.ts`, deployment candidates;
extend pools/request crypto/service/operations/payment/recovery tests.

**Interfaces:** `requestPool(asset?:AssetSymbol)` remains backward compatible;
explicit callers choose an asset. `requirePaymentPool(scope,'request')` owns new
work eligibility. `useCreateRequest().create` gains `pool:PoolDescriptor` in its
client argument; API signed-record shape and signature version stay unchanged.

- [ ] RED: create an AUSD request with a distinct scope and real participant keys;
  the payer is currently viewing USDC but has sufficient AUSD notes. Fixture
  `makeAssetRequest(asset)` returns the existing request fixture shape, with its
  record signed through existing `createSignedRequest` using that pool.

```ts
it('funds from the request scope rather than the selected dashboard asset', async () => {
  const f = await makeAssetRequestPaymentFixture('AUSD', 'USDC');
  await f.pay();
  expect(f.submissions.every(s => s.pool === f.request.pool)).toBe(true);
});
```

- [ ] Run `pnpm test -- test/requests.service.test.ts test/requestPayments.test.tsx`
  to RED. Define `makeAssetRequestPaymentFixture` with real request crypto and
  controlled scan/prover/transport ports, recording actual submitted bodies.
- [ ] Permit several request-capable active pools, at most one per asset; retain
  chain/token/common-decimal/legacy constraints. Server create/begin validates the
  signed scope, and browser pay/resume uses the record's descriptor. Preserve
  exact-receipt validation and original-scope recovery for signed in-flight work.
- [ ] Reject payment using USDC notes for an AUSD request despite sufficient total
  value. Test wrong pool, lack of capability, legacy new preparation, old USDC
  signatures/envelopes, cancel/decline races, and unchanged encrypted record storage.
- [ ] GREEN: affected request suites, pools, transfer suites, and deploymentConfig.

### Task 5: Asset-aware request creation, lists, and confirmation

**Files:** Create PaymentAssetSelect; modify CreateRequestDialog, RequestsDashboard,
PayRequestDialog, ReceiveDialog and Dashboard wiring; extend corresponding UI tests.

**Interfaces:** `PaymentAssetSelect({value:PoolScope,onChange:(pool:PoolDescriptor)=>void,
kind:'transfer'|'request'|'payment',disabled?:boolean})` lists eligible active pools.
`CreateRequestDialog` accepts optional initial pool; standalone entry uses the
shared dashboard selection and explicit eligible picker before creation.
Received/Sent request rows resolve their record's scope for amount/label.

- [ ] RED: an AUSD request displays `20 AUSD` while the dashboard is set to USDC;
  the confirmation shows AUSD balance and refuses a solely USDC-funded payment.

```ts
it('keeps the requested currency visible during payment review', async () => {
  const f = await renderAssetRequestFixture('AUSD');
  expect(f.screen.getByText('20 AUSD')).toBeVisible();
  await f.reviewPayment();
  expect(f.screen.getByText(/AUSD balance/)).toBeVisible();
});
```

- [ ] Run CreateRequestDialog/PayRequestDialog/RequestsDashboard tests to RED;
  `renderAssetRequestFixture` is the shared provider-backed request UI fixture.
- [ ] Wire initial selection, eligible picker, and scope session guards. Changes
  before create require new review; existing requests cannot change currency.
  Locked amounts/notes stay hidden. Global pending counts still count participant
  requests independently of pagination, not only the chosen asset.
- [ ] GREEN: request UI suites, request polling/list counts, multiAssetDashboard,
  and page tests. Stage 2 is complete without changing Requests' business states.

### Task 6: Managed-link asset/precision persistence and compatibility

**Files:** Modify `server/db/mongo.ts`, paymentLinks schema/service/router,
paymentLinks client types/hooks; create
`web/migrations/20261006130000-payment-link-assets.js` and
`web/test/paymentLinkAssetsMigration.test.ts`; extend link schema/service tests.

**Interfaces:** PaymentLinkDoc/LinkOutput add `asset:AssetSymbol` and
`tokenDecimals:number`, optional only in legacy storage. Create input accepts
optional asset, default USDC; amount remains raw decimal at transport boundary.
Server creation resolves the active payment pool and converts once using its
decimals. Update input cannot change asset; conversion uses the stored snapshot.
Missing fields read as USDC/established `NEXT_PUBLIC_USDC_DECIMALS`.

- [ ] RED: create an AUSD link for `20.000001`, edit to `10.5`, and read a legacy
  integer USDC amount `20000000` without rescaling.

```ts
it('preserves legacy units and stores selected currency exactly once', async () => {
  const f = await openLinkAssetFixture();
  const link = await f.create({asset:'AUSD',amount:'20.000001'});
  expect(link.amount).toBe('20000001');
  expect(link.asset).toBe('AUSD');
  expect((await f.readLegacy()).amount).toBe('20000000');
});
```

- [ ] Run paymentLinks.schema/service and asset migration tests to RED. Define
  `openLinkAssetFixture` using isolated Mongo, real service conversion, controlled
  active pool descriptors, and normal management-token issuance/verification.
- [ ] Refactor field transforms so asset-aware conversion happens exactly once;
  client form schema validates but retains raw decimal. Update never reparses
  existing stored units as human input. Migration only fills missing asset/decimal
  fields, is repeatable, and leaves amount/URL/manage-token bytes untouched.
- [ ] Test null/open amount, zero, extra precision, large/out-of-range amounts,
  unsupported/missing pool, unauthorized edits, forbidden asset change, and
  old fixed-link 10x regression. Rollback never removes real payment records.
- [ ] GREEN: link schema/service/migration plus existing wallet/relay regressions.

### Task 7: Managed asset lock in editor and checkout

**Files:** Modify LinkEditorDialog, ReceiveDialog, LinksDashboard, PaymentQrDialog,
PayForm, general and slug payment pages, PrivacyPoolStat and its callsites as
needed; create `web/test/managedLinkCheckout.test.tsx`, extend link/UI/payer tests.

**Interfaces:** New links take a supported selected asset; editor retains immutable
asset on edit. Managed PayForm resolves `activePoolFor(link.asset??'USDC')` and
always locks currency, including null amounts. General PayForm without a link
keeps asset selection. PrivacyPoolStat accepts optional pool to show matching data.

- [ ] RED: real PayForm rendered with an open AUSD managed link must not offer
  USDC selection, while a general username link still does.

```ts
it('locks currency even when a managed amount is open', async () => {
  const f = await renderManagedCheckout({asset:'AUSD',amount:null});
  await f.pay('20');
  expect(f.acceptedPayments[0].pool.asset).toBe('AUSD');
  expect(f.screen.queryByRole('button',{name:'USDC'})).not.toBeInTheDocument();
});
```

- [ ] Run managedLinkCheckout and existing payer/QR/link editor suites to RED.
  `renderManagedCheckout` mounts actual PayForm with controlled wallet, token
  balance and payment transport, exposing accepted payment arguments and screen.
- [ ] Wire create selection and read-only edit asset; show label in list/QR and
  scope-aware checkout. Parse/format/mint using resolved token decimals; permit,
  allowance, proof and deposit use the same captured pool. Re-resolve active
  asset pool before submit and reject a changed snapshot until review/refresh.
- [ ] Test fixed and open managed assets, legacy USDC, missing asset pool, pool
  rotation during signer preparation, general multi-asset choice, email/injected
  wallets, and no token substitution after async balance refresh. Stage 3 changes
  neither management-token authority nor reusable-link status semantics.
- [ ] GREEN: new checkout and existing payer, deposit, links, QR, relay suites.

### Task 8: Cross-pool proof evidence, final regression, and documentation

**Files:** Create `contracts/test/multiAssetPayments.test.ts`; extend existing
contract pool fixture only with a test-owned second token/pool constructor;
update README, features/local setup, transfer/request operations, and verification
report. Keep live capability evidence in a reviewed public-only artifact.

- [ ] Inspect each configured new pool with read-only RPC: correct chain/token,
  compatible ABI and nonzero Merge verifier. Produce evidence; do not set live
  flags or deploy as part of merely reading compatibility.
- [ ] Write/run real-proof cross-pool tests with two isolated token pools. Use
  current `deployPoolFixture`, `depositOwnedNote`, `makeMergeProof`, and
  `makeTransferProof` exports. Keep per-pool owned-note maps and roots separate.

```ts
it('settles AUSD privately without consuming USDC notes', async () => {
  const f = await deployMultiAssetPaymentFixture();
  await f.fund('AUSD',[10_000_000n,15_000_000n]);
  await f.fund('USDC',[25_000_000n]);
  await f.send('AUSD',20_000_000n);
  expect(await f.privateBalances('AUSD')).to.deep.equal({sender:5_000_000n,recipient:20_000_000n});
  expect(await f.privateBalances('USDC')).to.deep.equal({sender:25_000_000n,recipient:0n});
});
```

- [ ] Implement `deployMultiAssetPaymentFixture` from existing local contract
  helpers: `fund` deposits real-proof owned notes, `send` merges and transfers
  with current wasm/zkeys, `privateBalances` checks owned commitments/nullifiers.
  Reject replaying pool-A proof on pool B, duplicate fixed output, wrong token/
  scope and paused/unsupported pools. Run `pnpm exec hardhat test` in contracts.
- [ ] Run complete `pnpm test -- --maxWorkers=2`, then typecheck and scoped lint
  after source changes settle. Run root `pnpm build:local`; smoke normal production
  server with public page and protected unauthenticated API. Do not hide a failed
  default Windows standalone build as a successful packaging check.
- [ ] Browser checks at desktop/mobile: each selection, input/review, switches
  during async work, pending reopening, request asset, managed asset lock, old
  USDC URLs, filters, receipts, lock/unlock, and errors. Record whether real auth/
  chain, isolated UI fixture, or injected transport was used; no overstated E2E.
- [ ] One fresh read-only whole-feature reviewer, then one justified fix pass with
  regression evidence. Inspect staged/unstaged/untracked files and diff whitespace.
  Update docs with exact activation prerequisites, compatibility and limitations.
  Hand off locally; remote delivery requires a new explicit request.

## Spec coverage and self-review

| Requirement | Tasks |
| --- | --- |
| Four existing assets and conservative capability defaults | 1, 8 |
| Send captured scope, signed compatibility, distinct pending pools | 2, 3 |
| Scoped history/CSV/PDF and single-asset summaries | 3, 8 |
| Requests asset-specific creation/funding/recovery | 4, 5 |
| Managed immutable asset, exact units, legacy migration | 6 |
| Fixed/open managed currency lock, general choice, token targeting | 7 |
| Rotation/switch races, local proofs and regression evidence | 2–8 |
| Public compatibility evidence and explicit delivery authority | 8 |

Self-review: no spec section is left without a task. Fixtures and helper contracts
are defined where first used; later interfaces retain the same names/types.
No script commands modify application/remote data without authorization. The
execution method is already inline; request review of this saved plan, not a new
method selection, before implementing product changes.
