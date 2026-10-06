# Direct private transfers: implementation and verification

Date: 2026-10-06. Delivery branch: `feature/private-direct-transfers`, based on
`monad-migration`. Verification below covers the implementation prepared for PR;
production deployment and pool activation remain outside this delivery.

## Delivered behavior

- Send on the balance card opens username, USDC amount, and optional-note input,
  recipient review, then recoverable progress.
- Signed intents and both participant envelopes bind the active pool and fixed
  recipient output. Amount and note are encrypted; private keys stay in memory.
- Fragmented balance uses the existing Merge/split/transfer circuits. Shared
  fenced spend claims integrate with request payments and ordinary withdrawals.
- Pending operations survive closing/reloading. Only the exact confirmed
  transaction produces confirmed status; uncertain broadcast keeps identical bytes.
- History shows Sent/Received/actual cash-out, suppressing consolidation and change.
- Accepted steps live in a separate uniquely indexed collection. Sender recovery
  uses batched encrypted evidence and account-scoped caches; recipients with an
  already-discovered note do not fetch sender step data.

## Evidence

| Check | Result |
| --- | --- |
| Web suite: `pnpm test -- --maxWorkers=2` in `web/` | 100 files, 386 tests passed |
| Contracts: `pnpm exec hardhat test` in `contracts/` | 39 tests passed |
| TypeScript: `pnpm exec tsc --noEmit -p tsconfig.json` in `web/` | Passed |
| Scoped Biome on new feature/API/UI units | 26 files, no errors or warnings after cleanup |
| Review regression suites | 15 tests passed after observing the failures first |
| Final typed-guard focus: operations/recovery/activity | 11 tests passed |
| Final UI/session/recovery focus | 12 tests passed |
| Browser visual fixture | Default, 390x844, 1280x800; input/review, Back retention, zero-amount rejection, Escape dismissal/focus return |

Real cryptography tests decrypt for both participants and reject altered metadata.
Browser proving artifacts generated a real transfer proof delivering 20 USDC and
returning 5 privately. The local Hardhat lifecycle verifies 10 + 15 consolidation,
one fixed-recipient payment, rejection of another valid payment to that commitment,
and the recipient spending the received note. Mongo tests use isolated local
databases. Injected transport/receipt tests verify failure handling separately.

The first full web run exposed stale optional-wallet mocks and an unrelated cold
configuration-import timeout. Affected fixtures were corrected without changing
production auth behavior; the complete rerun passed.

## Independent review and fix pass

One fresh reviewer inspected the entire uncommitted change. All five actionable
findings were addressed with regression evidence:

1. An expired signer cannot release a replacement worker's spend claim: cleanup
   first CAS-abandons its own exact journal fence.
2. Missing source ciphertext cannot turn sender change into income: confirmed
   outgoing transaction identity suppresses its owned outputs, and verified
   sender recovery marks preparation/change outputs internal.
3. Recovery does not request per-record sender evidence for recipient history:
   500 already-discovered recipient payments use 25 list pages and no sender batch.
   Sender evidence is batched/cached, with completed cursor progress retained.
4. Resume shares submission throttling: the 21st attempt within its budget fails.
5. Step ciphertext cannot grow the main transfer document past Mongo's document
   limit: immutable steps are stored and paginated separately.

No independent second review was performed; fixes were checked by the executor
with RED-to-GREEN regressions, the full web suite, and focused final checks.

## Rulings made during inline execution

- Work in the existing clean tracked feature checkout. Cost if wrong: shared
  branch work is less isolated; implementation stayed uncommitted until delivery
  was authorized and prepared on its own feature branch.
- Retain the ignored execution ledger. Cost if wrong: local scratch remains;
  without authorized commits, deleting it would erase verification history.
- Coordinate at the common durable relay boundary using relayer/pool ownership
  and scoped nullifiers. Cost: pool spending is serialized; sender/pool intent
  uniqueness is separately enforced by a transfer index.
- Recover unsigned expiration through journal fences, never silent replacement.
  Cost: unavailable recovery can temporarily block an unsigned spend.
- Reuse the pure Requests pool codec/evidence adapter, while keeping transfer
  signatures and persistence separate. Cost if wrong: protocol coupling; existing
  request tests and real contract proofs cover compatibility.
- End idle preparation after 24 hours only without an accepted submission.
  Cost: an abandoned attempt needs a fresh intent; confirmed owned outputs remain.
- Reuse the existing verified isolated Mongo test helper. Cost: database naming
  differs from the plan's proposed prefix; application data remains untouched.
- Repair stale wallet mocks and isolate the Privy configuration test from the
  unrelated RPC/prover import graph. Cost: configuration tests do not establish
  real Privy authentication; that remains a separate verification boundary.
- Use an isolated localhost UI fixture for visual/keyboard inspection. Cost:
  screenshots establish UI behavior, not authenticated payment settlement.
- Do not infer authenticated Privy/testnet, fresh-profile browser recovery, or
  standalone readiness from local tests. Cost: those scenarios need further
  environment-backed verification before claiming them.
- Preserve Windows security settings and production standalone configuration.
  Cost: Windows symlink permissions can prevent standalone artifact packaging.

There are no deferred minor findings from the independent reviewer.

## Limits and operational handoff

### Windows build alternative

`pnpm build:local` uses the normal Next.js Node-server output in
`web/.next-local/`. A successful local build and production-server smoke check
returned HTTP 200 for `/` and HTTP 401 for an unauthenticated transfer API read.
Run it with `pnpm --filter web start:local --hostname 127.0.0.1 --port 3010`.
The deployment default remains standalone; the local mode needs installed
workspace dependencies. It does not establish authenticated payment E2E evidence.

An authenticated two-user Privy/browser/testnet run and a real fresh-profile
browser recovery demonstration were not performed. The browser fixture clearly
labels synthetic data and does not sign or send transactions. The contract and
injected-service tests do not substitute for that authenticated browser evidence.

Production compilation/type checking/static-page generation completed in both
build runs, including the final source. Standalone artifact packaging failed
with Windows `EPERM` on symlink creation in both runs; the build command exited
nonzero. Standalone packaging is not verified.

The local public manifest was checked: active pool, request/merge-capable, Monad
Testnet chain 10143. No new contract deployment is needed for this implementation.
Use [Direct transfer operations](direct-transfer-operations.md) for migrations,
worker configuration, privacy boundaries, and pending-send recovery.
