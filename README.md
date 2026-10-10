# Meaw - private payments on Monad

Meaw lets freelancers and small businesses accept stablecoins through simple payment
links without exposing their full payment history on a public ledger.

Multi-asset Send, Requests, and managed links reuse the existing USDC, AUSD,
USDT0, and mUSD pools. Availability depends on each pool's capabilities. See
[behavior, migration, and activation evidence](docs/multi-asset-payment-flows.md).

Clients pay a link. Meaw turns that payment into a private note in a shielded
pool on Monad. The recipient can later withdraw to any Monad address, send it
privately to another Meaw user, or generate a disclosure bundle for
accounting, tax, bank, or audit review.

This repository is the testnet implementation. It contains the Solidity
contracts, zero-knowledge circuits, browser app, payment-link database, and
Privy authentication with user-owned embedded wallets.

## Monad Metropolis Hackathon

Meaw submits to the **Consumer Products & Payments** track ($30k, 3 winners of
$10k). The track asks for a consumer financial experience where the blockchain
stays invisible; Meaw's core flow — share a link, get paid, money lands in a
private balance — is exactly that, and payment mechanics settle on-chain
(deposit → shielded note → withdrawal) rather than being simulated.

Judging criteria and how Meaw answers them:

| Criterion | Weight | Meaw's answer |
| --- | --- | --- |
| Technical Execution | 20% | Real on-chain settlement: `MaweePool` holds USDC, verifies Groth16 proofs from the same zkey the browser uses, nullifiers prevent double-spends. |
| Design & Craft | 20% | Username onboarding, no seed phrase, no gas (relayer sponsors), QR/payment links a non-crypto client can pay from any EVM wallet. |
| Originality & Track Insight | 15% | Not a rebranded wallet: unlinkable deposit→withdrawal for freelancers who don't want their income public. |
| Founder & Market Readiness | 25% | Named segment — freelancers and small businesses invoicing in USDC who value payment privacy. |
| Traction & Path Forward | 20% | Testnet live; see [docs/hackathon.md](docs/hackathon.md) for the current status of each deliverable. |

Bounties claimed (track-agnostic, they stack):

| Bounty | Prize | Why it qualifies |
| --- | --- | --- |
| **Mera: One Passkey, Many Keys** (chosen) | $2,500 | The passkey's PRF output is HKDF-namespaced into *non-account* keys: the Poseidon note secret (`mawee.owner.v1`) and x25519 viewing key (`mawee.view.v1`). Nothing sensitive is persisted — secrets live in page memory only, so a fresh profile + the same passkey reconstructs the same keys. See [docs/reference.md](docs/reference.md#passkey-derived-keys-mera-prf). |
| **Best Use of Envio** | $1,000 | `indexer/` is an Envio HyperIndex powering note discovery, the anonymity set, and dashboard aggregates. |
| Privy | — | Used for sign-in and embedded wallets, but kept as authentication only; not claimed. |
| Alchemy | — | Optional relayer RPC only; not claimed. |

Full criteria, deliverables checklist, and demo plan live in
[docs/hackathon.md](docs/hackathon.md).

## What Meaw Protects

Public blockchains make payment relationships easy to inspect. If a business
uses one wallet for invoices, anyone can often see who paid, when they paid, and
how much revenue the wallet received.

Meaw breaks the direct link between the incoming payment and the later claim:

- A payment creates a note commitment in the pool, not a public recipient payout.
- The note details are encrypted to the recipient's viewing key.
- The recipient scans pool events locally and decrypts only notes meant for them.
- A later claim uses a zero-knowledge proof to show the note is valid without
  revealing which deposit created it.
- A nullifier prevents the same note from being spent twice.

Amounts are still visible when funds leave the pool. Meaw's current privacy
goal is unlinkability between deposit and withdrawal, not hidden withdrawal
amounts.

## How The System Works

```text
Recipient
  signs in with Privy (Google, email or passkey) -> embedded wallet on Monad
  claims @username
  publishes note key + viewing key in MaweeRegistry

Payer
  opens /pay/<username>
  resolves the recipient keys
  pays USDC from any EVM wallet into MaweePool
  creates an encrypted private note

Shielded pool
  stores only the note commitment in a Poseidon Merkle tree
  holds the USDC

Recipient
  scans Deposit events
  decrypts notes locally
  proves note ownership in the browser
  withdraws, transfers privately, or discloses selected payment evidence
```

The important idea: the pool can verify that a recipient owns a valid note, but
it does not learn which deposit event produced that note.

## Repository Map

