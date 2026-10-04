# Mawee - private USDC payments on Monad

Mawee lets freelancers and small businesses accept USDC through simple payment
links without exposing their full payment history on a public ledger.

Clients pay a link. Mawee turns that payment into a private note in a shielded
pool on Monad. The recipient can later withdraw to any Monad address, send it
privately to another Mawee user, or generate a disclosure bundle for
accounting, tax, bank, or audit review.

This repository is the testnet implementation. It contains the Solidity
contracts, zero-knowledge circuits, browser app, payment-link database, and
Privy authentication with user-owned embedded wallets.

## What Mawee Protects

Public blockchains make payment relationships easy to inspect. If a business
uses one wallet for invoices, anyone can often see who paid, when they paid, and
how much revenue the wallet received.

Mawee breaks the direct link between the incoming payment and the later claim:

- A payment creates a note commitment in the pool, not a public recipient payout.
- The note details are encrypted to the recipient's viewing key.
- The recipient scans pool events locally and decrypts only notes meant for them.
- A later claim uses a zero-knowledge proof to show the note is valid without
  revealing which deposit created it.
- A nullifier prevents the same note from being spent twice.

Amounts are still visible when funds leave the pool. Mawee's current privacy
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
- `circuits/` - Circom circuits for deposits, withdrawals and shielded
  transfers.
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

A note can be split into a recipient note and a change note without tokens
leaving the pool. Value conservation is enforced inside the transfer circuit.

### 7. Selective disclosure

A recipient can export evidence for a specific payment. The disclosure bundle
contains the note amount, salt, owner key, Merkle path, root, commitment, pool,
network, username, and timestamp. A verifier can recompute the commitment and
root to confirm that the disclosed payment existed without exposing the user's
full wallet history.

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
DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:testnet
```

The deploy script:

- Deploys `MockUSDC` unless `USDC_ADDRESS` is set.
- Deploys the Poseidon library, the three Groth16 verifiers,
  `MaweeRegistry`, and `MaweePool` (admin = deployer unless `POOL_ADMIN` is set).
- Writes the chain id, contract addresses, deploy block and USDC settings to
  `web/.env.local`.

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
  the relayer submits and pays MON gas. See
  [docs/reference.md](docs/reference.md#gasless-relay).

Do not commit `web/.env.local`. The repository ignores `.env*` files except the
examples.

The production deployment schedules `/api/cron/pool-indexer` every minute. After
deploying a new pool, invoke that route once with
`Authorization: Bearer <CRON_SECRET>` and confirm it reports `status: synced`.
A chain or pool address change automatically clears and rebuilds the public
deposit/nullifier mirror; it never clears user keys or other collections.

## Testnet Payment Notes

On testnet the pool asset is `MockUSDC`. Recipients can mint test USDC from the
dashboard's **Add funds** dialog. With the relayer enabled, payers only need
USDC (they sign a permit and a deposit authorization; no MON). Receiving never
requires the recipient to hold anything first.

## Production Work Still Required

This repo is testnet-stage. Before mainnet, Mawee still needs:

- A real multi-party trusted setup ceremony for production circuits.
- Independent security review of the contracts, circuits, and web flows.
- A multisig pool admin and monitoring for the indexer.
- Relayer hardening: fees or sponsorship limits, key management, monitoring of
  its MON balance.
- Mainnet USDC, Privy production apps, and a bank off-ramp integration.
- Clear compliance policy for disclosure, abuse handling, and
  jurisdiction-specific requirements.
