# Mawee indexer (Envio HyperIndex)

Indexes the Mawee pool and registry on Monad and serves them over GraphQL.
The web app reads it when `ENVIO_GRAPHQL_URL` is set:

- **Wallet scanning** — `Note` (encrypted note per leaf) and `Nullifier`
  rows feed the browser's local decrypt-and-match scan and Merkle proofs.
- **Privacy stats** — `PoolStats.anonymitySet` (unspent notes) is shown on
  the pay and withdraw pages.
- **Usernames** — `Account` with its `KeyRotation` history.

| Entity | What it is |
| --- | --- |
| `Note` | One per `Deposit` event (payments and transfer outputs) |
| `Nullifier` | One per `Spend`; links its `Withdrawal` when the spend paid out |
| `Withdrawal` | Recipient and amount of a withdrawal |
| `Account` / `KeyRotation` | Registry usernames and key history (`@derivedFrom`) |
| `PoolStats` | Global aggregates: notes, spent, anonymity set, withdrawals vs. shielded transfers, accounts, paused |
| `DailyStats` | Per-UTC-day activity |

## Run

```sh
pnpm install --ignore-workspace   # this folder is not part of the pnpm workspace
pnpm codegen
pnpm test                         # simulated events through the real handlers
ENVIO_API_TOKEN=... pnpm dev      # local: needs Docker; GraphQL on :8080
```

`pnpm deploy:testnet` in `contracts/` rewrites `config.yaml` with the new
addresses and start block.

## Deploy to Envio Cloud

1. Push the repo to GitHub and open https://envio.dev/app.
2. Install the Envio Deployments GitHub App on the repo.
3. Create an indexer with root directory `indexer` and config `config.yaml`.
4. Push to the selected branch; copy the GraphQL URL
   (`https://indexer.dev.hyperindex.xyz/<id>/v1/graphql`) into
   `ENVIO_GRAPHQL_URL`.
