# Gasless action quotas and relayer budget

Date: 2026-10-08
Stage: design direction agreed; written spec awaiting review.
Base: `monad-migration`, `5d7917d`, matching fetched origin. Design branch:
`feature/gasless-sponsorship-budget`.

## Intent and agreed choices

Users retain the gasless payment experience while Meaw can bound the cost of
sponsoring it. The user delegated the quota model and accepted the recommendation:
one user action consumes one quota unit, while every on-chain step consumes gas
budget. The first version accounts in native MON, without a USD price feed.

Success means restart, concurrent workers, retries, and uncertain submissions
cannot reset limits or charge an action twice. Limits concern the relayer's gas;
they never deduct from the user's private token balance.

## Alternatives considered

1. Count each on-chain transaction. Straightforward but fragmented balances and
   retained key generations consume more user quota for the same payment.
2. Count user actions only. Clear for users but insufficient to bound gas expense.
3. Count actions with separate cost reservations and ceilings. Selected: internal
   preparation is included, and aggregate sponsorship remains bounded.

## Product behavior

- One Send, one request payment, one deposit, one registration, one key rotation,
  one faucet claim, and one cash-out action each consume at most one action unit.
  Cash-out-all is one action containing bounded child withdrawals. Direct calls
  to the legacy public withdrawal/transfer APIs remain individual actions.
- Internal merges, key migration/splits, and the final payment share the parent's
  sponsorship action. Reopening/retrying that parent does not create a new unit.
- Quota is reserved at admission and consumed once when the first child has a
  canonical confirmed receipt, including a revert: actual gas sponsorship occurred.
  A later failed final payment does not erase the cost of completed preparation.
- Known unsigned abandonment returns quota and unused budget. Signed/unknown work
  retains its reservation. Time elapsed alone never proves it safe to release.
- Insufficient quota, budget, or relayer balance prevents new work before signing
  or broadcasting. Quote/admission occurs before internal fund preparation begins.
  A changed fee estimate that cannot fit an admitted envelope pauses the next
  unsigned step; it never permits overspending or automatic extra sponsorship.
- Paused operations retain their ID and recoverable prepared notes. Budget denial
  is not translated into a generic terminal payment failure or a fresh attempt.
- User UI shows available action quota, pending reservations, reset time, and a
  useful unavailability reason. No private note amount is needed for accounting.
- No automatic switch to charging the user's wallet when sponsorship runs out.
  An explicit wallet-gas option may use already-supported wallet paths; adding
  wallet settlement to app Send/request workflows is outside this version.

## Principals and public checkout

Verified Privy context identifies authenticated callers, including public routes
when a verified optional session exists. Never trust a user ID in the request body.

Guest deposits retain the existing any-wallet checkout. Their signed payer wallet
is verified before assigning a per-wallet guest quota. A common anonymous allowance
also bounds all guest actions. Anonymous withdrawal/legacy transfer proofs do not
prove the spender's account identity, so they use the common anonymous allowance;
do not treat the destination wallet as the spender or require a new owner signature.

All guest costs consume both the anonymous gas sub-budget and the global budget.
Dropping an auth token, changing wallets, or changing IP cannot bypass the global
cost ceiling. Existing short-window IP/request rate limits remain an additional
control; they are not claimed to identify unique people. No raw IP is added to
the sponsorship ledger.

## Policy and rollout

Daily windows reset at 00:00 UTC; clients display the reset in local time. The
ledger uses MongoDB server time for admission/rollover and never rolls backwards;
clients cannot provide the accounting day. Monetary
values are exact integer wei; no JavaScript floating-point monetary counters.

The server validates configurable limits. Initial example settings, subject to
operator calibration rather than an assertion about production gas costs:

| Setting | Initial example |
| --- | --- |
| Authenticated actions per day | 20 |
| Guest payer-wallet actions per day | 20 |
| Shared anonymous actions per day | 100 |
| Global daily accounted gas ceiling | 5 MON |
| Anonymous daily sub-ceiling | 1 MON, within the global 5 MON |
| Maximum cost envelope per action | 0.5 MON |
| Maximum sponsored on-chain children per action | 16 |
| Relayer balance floor | 0.1 MON, in addition to outstanding liabilities |

Global budget, anonymous sub-budget, per-action envelope, and fee-price ceiling
must be configured explicitly before new sponsored work is enabled. Validate
positive limits, anonymous <= global, action <= global, and bounded child counts.
Absent/invalid policy pauses new sponsorship; it does not restore unlimited relay.
The fee ceiling is operator-configured in native gas-price units. Existing signed
transactions must still be reconciled when new admissions are paused.

A cash-out batch or funding plan exceeding the action limits is rejected before
any child is sent. UI explains the limit so users can choose a smaller action.
Changes to limits block new allocations if outstanding reservations already exceed
the new allowance; they never revoke previously signed transaction liabilities.

No live environment, funded wallet, deployment, or mainnet activation is changed
by implementing this spec. Additive migration and policy configuration form a
separate rollout operation.

## Cost reservation and fee rules

An action reserves its configured maximum cost envelope, bounded by the global
and applicable anonymous allowance. Each child allocates a portion of that same
envelope; no additional user quota is charged. Server-controlled gas estimation,
fee caps, action-kind allowlists, and step bounds constrain each child. Unused
envelope capacity is released only when the parent safely closes or abandons it.

Use the actual frozen transaction gas limit and gas-price ceiling for maximum
liability, with transaction value constrained to zero for current relay methods.
Validate signed bytes against that allocation before allowing broadcast. Never
reprice or re-sign an already persisted unknown transaction to make it fit.

Monad charges using gas limit and effective price, not Ethereum's unused-gas
assumption. Account conservatively at gross `gasLimit * effectiveGasPrice` for
Monad, without spending storage rebates before they are known. Local Hardhat
tests use their actual Ethereum-style receipt fee rule. Distinguish accounted
gross cost from net wallet balance changes in operator reporting.

Receipt settlement verifies hash, signer/chain/transaction bounds, canonical block
identity and confirmation depth. A revert still costs gas. Duplicate callbacks
or reconciliation runs cannot settle or release a child twice.

Confirmed cost belongs to the receipt block's UTC day. Outstanding liabilities
survive rollover and reduce the new day's available budget until resolved.
Reserved quota for an action with no mined child also survives rollover; once
charged on its first mined child, continuing it does not charge another day/unit.

## Persistence and concurrency

MongoDB remains standalone-compatible. Do not depend on replica-set transactions.
One authoritative ledger per chain owns current-day counters, outstanding action
and child allocations, quota reservations, fences, and settlement markers. CAS
updates atomically enforce both monetary and applicable quota invariants.

Bound active entries to 256 actions, 16 children per action, and 4,096 current-day
principal counters. Keep signed bytes/calldata in the existing journal, not in
these bounded ledger entries. Bound action/child entries and principal counters so the ledger remains
below MongoDB's document limit. Full capacity refuses new admission safely.
Archived action/receipt projections support history and retries. Write recoverable
terminal history before removing authoritative entries; projection failure keeps
repairable entries and does not create a second charge. UTC rollover preserves
active reservations and charged-action markers while archiving previous totals.

An operation binds server-derived principal, chain, action kind, business identity,
policy revision, parent action ID, child IDs, and exact transaction digest. Caller
parameters cannot replace these bindings after admission. Retrying a projected
action checks the authoritative record and returns the same admission.

Unsigned release and signing/dispatch are mutually fenced. A stale signer or
worker cannot broadcast after cancellation, reuse a released allocation, or
release another worker's reservation. Any uncertainty about persisted signed bytes
or publication keeps the allocation until reconciliation establishes the outcome.

## Integration boundaries

