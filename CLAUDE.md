# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Mawee is a private USDC payments app on Monad (testnet). Payers deposit into a shielded pool via payment links; recipients scan, decrypt and spend notes with zero-knowledge proofs generated in the browser. See `README.md` for the product/privacy model and `docs/` (GitBook) for deeper reference — `docs/local-setup.md` covers first-time setup.

## Commands

pnpm workspace (`web`, `contracts`). `circuits/` (npm) and `indexer/` (own pnpm lockfile) are standalone packages.

```sh
pnpm install
pnpm dev                                  # Next.js on :3000
pnpm --filter web test                    # vitest run
pnpm --filter web exec vitest run test/notes.test.ts   # single test file
pnpm --filter web exec vitest run -t "name"            # single test by name
pnpm --filter web lint                    # next lint (eslint)
pnpm --filter web biome:check             # biome lint+format check (biome:fix to apply)
pnpm --filter web build
pnpm --filter web migrate:up              # migrate-mongo, reads web/.env.local (also migrate:status/down/create)

pnpm contract:test                        # Hardhat tests — generate real proofs from web/public/zk
pnpm --filter contracts abis              # compile + regenerate web/src/lib/abi.ts
DEPLOYER_PRIVATE_KEY=0x... pnpm deploy:testnet   # deploys all contracts, writes web/.env.local

circuits/build.sh                         # needs circom 2 + snarkjs; dev-only trusted setup
cd indexer && pnpm codegen && pnpm dev     # Envio HyperIndex (Node >= 22); pnpm test / pnpm typecheck
```

## Architecture

### Generated artifacts — don't hand-edit
- `web/src/lib/abi.ts` ← `contracts/scripts/export-abis.cjs` (run `pnpm --filter contracts abis` after changing contract ABIs).
- `contracts/src/verifiers/*.sol` ← `contracts/scripts/export-verifiers.cjs`, generated from `web/public/zk/*.zkey`.
- `web/public/zk/*` (wasm, zkey, verification keys) ← `circuits/build.sh`, which also re-runs the verifier export.

The browser prover, Solidity verifiers and contract tests must all use the same zkeys. Changing a `.circom` file means: `circuits/build.sh` → redeploy contracts → update env addresses.

### Contracts (`contracts/src`)
- `MaweeRegistry` — `@username` → owner address, Poseidon note public key, x25519 viewing key.
- `MaweePool` — holds USDC, Poseidon Merkle tree of note commitments, verifies Groth16 proofs for deposit / withdraw / transfer, records nullifiers. Encrypted note metadata is emitted in `Deposit` events.

### Web (`web/`, Next.js 15 App Router, React 19, Tailwind 4, tRPC 11, MongoDB)
- **Client-side crypto is the core**: `src/lib/` holds key derivation (`keys.ts`, `passkey.ts` — Mera PRF passkey → HKDF namespaced keys), note scanning/decryption (`notes.ts`), proving (`prover.ts`, snarkjs + `public/zk`), and flow logic (`deposit.ts`, `withdraw.ts`, `transfer.ts`, `disclosure.ts`). Note secrets live in page memory only — never persist them to localStorage or the server.
- **Server** (`src/server`): tRPC `appRouter` in `root.ts`; each domain is a module in `server/modules/<name>/` split into `*.router.ts` (maps domain errors → `TRPCError`), `*.service.ts` (logic), `*.schema.ts` (zod I/O), `*.errors.ts` (error classes). Follow this split when adding modules. `protectedProcedure` requires a verified Privy access token (Bearer header or `privy-token` cookie, see `context.ts`).
- **Env**: public vars validated in `src/env.ts` (`NEXT_PUBLIC_*`), server-only in `src/env.server.ts` (imports `server-only`). Add new vars to the zod schema and `.env.example`. `NEXT_PUBLIC_*` are baked at Docker build time (see `.github/workflows/deploy.yml` build-args).
- **Auth routing**: `web/middleware.ts` + `src/lib/auth-routes.ts` gate `(dashboard)` routes on Privy cookies, bouncing to `/refresh` when only a session cookie exists.
- **Pool mirror / indexing**: `/api/cron/pool-indexer` (Bearer `CRON_SECRET`) calls `syncPoolIndex` in the deposits service to mirror Deposit events and nullifiers into MongoDB via `eth_getLogs` (chunked by `MONAD_LOGS_BLOCK_RANGE`). If `ENVIO_GRAPHQL_URL` is set, scanning and stats read from the Envio indexer (`server/lib/envio.ts`) instead. A chain/pool address change auto-clears and rebuilds the mirror.
- **Gasless relay**: with `RELAYER_PRIVATE_KEY` set, users sign (permit / EIP-712, `lib/typedData.ts`, `lib/useGasless.ts`) and `server/modules/relay` + `server/lib/relayer.ts` submit and pay gas.
- **MongoDB schema changes** go in `web/migrations/` (migrate-mongo); production runs them as the `migrate` compose service before `web` starts.

### Tests (`web/test`)
Vitest, `node` environment by default (`DepositForm.test.tsx` uses happy-dom; add others to `environmentMatchGlobs` in `vitest.config.ts` if needed). `server-only` is stubbed; `@` aliases `web/src`. Use `test/renderWithTRPC.tsx` to render components that call tRPC.

### Deployment
Push to `main` → GitHub Actions builds the root `Dockerfile` image to GHCR and SSH-deploys `docker-compose.yml` (migrate → web → pool-indexer loop hitting the cron route every 60s, behind Caddy) to a Lightsail box. `ops/mongodb/` has the VPS MongoDB setup.

## Conventions
- Formatting: Biome (2-space, double quotes, organized imports).
- Commit messages in this repo are short imperative sentences (e.g. "Add gasless relay so users never need MON"), occasionally `feat:` prefixed.
