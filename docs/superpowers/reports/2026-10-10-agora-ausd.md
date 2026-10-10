# Official Agora AUSD integration

Branch: `feature/agora-ausd`, based on default branch commit `d8e3311`.
This report records local verification before Git delivery; the user subsequently
authorized commit/push and PR merges into the default and dev branches. A Monad testnet pool was deployed
using the explicitly configured deployer wallet and activated in local public
configuration. No mainnet or production-web deployment was performed.

## Implemented

- Canonical token identification by chain/address and six-decimal precision.
- A deployment profile pinning official AUSD, with no implicit mock fallback.
- Issuer faucet documentation and wallet refresh in Add funds and payer checkout.
  The existing mock mint button remains available only for mock pools.
- Manifest validation rejects mock minting/wrong precision for official AUSD.
- Read-only readiness uses the same strict manifest parser as the application,
  selected-chain indexer coverage, token/domain/separator reads and pool binding.
- A gated deployment launcher strips the relayer key. Read-only preflight receives
  only the derived public deployer address. Re-running after activation sends no
  deployment; before activation another candidate could still be deployed.
- Creation block now comes from the matching successful pool receipt rather than
  a cached head. Public metadata was corrected before activation.
- Public indexer configuration includes the new pool and all historical pools.
  Local USDC remains active; four historical pools are withdrawal-only.

## Testnet deployment evidence

- Official token: `0xa9012a055bd4e0edff8ce09f960291c09d5322dc`, chain 10143.
- New pool: `0xe19fc79a122a8314d43ac543bd72d27e6bf0d838`.
- Creation receipt: `0x8327afc1cd252451c6f0fbb349ce7d5cb384ae15123804cb6dff8adde8247037`,
  successful in canonical block 69837052.
- Registry reused: `0xa3024964732bf324256c3dbb3be314e254cb6a70`.
- Token/admin bindings read on-chain. Deposit, Withdraw, Transfer and Merge
  verifier runtime bytecode hashes match the project's compiled artifacts.
- The old Mock AUSD pool `0x8b0015711517e2b2b7cdd430e11bc2a0e9cca092` remains
  discoverable and withdrawal-only. No balances or invoice states were reset.
- Post-activation preflight reports `configurationReady: true`. The conservative
  reserve for another deployment exceeds the remaining deployer balance, so
  `readyToDeploy: false`; the active-pool guard correctly exits without a second
  transaction. This is not a failure of the activated configuration.

## Verification

- Web: 31 focused tests verified across five suites (29 combined input/UI/pool
  tests plus two gasless-domain tests). Existing managed-link act warning remains.
- Contracts: 14 focused tests passed across profile, strict readiness and
  deployment-candidate suites. They include chain confusion, duplicate active
  assets, legacy rules, multi-chain YAML and receipt-block regressions.
- The read-only reviewer identified a preflight chain-validation gap; it was
  corrected by reusing the real parser. A bounded recheck found no new
  Critical/Important issues and independently passed the three readiness tests.
- Web source types and deployment-script source types passed. Contract compile
  confirmed existing artifacts are current; contracts/circuits were not changed.
- Live preflight verified token/faucet code, precision, ERC-5267 domain named
  Agora Dollar, version 1, chain/address and matching DOMAIN_SEPARATOR.
- The deploy launcher was run again after activation: exit 0 and explicit
  no-deployment result.
- Final production build after official-pool activation passed, exit 0, with
  18 generated pages and middleware. Scoped Biome passed for 14 web/source/test
  and launcher files; the four new contract script/test files were formatted.
- Production HTTP checks passed for dashboard shell/client bundle carrying the
  official token/new pool and public stats for official AUSD, legacy Mock AUSD
  and current USDC. Running localhost:3000 also returned 200 for the new pool.
  Synthetic cookie presence was used only to retrieve the public dashboard shell;
  this is not an authenticated wallet or visual checkout test.
- Scanned 239 production browser JS files for the configured deployer/relayer
  private-key values: no matches. Private key values were not printed.
- When the user asked about disappearing USDC, live aggregate readings showed
  211 USDC in the old pool and zero in the current pool, both unpaused. This
  supports the pool-selection explanation but does not verify any user's private
  balance. The user asked to continue feature work; no withdrawal/migration was
  attempted. The guide now explains active-pool display and Previous pool access.