1. A sponsorship policy/ledger service owns admission, quota status, allocation,
   settlement, safe cancellation, rollover, and bounded projection repair.
2. `runtimeSender` is the enforcement boundary for every new signed relay, not
   only the public relay router. It integrates reservations with the existing
   fenced wallet journal and stores enough context for cron recovery.
3. App Send/request/rotation operations carry a stable sponsorship parent. Internal
   preparation and the final transaction allocate children of that same parent.
4. Ordinary relay requests get stable business identities instead of a new random
   ordinary ID on every HTTP retry. Validation/preflight checks existing recorded
   results before repeating a spent nonce or signing another transaction.
5. Cash-out-all admits its batch before the first withdrawal; individual children
   retain existing account tickets, proof ownership and pool scope.
6. The existing reconciliation cron repairs sponsorship as well as wallet/spend
   journals. Status polling, receipts and reconciliation are not new paid actions.
7. Public status separates relayer configuration from current availability;
   authenticated quota status only reveals the caller's allowance. Operator
   reports/logs expose aggregate budgets and unresolved liabilities, not secrets.

All signed transactions pending at rollout are imported as legacy liabilities
before new admission. Do not bill users retroactive quota for pre-feature work.
Seed current-day accounted costs from existing journal receipts with bounded,
restart-safe scanning. Until that baseline is complete or proven empty, admission
stays paused. Direct user-paid transactions are outside sponsorship accounting.

## User interface and errors

A small gas-sponsorship section in Settings displays available/reserved/used action
quota and local reset time. Existing review/payment dialogs explain that internal
preparation is included and surface quota exhaustion, gas-cost ceiling, low balance,
or temporary unavailability before work begins.

Keep structured budget errors through relay and operation services; generic relay
error wrapping must not turn them into an ambiguous retry. Error messages omit RPC
credentials, identity tokens, wallet secrets and encrypted recovery transports.
Ordinary status caching cannot conceal a changed quota/budget or silently trigger
a user-paid transaction. Refresh availability for each attempted action; admission
on the server remains authoritative.

## Verification requirements

- Isolated real Mongo races for last quota slot, last budget allocation, guest/global
  sub-ceilings, cancellation versus signing, stale workers, and bounded capacity.
- Exact monetary arithmetic, policy validation, UTC rollover, delayed receipts,
  reserved carryover, failed transactions, lost responses and projection repair.
- One Send/request action containing merges and key migration consumes one unit;
  all gas consumes its envelope. The parent pauses and resumes without a new charge.
- Existing ordinary retry payload, duplicate callbacks and replayed API responses
  reuse one admission and transaction; altered principal/digest/child rejects.
- Invalid proofs/signatures before signed dispatch do not consume used quota.
  Signed unknown work cannot be released by an elapsed timer.
- All runtime sender paths are covered: registry, deposit, withdraw, legacy transfer,
  faucet, app Send, request payments, and privacy-key rotation. Public checkout
  continues without forced sign-in and receives the same global cost enforcement.
- No configured policy and legacy-baseline initialization pause new work while
  existing signed transactions can still be reconciled.
- Latest local production build/typecheck, focused/full web suites, existing local
  contract regressions, and desktop/mobile UI evidence. No live funded writes are
  needed for tests. No production/mainnet readiness claim follows from local tests.

## Excluded from this version

USD price conversion, subscriptions/paid tiers, charging users sponsorship fees,
bank off-ramp, activation of additional assets, an admin dashboard, relayer key
rotation, new contract/circuit deployments, and adding wallet settlement to app
Send/request workflows.

## References

- Existing roadmap: `README.md`, Production Work Still Required.
- Existing sender/journal: `web/src/server/lib/durableRelayer.ts` and `relayJournal.ts`.
- Existing public/authenticated relay boundaries: `relay.router.ts`, `context.ts`.
- [Monad gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing).
- [Monad reserve balance](https://docs.monad.xyz/developer-essentials/reserve-balance).
