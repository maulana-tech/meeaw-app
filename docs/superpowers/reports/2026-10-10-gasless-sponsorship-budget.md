# Gasless sponsorship verification

Branch: `feature/gasless-sponsorship-budget`; base `5d7917d` (`monad-migration`). Final implementation/review fixes: `7850436`. Initial implementation verification was local. No funded network transaction, live migration or deployment was performed. The subsequent authorized PR delivery is recorded below.

## Final review and corrections

One fresh whole-branch reviewer found four Important findings, no Critical or Minor findings. One fix pass addressed:

1. Unsigned ordinary failure and process-crash reservations: fenced release, preserved published signatures, fresh explicit retry.
2. Canonically reverted grouped cash-out: close terminal parent, retain paid fees and quota, verify the exact original child before releasing its private capture for a new batch.
3. Oversized or definitively rejected cash-out selection: validate before saving, replace a proven rejection, retain accepted or ambiguous admission.
4. Funding step capacity: count migrations, splits, merges and final payment before proving/submitting; respect captured operator limit and safely abandon an untouched private draft. Accepted or paid preparation cannot use cancellation.

Each behavior was reproduced in a failing regression before its correction. Focused regressions passed 33/33 in eight files; ordinary process-crash projection recovery passed 5/5. Exact-fit and one-over cases are also exercised in the Send and request orchestration tests.

## Initial feature verification

- Contracts: 48/48 passed on local Hardhat.
- Source TypeScript: passed.
- Full web coverage: 171/171 files, 656/656 tests; 11 escrow tests serial, all remaining 170 files / 645 tests with two fork workers. A file manifest confirmed no omissions. The final runs both exited 0.
- Local production build: pnpm build:local exited 0.
- Scoped Biome: 34 files, exit 0, no fixes required; git diff --check passed.

## Limits

Desktop/mobile visual captures are unverified. Browser tooling was unavailable; Computer Use stopped on browser URL confidence, and isolated headless rendering was automatically rejected as `blocked by policy`. No funded network validation or production rollout is implied. Runtime sponsorship is enforced; legacy injected test ports remain compatible. Native MON budgets, rather than USD pricing or paid tiers, remain the approved scope.

Local Mongo storage discovered during cleanup was preserved at `.superpowers/local-mongo/2026-10-10-gasless-sponsorship-budget` and remains available on `127.0.0.1:27017`. The nine `mawee` collections were retained; only collection metadata was inspected.

## Rulings

Ruling: use native PowerShell task brief/ledger/test adapters — installed Bash scripts have CRLF and fail set pipefail under the host WSL shell; preserve their identity, BASE, task boundaries and RED/GREEN evidence without editing plugin files — cost if wrong: helper bookkeeping must be corrected, no product change.

Task 1: Ruling: scoped typecheck uses explicit existing Node type roots while Task 2 import scaffolds are present — project resolution from ignored config differed from web tsconfig; preserve full branch typecheck at integration/final verification — cost if wrong: inter-task type drift will require correction before final delivery.

Task 3: Ruling: retain prepareAndSign only for legacy injected unit ports without a sponsorship port — runtimeSender always supplies the two-phase prepare/sign port and enforcement ledger; existing journal byte/fence regressions remain intact during consumer wiring — cost if wrong: callers outside runtimeSender need migration before final verification.

Task 7: Ruling: import legacy fees and holds into the anonymous subset conservatively — pre-feature journal entries do not preserve a verified Privy principal, so do not infer one from a withdrawal recipient or current wallet association — cost if wrong: guest sponsorship capacity may be reduced on the rollout day until UTC reset. Import never creates retroactive user quota charges.

Task 8: Ruling: retain explicit ordinary client click markers through unknown and sponsorship pause outcomes; clear only success or a typed canonical revert — a fresh user action after a confirmed failed transaction must be possible without reopening closed/cancelled tickets — cost if wrong: a wrongly classified terminal outcome could create another subsidized attempt; the HTTP field is emitted only after canonical settlement and limits still apply.

Task 8: Ruling: atomically reuse a live withdraw/legacy-transfer parent for the same validated business digest and principal, even if another browser supplies a different click marker — public proof replay must not reserve another shared allowance slot — cost if wrong: legitimate simultaneous submissions of an identical spend are treated as one action, which is the intended on-chain behavior.

