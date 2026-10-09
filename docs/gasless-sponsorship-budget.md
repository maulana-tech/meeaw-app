# Gasless allowance and relayer budget

Gasless sponsorship is bounded by a daily action allowance and a native MON budget. A Send or request payment consumes one action, including its split, key-migration and merge transactions. A cash-out batch of up to 16 notes also consumes one action. Each mined transaction consumes native budget, including a reverted transaction.

The action unit is charged on its first canonical mined child. Admission reserves a unit and an action envelope; completion returns the unused envelope. Retries with the same parent reuse their journaled transaction and do not charge a second unit. A canonical failed ordinary transaction ends its click attempt; a later explicit click has a new retained marker. Different markers for the same active validated withdrawal/legacy-transfer intent share a parent.

## Configuration

Set these on the trusted server. The examples in `web/.env.example` are starting bounds, not measured production sizing.

| Variable | Example | Meaning |
| --- | --- | --- |
| `RELAYER_USER_ACTIONS_PER_DAY` | `20` | Actions per verified Privy user |
| `RELAYER_GUEST_ACTIONS_PER_DAY` | `20` | Actions per signature-verified public deposit payer |
| `RELAYER_ANONYMOUS_ACTIONS_PER_DAY` | `100` | Shared allowance covering guest traffic |
| `RELAYER_DAILY_BUDGET_MON` | `5` | Global native budget |
| `RELAYER_ANONYMOUS_BUDGET_MON` | `1` | Guest subset of the global budget |
| `RELAYER_ACTION_BUDGET_MON` | `0.5` | Maximum envelope per logical action |
| `RELAYER_BALANCE_FLOOR_MON` | `0.1` | Native balance retained by the hot wallet |
| `RELAYER_MAX_FEE_GWEI` | `200` | Maximum fee cap on newly signed transactions |
| `RELAYER_MAX_ACTION_STEPS` | `16` | Maximum children per action |

The daily, anonymous, per-action and fee bounds are required. Missing or invalid values pause new sponsorship. There is no unlimited fallback. Counts default to 20/20/100, the floor to 0.1 MON and the child bound to 16. Monetary values use integer wei internally, without exchange rates or floating-point accounting.

The limits reset at midnight UTC using MongoDB's clock. Outstanding reservations survive reset. Actual costs belong to the canonical mining block's UTC day. Lowering policy ceilings does not erase existing signed obligations; it can pause new admission or the next unsigned child. An existing action never silently increases its captured envelope.

On Monad the conservative charge is `gasLimit × effectiveGasPrice`, without relying on storage rebates. Local Hardhat fixtures use `gasUsed × effectiveGasPrice`. See [Monad gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing).

## Public callers and privacy

Optional authenticated context uses the verified Privy principal. A public deposit's payer receives a wallet allowance only after contract authorization preflight succeeds. Anonymous withdrawals and legacy transfers use the shared allowance; their destination is not treated as spender identity. Guest costs also count toward the anonymous native subset and the global budget.

The accounting ledger stores hashed calldata, bounded action/child metadata and decimal wei values. It does not store note secrets, decrypted amounts or raw IP addresses. Signed bytes stay in the existing fenced wallet journal. Public UI receives availability and safe allowance fields, not treasury balances, fee caps or another wallet's detailed usage.

## Recovery and rollout

1. Review and set the non-secret policy bounds, fund the existing relayer, and stop older application workers before replacing them. Do not mix writers that bypass the new admission gate.
2. Apply the additive `20261008200000-sponsorship-ledger.js` migration using the existing migration workflow. It adds indexes and has no TTL deletion of unresolved records.
3. Run the authenticated reconciliation cron. New admission remains `initializing` while bounded scans import chain-scoped wallet/send history, signed maximum liabilities and canonical costs. Repeat cron ticks until the baseline is complete.
4. Inspect the aggregate report, then exercise a separately authorized funded smoke test before live rollout. Local fixture and contract tests do not establish live treasury sizing or production readiness.

The cron performs baseline and fee recovery before ordinary business reconciliation. Recovery also works while monetary policy is missing, and does not need the relayer private key to inspect existing receipts. Legacy costs are conservatively attributed to the guest subset because the old journal does not preserve a verified Privy principal; they do not retroactively consume a user's action quota.

Signing/unknown transactions never expire solely because a timer elapsed. A retired wallet fence plus the absence of published bytes can release an unpublished allocation. A published signature remains held even when its history projection failed. Expiring a registry authorization does not release signed hot-wallet liability. Archival is repaired before authoritative entries are pruned.

Partial preparations remain discoverable through existing encrypted recovery records and retained privacy generations. Resume the same operation; do not replace an uncertain payment with a fresh payment. The interface preserves transaction hashes and offers status checks/resume during a sponsorship pause. Unknown availability never automatically invokes wallet-paid gas.

Before a private Send or request payment prepares its first child, the client counts migrations, merges, splits and the final payment against the captured action's step limit. Oversized funding asks for a smaller amount. An untouched draft can release its sponsorship and account capture with a fenced cancellation; an accepted preparation, signed child or paid step cannot use that path.

A definitive ordinary failure before signing cancels its unused envelope. Recovery can close an ordinary envelope with no signed child; the next explicit attempt gets a fresh fenced parent. Pending cash-out selections are retained after accepted or ambiguous admission, but a proven admission rejection can be replaced. A batch with all children canonically settled, including reverts, closes without erasing its fees or quota charge. An unspent reverted note can join a new batch only after the server verifies its exact original batch child settled as reverted and releases the previous account capture. Unknown children keep the original batch and signed bytes.

The authoritative ledger is a single CAS document per chain, compatible with standalone MongoDB: at most 256 active parents, 16 children per action, 4096 current-day principal counters and an 8 MiB preflight bound. Recovery uses bounded scans and a persisted cursor so later receipts are not starved by older unknown transactions.

## Read-only operator report

From `web`, with the existing server environment configured:

```powershell
pnpm run relayer:budget-status
```

The report shows native used/held/available budget, current caps, baseline state and unresolved counts. It uses direct Mongo aggregate projections and performs no ledger mutation. It omits private principals, serialized bytes, recovery material, signing keys, credentials and RPC/database URLs. Inspect or tune these bounds on the trusted host; they are not user-facing fee estimates.

## Verification scope

Tests use isolated local Mongo databases and RPC boundaries with real signed bytes. They cover concurrent admission, cancellation/signing fences, canonical fee evidence, lost projections, legacy import, reset/reload, smaller-policy refusal, service funding steps and UI session guards. No funded network transaction, live migration, deployment, mainnet activation or remote merge is implied by local verification.