- `contracts/` - Hardhat project.
  - `src/MaweeRegistry.sol` - maps `@username` to the owner address, Poseidon
    note public key, and x25519 viewing public key.
  - `src/MaweePool.sol` - shielded ERC-20 pool. Stores note commitments,
    maintains the Poseidon Merkle tree, verifies Groth16 proofs, releases
    withdrawals, and records nullifiers.
  - `src/verifiers/` - Groth16 verifiers generated from `web/public/zk/*.zkey`.
  - `test/` - end-to-end tests that generate real proofs with the browser
    artifacts and verify them on-chain.
  - `scripts/deploy.ts` - deploys everything and writes `web/.env.local`.
- `monad-zk/` - Circom circuits for deposits, withdrawals, shielded
  transfers, and note consolidation (merges).
- `web/` - Next.js app for onboarding, payment links, payer checkout, local note
  scanning, proof generation, withdrawals, and disclosure bundles.
- `indexer/` - Envio HyperIndex project: notes, nullifiers, withdrawals,
  accounts with key history, and pool/daily aggregates (anonymity set).

## Core Flows

### 1. Account setup

A user signs in with Privy, which provisions an embedded wallet on Monad. The
user then protects their privacy keys with a **passkey** (Mera PRF: the master
secret is derived from the passkey on each device and never stored) or a
**PIN** (a random master, encrypted under the PIN and escrowed). Note and
viewing keys are HKDF-derived from that master. The user claims a username such
as `@dinar`, registering the public keys in `MaweeRegistry`.

The note key lets payers create notes the user can spend. The viewing key lets
payers encrypt note metadata so only the recipient can discover their payments.

### 2. Payment links

The dashboard creates shareable payment links and QR codes. Link metadata lives
in MongoDB, but private note contents do not. A payer can pay a general username
link or a managed link with a fixed amount and label.

### 3. Payment

The payer connects an EVM wallet, approves the exact amount, and calls
`MaweePool.deposit`. The browser computes:

```text
owner_pk   = Poseidon(owner_secret)
commitment = Poseidon(amount, owner_pk, salt)
nullifier  = Poseidon(owner_secret, leaf_index)
```

A deposit proof binds the commitment to the public amount, so a payer cannot
create a note worth more than they paid. The contract stores the commitment as a
Merkle leaf and emits the encrypted note metadata in the `Deposit` event.

### 4. Wallet scanning

The recipient's browser reads deposit events and tries to decrypt each note with
the local viewing key. Notes that decrypt successfully appear in the dashboard.

The server indexer caches public event data and usernames for performance. It
does not need the recipient's private note secret.

### 5. Withdrawal

To claim a note, the browser builds a Merkle proof, generates a Groth16 proof,
and submits:

```text
root, nullifier, recipient, amount, proof
```

The pool verifies the proof with the EVM's BN254 precompiles, checks the root is
known, checks the nullifier has not been used, records the nullifier, and
transfers USDC to the destination. The recipient address is bound into the
proof, so a front-runner cannot redirect it.

### 6. Shielded transfer

The dashboard's **Send** button pays a registered `@username` directly from private
USDC balance, with an optional note encrypted for both participants. Fragmented
balance is consolidated automatically; a persistent pending operation can be
reopened after reload. History distinguishes outgoing sends, incoming payments,
and actual withdrawals without counting consolidation/change as income.
See [Direct transfer operations](docs/direct-transfer-operations.md).

A note can be split into a recipient note and a change note without tokens
leaving the pool. Value conservation is enforced inside the transfer circuit.

### 7. Selective disclosure

A recipient can export evidence for a specific payment. The disclosure bundle
contains the note amount, salt, owner key, Merkle path, root, commitment, pool,
network, username, and timestamp. A verifier can recompute the commitment and
root to confirm that the disclosed payment existed without exposing the user's
full wallet history.

Download the PDF and companion JSON from History. The public `/verify` page checks
the JSON locally against the configured pool's confirmed historical block, without
login or proof upload. Username and generation time remain issuer-provided metadata;
the result proves note inclusion, not identity or invoice settlement. See
[receipt verification](docs/receipt-verification.md) for versions and RPC requirements.

## Privacy Model

What observers can see:

- A deposit commitment was added to the pool, and who paid it.
- A withdrawal happened for a visible amount and destination.
- A nullifier was used once.

What observers should not be able to link directly:

- Which username received a specific deposit.
- Which deposit funded a later withdrawal.
- Which private notes belong to a user unless the user discloses them.

What is intentionally not hidden yet:

- Withdrawal amount.
- Withdrawal destination.
- Timing patterns if users withdraw immediately after receiving funds.
- Without a relayer (no `RELAYER_PRIVATE_KEY`), the wallet that submits a
  withdrawal pays its gas and is visible on-chain. With the relayer, the
  relayer submits it instead.

## Prerequisites

New here? [docs/local-setup.md](docs/local-setup.md) walks through the whole
local setup, from a fresh clone to signing in.