Task 8: Ruling: visual desktop/mobile captures remain unverified — Browser plugin is unavailable; Computer Use stopped on URL policy confidence and the isolated headless Chrome render was then automatically rejected as blocked by policy. Stop browser automation rather than retrying around the rejection. Component behavior, accessibility roles and source checks continue — cost if wrong: a responsive visual defect may remain unseen until manual browser review. Controlled fixture files remain in the ignored task workspace for review.

Task 9: Ruling: overlap the single final read-only whole-branch review with final verification — implementation/docs are finished and the reviewer receives committed plus untracked final sources; the 170-file web suite is still running and no final passing claim is made — cost if wrong: any verification fix must be covered in the one prioritized fix pass and a fresh final suite before completion. This avoids leaving the user waiting through sequential review and checks.

Final: Ruling: reviewer declined desktop/mobile visual layout — component and source checks stand, captures remain unverified because automation was blocked — cost if wrong: responsive visual defects require manual browser review.

Final: Ruling: reviewer declined live Monad fee and treasury validation — local signed-byte/RPC-boundary and local contract evidence stand; funded smoke test, live migration and deployment remain outside authorization — cost if wrong: operational sizing or network-specific behavior needs correction before rollout.

Final: Ruling: reviewer declined legacy injected sender ports without budgets — preserve isolated historical test ports; runtimeSender always enforces sponsorship — cost if wrong: a newly introduced alternate production sender must be migrated before use.

Final: Ruling: reviewer declined USD pricing, paid tiers, new contracts/circuits and wallet-paid private Send/request — keep approved native-MON sponsorship scope — cost if wrong: expansion needs a separate design and implementation.

Final: Ruling: run the final web suite with one fork worker after the two-worker run exhausted available memory and explicit 30-second escrow tests timed out — observed free RAM was about 1.5 GB; keep test assertions and timeouts unchanged — cost if wrong: longer verification and a remaining regression will still fail rather than being hidden.

Final: Ruling: restart only the isolated localhost test Mongo with diagnosticDataCollectionEnabled=false — the original portable server exited from an unhandled ftdc exception; production/app configuration is unchanged and tests still use real standalone Mongo — cost if wrong: test telemetry is absent and any further DB crash must invalidate that run. Restart PID 36828, same task-owned binary/data/log scope.

Final: Ruling: partition final full web coverage into keys.test.ts serial plus all remaining 170 files with two fork workers — the only explicitly memory-sensitive escrow suite remains isolated, assertions/timeouts unchanged, and the complete fresh union must equal 171 files / 656 tests — cost if wrong: verification order differs from a monolithic run and any resource contention in the remainder must still fail. Keys 11/11 and withdraw/client 15/15 passed after the backwards-compatible failure-result correction.

Final: Ruling: preserve the unexpected mawee database before removing test scratch — metadata showed nine application collections, so gracefully stop and relocate the complete Mongo directory to .superpowers/local-mongo/2026-10-10-gasless-sponsorship-budget, exclude it from local Git, and restart on the same localhost port; no application records were read or deleted — cost if wrong: additional ignored local storage/helper remains, but application data is retained. Preserved helper PID 56632.

Final: Ruling: retain the ignored task scratch because automatic approval review rejected the path-verified recursive deletion as blocked by policy — stop cleanup without trying another deletion mechanism; source commits/tests/build are complete and the Mongo data was already preserved separately — cost if wrong: temporary verification files remain on disk.

## Authorized PR delivery

The user authorized pushing this feature and creating a pull request targeting the repository default branch, `monad-migration`.

- Fetched `origin` and merged its seven new commits through `0c0a195`; merge commit `c0a7d5d` had no conflicts. The feature was zero commits behind the default afterward.
- Preserved default-branch branding, asset controls, mascot, roadmap and `monad-zk` source-directory rename. Legacy generated `circuits/build` files remain untouched and locally excluded from Git.
- Installed the updated committed dependency lockfile without modifying it.
- After synchronization, 51/51 focused tests across 15 suites passed, including affected checkout/cash-out/asset UI, private Send/Pay notices, genuine request/transfer proof construction and sponsorship acceptance.
- Fresh source TypeScript, local production build and diff checks passed.
- Earlier complete feature verification remains 656/656 web tests and 48/48 local contract tests. Those full runs preceded default-branch synchronization; the post-sync evidence is the focused run above.
- Remote delivery creates a PR only; merging into the default or dev branch is not part of this request.