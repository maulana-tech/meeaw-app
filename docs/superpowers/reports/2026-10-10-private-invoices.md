# Minimal private invoices

Branch: `feature/private-invoices`, based on `origin/monad-migration` at
`bcc3fb6852110c8dbc9f98cd3f6aa7bcb0107ddd`. This report records local
implementation verification before Git delivery. The user subsequently
authorized committing and pushing this work; remote delivery and deployment
status are reported separately.

## Implemented

- Protected invoice creation/listing with immutable number, client, line items,
  exact BigInt total, due date, notes and USDC/AUSD pool selection.
- Random public link, owner QR/copy actions, Pending/Paid/Void and derived
  Overdue. Cross-owner reads and mutations return not-found.
- Server-created canonical encrypted note using public recipient keys, pinned
  pool/key snapshots and the existing deposit proof. No new contract or circuit.
- Paid requires canonical successful receipt, sufficient confirmations and the
  exact pool, commitment, encrypted envelope and log metadata. A mirror record
  only locates a candidate transaction. Late payment after Void retains void time.
- Bounded pool-indexer reconciliation recovers payments without payer notification.
- Attempt persistence before broadcast and direct hash persistence before receipt
  waiting. Unknown outcomes block another payment across reload. Explicit fresh
  pre-send rejection, unsigned release and invoice-bound canonical reverts allow
  retry. A missing mirror record does not release an uncertain attempt.
- Public no-index/no-referrer metadata and headers, protected owner route,
  dashboard navigation and current design components.
- Moved existing authentication middleware beside `src/app`. The initial
  production HTTP smoke test reproduced an unauthenticated `/invoices` response
  of 200 and an empty middleware manifest, despite passing unit tests. Installed
  Next.js discovers middleware beside its app directory. The move restores the
  existing cookie gate for every configured route, without changing its policy.
- Idempotent Mongo indexes with a down migration that preserves invoice records.

## Verification

- Combined focused regression run: 20 files / 129 tests, exit 0. It covers input,
  receipts, deposit lifecycle, router auth/errors, invoice service and checkout,
  existing managed links, cron, navigation, PWA and relay/sponsorship behavior.
- An additional late-confirmation/token-switch regression was added afterwards.
  The updated checkout suite passed 8/8, exit 0; no production source changed
  between these runs. Verified union: 20 files / 130 tests, not the entire suite.
- Service tests use a real local Mongo server and unique `meaw_invoice_test_*`
  databases. They cover ownership, exact stored/decryptable notes, concurrent
  number creation, Paid/Void races, duplicate/late confirmation, mirror forgery,
  bounded recovery rotation and migration up/down. They drop only their own DBs.
- Chain receipt and transaction-calldata evidence uses encoded fixtures with
  stubbed RPC boundaries. This is not evidence of a funded live transaction.
- Fresh source TypeScript: `pnpm --filter web exec tsc --noEmit`, exit 0.
- After the middleware move, the affected middleware, invoice-router and
  dashboard suites passed 3 files / 19 tests, exit 0.
- Final scoped Biome: 44 implementation/test/migration files, exit 0, no
  diagnostics. Migration JavaScript syntax and `git diff --check` passed.
- Final `pnpm build:local` passed with exit 0 after the middleware move,
  including type validation, 18 generated pages and middleware in the route table.
- Against that rebuilt production server, six HTTP smoke checks passed: public
  invoice shell (200) with generic title and no-index/no-referrer headers and
  metadata; owner redirect (307); session-only refresh preserving `/invoices`
  (307); protected list API (401); malformed public token (400); unauthorized
  cron (401). No invoice/payment or reconciliation mutation was made by these
  requests. The public shell check does not establish a real loaded invoice.
- Read-only review identified uncertain-broadcast retry and two recovery gaps.
  Explicit submission metadata and canonical-revert recovery corrected those
  findings, with regressions in the final focused runs. The reviewer did not
  independently rerun the tests or approve the final revision.
  A separate bounded review of the middleware placement fix found no
  Critical/Important issue; production HTTP validation remained our responsibility.

Existing pnpm configuration and Vitest deprecation warnings remain. The managed
link component suite also retains an existing React act warning; these warnings
were not suppressed by this feature.

## Limits and operations

Browser access to localhost was previously rejected by the browser URL security
policy. No alternate/headless workaround was attempted. Physical-device layout,
wallet/email checkout, recipient discovery and funded Monad testnet settlement
remain unverified. Component tests and HTTP responses do not prove those flows.

No application/live database migration or funded chain operation was performed.
Run the existing migration command before deployment for the deposits mirror
lookup index and keep the pool-indexer cron running for closed-tab reconciliation.
See [invoice operations and privacy](../../invoices.md).

Invoice data and deposit correlation are visible to the server and public-link
holders. Spending/viewing secrets remain outside the invoice server. PDF, email,
fractional quantities and editable drafts are deferred.
