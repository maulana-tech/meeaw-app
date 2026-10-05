# Payment Requests Operations

This runbook covers preparing and reviewing a payment-request deployment. The
feature code and contract artifacts can be tested locally without deploying a
pool. Contract deployment, activating the new pool, and changing production
configuration are separate operational actions.

## What a deployment needs

- A Merge-capable MaweePool and its verifier artifacts on the target chain.
- A public `NEXT_PUBLIC_MAWEE_POOLS` manifest with exactly one active pool and
  every prior pool retained as legacy. Legacy pools stay withdrawable and
  cannot fund request payments.
- An indexer configuration that watches every pool in that manifest, with the
  existing Registry and a start block no later than the first deployment event.
- The request, relay-journal, and request-operation MongoDB indexes created by
  the checked-in migrations.
- A dedicated relayer key funded with the target chain's native gas token,
  `CRON_SECRET`, and an authenticated scheduler calling
  `/api/cron/request-payments` once per minute. The key and secret are server
  only; never put them in a `NEXT_PUBLIC_*` variable.

The scheduler reconciles the existing relay journal and submitted request
operations. It must keep running across app restarts. A pending transaction is
never released just because it is old: only an operation with no signed
submission can have its preparation reservation released after ten minutes of
inactivity.

## Prepare a candidate

Run tests and compile artifacts before considering a deployment. The deployment
script deploys contracts, then writes review files under the ignored
`.deploy-candidates/` directory. It does not edit `web/.env.local`, the live
indexer configuration, or production settings.

Provide `DEPLOYER_PRIVATE_KEY` and, for a real token, `USDC_ADDRESS` through an
approved secret mechanism. On testnet only, omitting `USDC_ADDRESS` deploys a
mintable `MockUSDC`. Mainnet deployment refuses to proceed without an explicit
USDC address. Do not use a wallet that holds real funds for testnet work.

Inspect all three generated files before activation:

- `pool-manifest.candidate.json` — the new active pool and retained legacy
  descriptors, including token, decimals, deployment block, and confirmation
  count.
- `web.env.candidate` — public web values only. Merge the reviewed public
  values into the target environment; do not replace an environment file that
  also contains server credentials.
- `indexer.config.candidate.yaml` — the selected chain's new start block and
  pool addresses, while keeping other configured chains and the Registry.

Independently verify the chain ID, deployed bytecode, pool token, administrator,
verifier addresses, and deployment blocks before using a candidate. Confirm
that every pool in the manifest is indexed and that the request-capable active
pool has the Merge verifier. Candidate generation is not evidence that the
chain deployment or application activation is correct.

## Activate after review

Activation is a separate step requiring explicit operational authorization.
Merge the reviewed `NEXT_PUBLIC_*` values into the deployment environment and
build the web application with the new manifest. Preserve all existing
server-only variables. Apply MongoDB migrations before serving requests, and
deploy/reload the reviewed indexer configuration. Verify the request cron
returns an authorized response and reconciles a harmless empty queue before
opening the feature to users.

Do not remove legacy pools from either the manifest or indexer during pool
rotation. A new pool does not migrate private notes or move tokens. Users must
withdraw and redeposit explicitly if they want to move a legacy balance, which
reveals the withdrawal and deposit addresses on-chain.

## Reconciliation and recovery

`Pending` remains the public status while preparation, broadcast, or chain
confirmation is unresolved. The API marks a request `Paid` only after it
verifies the relayer's journaled transaction, successful receipt, configured
confirmation count, pool address, calldata, spends, and the exact requester
commitment. If the RPC is unavailable or receipt evidence is incomplete, keep
the operation in reconciliation and let the cron retry it. Never submit a new
payment or clear an uncertain reservation by editing MongoDB directly.

Monitor the structured `[request-payments]` cron summary, relayer journal
health, MongoDB availability, and chain RPC. Logs must contain operation IDs,
phases, and transaction hashes only; never log decrypted amounts, notes, salts,
keys, or request envelopes. If the relayer is unavailable, requests remain
pending and payment submission is disabled until service is restored.

For an application rollback, keep the MongoDB records and relay journal intact,
keep every deployed pool discoverable, and disable new request creation through
the reviewed application configuration. Do not roll back a confirmed on-chain
payment or remove an indexed pool as a rollback shortcut.

## Local verification

The feature's local tests cover request encryption and authorization, durable
relaying, receipt verification, note consolidation, request-output recovery,
pool-scoped indexing, and the dashboard interactions. Local-chain test results
and testnet evidence must be reported separately. A passing local suite does not
mean a testnet pool has been deployed or activated.
