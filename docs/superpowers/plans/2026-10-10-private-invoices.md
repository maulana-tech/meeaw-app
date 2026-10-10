# Minimal private invoices implementation plan

Goal: deliver the approved create/share/pay/verify invoice flow inline in this chat.
Spec: `docs/superpowers/specs/2026-10-10-private-invoices-design.md`.
Execution: native implementation, retaining the current Meaw components and contracts.

## Files and contracts

- `features/invoices/types.ts`: common invoice DTOs and pinned checkout intent.
- `features/invoices/input.ts`: bounded creation input and exact base-unit total.
- `server/modules/invoices/`: Mongo repository, authenticated service/router,
  canonical receipt verifier/RPC adapter and bounded reconciliation.
- `migrations/20261010150000-invoices.js`: invoice and mirror lookup indexes;
  down removes indexes while preserving financial records.
- `lib/deposit.ts`: optional fixed salt/envelope; default behavior unchanged.
- `app/pay/[username]/PayForm.tsx`: optional invoice intent and paid callback.
- `components/invoices/`: create dialog, owner dashboard and public checkout.
- `/invoices`, `/i/[token]`: protected owner route and public client route.
- `auth-routes.ts`, middleware, DashboardShell: route access and navigation.
- Pool-indexer cron: call the bounded reconciler after public mirror sync.
- `test/invoice*.test.*`: real isolated Mongo, encoded receipts and UI evidence.

## Task 1: invoice records and receipt verification

- [x] Write failing schema/receipt tests; encode Deposit event data using viem.
  Inputs cover `[{quantity:2,unitPrice:"1.25"}] -> "2500000"`, invalid dates,
  excessive precision, wrong pool/envelope and noncanonical receipt blocks.
- [x] Implement exact totals and shared DTOs. Define
  `createInvoice(userId,input)`, `listInvoices(userId)`, `getInvoice(userId,id)`,
  `voidInvoice(userId,id)`, `getPublicInvoice(token)` and
  `confirmInvoicePayment(token,hash)` with the spec's ownership rules.
- [x] Add real Mongo regression cases for owner isolation, duplicate-number
  races and `pending|void -> paid` CAS. Apply migration twice in the fixture.
- [x] Verify schema, receipt and service tests in the combined focused run.

## Task 2: existing deposit checkout and reconciliation

- [x] Write fixed-note tests before extending `payIntoNote`: optional sixth
  argument `{salt,envelope}` must reach proof/encryption and pool submission;
  omitting it still creates a new random note.
- [x] Extend PayForm with pinned pool/salt/envelope and an `onPaid(hash)` callback.
  Keep ordinary managed-link calls unchanged. Add regression for wrong active
  pool and invoice receipt callbacks.
- [x] Implement `reconcileInvoices(limit=20)` with oldest checkedAt first,
  scoped mirror lookup and canonical receipt validation; process at most four
  RPC checks concurrently. Test an absent payer report and batch rotation.
- [x] Wire cron, preserve aggregate status and include invoice counts only.
  Existing cron tests stub the new reconciliation boundary.
- [x] Verify focused deposit, checkout, reconciliation and cron tests.

## Task 3: owner/public interfaces and final verification

- [x] Add create dialog with exact-total preview and immutable publication.
  Owner dashboard reads real API records, shows derived Overdue, copies links,
  renders local QR and allows pending Void only.
- [x] Public checkout polls every five seconds, stores an attempt marker and
  receipt hash in session storage, retries verification without a second payment
  and renders Paid/Void without checkout. Test confirmation failure, reload,
  canonical revert release and token changes with a delayed confirmation.
- [x] Add protected route/middleware and public no-index/no-referrer metadata.
  Add Invoices to navigation with horizontal mobile overflow.
- [x] Update user/privacy/operations docs and roadmap with actual evidence.
- [x] Run source TypeScript and scoped Biome, focused regressions, then
  `pnpm build:local`. Do not claim browser/device or live settlement evidence
  from component tests. Preserve unrelated files and credentials.

Review focus: cross-owner ID access, stale wallet/token results, immutable asset
selection, receipt spoofing, late Void settlement and payer confirmation failure.

Final HTTP verification exposed ignored root middleware in this `src/app`
project. Move it to `src/middleware.ts`, retaining existing policy, and rerun
auth tests/build/HTTP checks. Completed evidence and live/device limits are in
[the verification report](../reports/2026-10-10-private-invoices.md).