- Node 20 or newer.
- pnpm 10 or newer.
- MongoDB for the web app's cached users, payment links, and indexer data.
- circom 2 and snarkjs, only if you rebuild the circuits.
- A funded Monad testnet key for deploying (MON from https://faucet.monad.xyz).

## Build And Test

```sh
pnpm install
pnpm contract:test            # Hardhat: registry + pool with real proofs
pnpm --filter web test
pnpm --filter web lint
pnpm --filter web build
```

## Deploy To Monad Testnet

```sh
DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:testnet              # USDC pool
DEPLOYER_PRIVATE_KEY=0x... ASSET=AUSD pnpm deploy:testnet   # add a pool for AUSD / USDT0 / MUSD
```

The deploy script:

- Deploys `MockUSDC` unless `USDC_ADDRESS` is set. With `ASSET` set, it adds a
  pool for that stablecoin next to the USDC pool, using `TOKEN_ADDRESS` or, on
  testnet, a fresh `MockStablecoin`.
- Deploys the Poseidon library, the Groth16 verifiers and `MaweePool` (admin =
  deployer unless `POOL_ADMIN` is set), and reuses the existing
  `MaweeRegistry`.
- Writes review candidates (pool manifest, web env, indexer config) to
  `.deploy-candidates/`. Live settings are never changed; copy
  `NEXT_PUBLIC_MAWEE_POOLS` into `web/.env.local` after reviewing.

## Web App

```sh
cp web/.env.example web/.env.local   # or run the deploy script first
pnpm --filter web migrate:up
pnpm dev
```

The app runs at `http://localhost:3000`.

Useful routes:

- `/` - landing and onboarding.
- `/dashboard` - private balance overview and Add funds.
- `/links` - manage payment links.
- `/withdraw` - withdraw to any Monad address.
- `/history` - local payment history.
- `/pay/<username>` - payer checkout.
- `/pay/<username>/<slug>` - managed payment-link checkout.

## Environment

The web app reads public configuration from `NEXT_PUBLIC_*` variables and
server-only secrets from plain variables. See `web/.env.example` and
[docs/reference.md](docs/reference.md).

Important server-only values:

- `MONGODB_URI` - MongoDB connection string.
- `CRON_SECRET` - bearer token that authorizes the one-minute pool-indexer
  request.
- `PRIVY_APP_ID` / `PRIVY_APP_SECRET` - server-only Privy token and wallet
  verification.
- `MONAD_LOGS_BLOCK_RANGE` - max block span per `eth_getLogs` call.
- `ENVIO_GRAPHQL_URL` - Envio HyperIndex endpoint; when set it replaces the
  `eth_getLogs` poller for wallet scanning and pool stats.
- `RELAYER_RPC_URL` - dedicated RPC for the relayer (e.g. Alchemy).
- `RELAYER_PRIVATE_KEY` - hot wallet for gasless mode. Users then only sign;
  the relayer submits and pays MON gas within the configured action and native
  budget limits. Required monetary policy must be configured before sponsorship
  opens. See [gasless allowance and rollout](docs/gasless-sponsorship-budget.md) and
  [docs/reference.md](docs/reference.md#gasless-relay).

Do not commit `web/.env.local`. The repository ignores `.env*` files except the
examples.

The production deployment schedules `/api/cron/pool-indexer` every minute. After
deploying a new pool, invoke that route once with
`Authorization: Bearer <CRON_SECRET>` and confirm it reports `status: synced`.
A chain or pool address change automatically clears and rebuilds the public
deposit/nullifier mirror; it never clears user keys or other collections.

## Deployed Contracts (Monad Testnet)

Chain id `10143`. All pools share the same verifiers and zkeys, and are
administered by `0xc7e8dc6fA065f85f9f9726dD9a299643c4991DC9`. The mock tokens
have 6 decimals, support EIP-2612 permit, and can be minted by anyone.

| Contract | Address | Deploy block |
| --- | --- | --- |
| MaweeRegistry | [`0xa3024964732bf324256c3dbb3be314e254cb6a70`](https://testnet.monadexplorer.com/address/0xa3024964732bf324256c3dbb3be314e254cb6a70) | — |
| MaweePool · USDC | [`0x7539d7585dbd7b49f23d23549d65cc995346838b`](https://testnet.monadexplorer.com/address/0x7539d7585dbd7b49f23d23549d65cc995346838b) | 69152788 |
| MaweePool · USDC (legacy, withdraw-only) | [`0xfdfcb53eeb148709510bbd4e7d164065605baea5`](https://testnet.monadexplorer.com/address/0xfdfcb53eeb148709510bbd4e7d164065605baea5) | 68160915 |
| MockUSDC | [`0x8912cd818eb3f69dc7eee43101349e332ec06c7a`](https://testnet.monadexplorer.com/address/0x8912cd818eb3f69dc7eee43101349e332ec06c7a) | — |
| MaweePool · AUSD | [`0x8b0015711517e2b2b7cdd430e11bc2a0e9cca092`](https://testnet.monadexplorer.com/address/0x8b0015711517e2b2b7cdd430e11bc2a0e9cca092) | 68589168 |
| MockStablecoin · AUSD | [`0x2079ff55905b71b6b1bd9675d49e319a7cd9b317`](https://testnet.monadexplorer.com/address/0x2079ff55905b71b6b1bd9675d49e319a7cd9b317) | — |
| MaweePool · USDT0 | [`0x166bf3e602e10a71a59b4a57aeb842fd12d71d9d`](https://testnet.monadexplorer.com/address/0x166bf3e602e10a71a59b4a57aeb842fd12d71d9d) | 68589289 |
| MockStablecoin · USDT0 | [`0xb14e77bd5d715195e222768446fddc2bc2a7b932`](https://testnet.monadexplorer.com/address/0xb14e77bd5d715195e222768446fddc2bc2a7b932) | — |
| MaweePool · MUSD | [`0x8df03a1b169dda861d633035b945a484bcf234ca`](https://testnet.monadexplorer.com/address/0x8df03a1b169dda861d633035b945a484bcf234ca) | 68589368 |
| MockStablecoin · MUSD | [`0x706fbe38d0806ef7092fa8e2582cad2841ec1494`](https://testnet.monadexplorer.com/address/0x706fbe38d0806ef7092fa8e2582cad2841ec1494) | — |

In the matching `NEXT_PUBLIC_MAWEE_POOLS` manifest every active pool is both
`requestCapable` and `transferCapable`. The first USDC pool predates the Merge
verifier, so it was replaced on 2026-10-08 and is now legacy: balances there can
only be cashed out (choose "Previous pool" on the Cash out page).

```sh
# web/.env.local
NEXT_PUBLIC_MAWEE_POOLS=[{"chainId":10143,"address":"0xfdfcb53eeb148709510bbd4e7d164065605baea5","deployBlock":68160915,"token":"0x8912cd818eb3f69dc7eee43101349e332ec06c7a","tokenDecimals":6,"depth":20,"confirmations":1,"role":"legacy","requestCapable":false,"transferCapable":false,"asset":"USDC"},{"chainId":10143,"address":"0x8b0015711517e2b2b7cdd430e11bc2a0e9cca092","deployBlock":68589168,"token":"0x2079ff55905b71b6b1bd9675d49e319a7cd9b317","tokenDecimals":6,"depth":20,"confirmations":1,"role":"active","requestCapable":true,"transferCapable":true,"asset":"AUSD","mintable":true},{"chainId":10143,"address":"0x166bf3e602e10a71a59b4a57aeb842fd12d71d9d","deployBlock":68589289,"token":"0xb14e77bd5d715195e222768446fddc2bc2a7b932","tokenDecimals":6,"depth":20,"confirmations":1,"role":"active","requestCapable":true,"transferCapable":true,"asset":"USDT0","mintable":true},{"chainId":10143,"address":"0x8df03a1b169dda861d633035b945a484bcf234ca","deployBlock":68589368,"token":"0x706fbe38d0806ef7092fa8e2582cad2841ec1494","tokenDecimals":6,"depth":20,"confirmations":1,"role":"active","requestCapable":true,"transferCapable":true,"asset":"MUSD","mintable":true},{"chainId":10143,"address":"0x7539d7585dbd7b49f23d23549d65cc995346838b","deployBlock":69152788,"token":"0x8912cd818eb3f69dc7eee43101349e332ec06c7a","tokenDecimals":6,"depth":20,"confirmations":1,"role":"active","asset":"USDC","transferCapable":true,"requestCapable":true}]
```

## Testnet Payment Notes

On testnet the pool assets are `MockUSDC` and `MockStablecoin` stand-ins for
AUSD, USDT0 and MUSD. Recipients pick an asset in the balance card's currency
menu and can mint test tokens for it from the dashboard's **Add funds** dialog. With the relayer enabled, payers only need
USDC (they sign a permit and a deposit authorization; no MON). Receiving never
requires the recipient to hold anything first.

## Production Work Still Required

This repo is testnet-stage. Before mainnet, Meaw still needs:

- A real multi-party trusted setup ceremony for production circuits.
- Independent security review of the contracts, circuits, and web flows.
- A multisig pool admin and monitoring for the indexer.
- Relayer hardening: fees or sponsorship limits, key management, monitoring of
  its MON balance.
- Mainnet USDC, Privy production apps, and a bank off-ramp integration.
- Clear compliance policy for disclosure, abuse handling, and
  jurisdiction-specific requirements.