## Follow-up: local sponsorship configuration

The user subsequently authorized configuring gas sponsorship. Initial live
availability returned `configured:false`, `available:false`, reason configuration;
all policy variables were absent and the baseline was initializing. Relayer
balance was approximately 3.39 MON testnet.

Configured ignored `.env.local` with daily budget 2 MON, anonymous subset 0.5 MON,
per-action envelope 0.5 MON, retained balance floor 0.1 MON, maximum fee 200 gwei,
user/guest/shared action limits 20/20/100 and maximum 16 children. Other environment
settings and credentials were preserved.

Ensured only the three additive indexes from the existing sponsorship migration;
other pending migrations were not run and the migration changelog was not marked
as fully applied. Checked that the signed/unknown active journal transaction was
already canonically mined before calling the authenticated reconciliation cron.
Two bounded ticks completed the baseline without manually resetting records.

Final public availability: configured true, available true, reason null. Operator
report: baseline complete, zero used/held sponsorship budget, zero pending or
unresolved sponsorship actions and available budget 2 MON. Business reconciliation
still reports one unresolved relay and one request; sponsorship readiness does
not assert those separate historical business records are resolved. No new payer
payment was requested by this configuration task. Authenticated-user UI and a
funded payment remain separate verification.

## Follow-up: archived settlement blocked mock USDC minting

The user still received Gas sponsorship is temporarily unavailable when minting
MockUSDC after configuration. Live sponsorship availability was true. Three
faucet attempts had been cancelled without signing or fees. A legacy relayer
wallet slot remained unknown even though its receipt was canonical and its
financial settlement had already been closed/archived by baseline recovery.

Durable receipt recovery tried to settle that archived child again; the ledger
repository only looked in live actions and rejected the ticket as budget. Added
archived settlement validation: chain/action/child fences must match, the archived
action must be closed, the child settled with paid evidence, and the existing
reducer must validate hash, frozen transaction and identical canonical fee data.
Validation runs against an isolated state that is discarded; it cannot restore
reservations or charge the same cost/quota again.

- Two regressions reproduced the original error before the fix. One initial
  post-fix run had 36 passing cases and a fixture-only failure after successful
  recovery assertions. Corrected the shadowed fixture helper; bootstrap suite
  passed 7/7. Verified union: 37 tests across six focused sponsorship/relay suites.
- Source TypeScript and scoped Biome passed. Read-only review found no
  Critical/Important issue in the archive validation and concurrency handling.
- Final production build after the recovery fix passed with exit 0.
- Live authenticated reconciliation then confirmed the stuck relay and request,
  with zero unresolved entries reported. All nine historical relay rows are
  confirmed and the active relayer wallet slot is empty.
- Public availability remains configured true/available true/reason null. No
  fresh mint was sent by the assistant; a user retry is needed to establish
  success of a new mint transaction.
- Restarted the task-owned local dev server after verification. Its in-memory
  request windows reset naturally; persisted financial/quota records were not
  reset. The first HTTP check after restart timed out during cold compilation;
  this is separate from the verified pre-restart recovery/availability.
  The subsequent warmed check returned HTTP 200, available true and reason null.
- The user confirmed minting succeeded. A subsequent read-only chain check
  verified a canonical successful transaction
  `0x9c395ee5130ee8c5d405b0f7e88679960de27726dec0ea460d7ecdc2ca86548c`
  with a MockUSDC Transfer from the zero address for 100,000,000 base units
  (100 test USDC). This proves mock funding after recovery, not an official AUSD
  deposit/transfer/withdrawal journey.

## Limits

Faucet claiming, funded official-token deposit, private transfer, recipient
discovery and withdrawal have not been exercised. Pool creation is a live
transaction, but does not prove the complete payment journey. Physical-device
and browser visual verification remain unavailable; no alternate browser or
headless workaround was attempted after the prior localhost policy rejection.

See [operational guide](../../agora-ausd.md) for deployment, legacy funds and
replacement invoices. PWA acceptance and Agora bounty eligibility remain
unconfirmed. `.env.local` and deployment candidates are ignored; keys remain
outside versioned code and are never passed in command arguments.
