# Agora AUSD on Monad testnet

Meaw can use Agora's official test AUSD with its existing private deposit,
transfer and withdrawal contracts. This is testnet funding, not a mainnet or
cash-out integration. PWA acceptance and sponsor eligibility still need organizer
confirmation; token support alone does not establish bounty eligibility.

## Token and funding

Chain 10143 uses token `0xa9012a055bd4e0edff8ce09f960291c09d5322dc`.
It has six decimals, symbol AUSD and an ERC-5267 domain named Agora Dollar,
version 1. Gasless deposits read that domain from the token before signing permit.

The published faucet contract is `0xd236c18d274e54faccc3dd9dda4b27965a73ee6c`.
Add funds and payer checkout link to [Agora's deployment/faucet documentation](https://docs.agora.finance/developer/contract-deployments)
and offer a wallet-balance refresh. Fund the displayed wallet on Monad testnet
through the issuer's faucet before depositing. Official AUSD does not use the
mock mint method. Faucet claims are external and have not been automated.

Official source: [Agora permit support](https://docs.agora.finance/developer/advanced-erc-features).
Addresses and token domain were read on-chain on 2026-10-10. Mainnet AUSD remains
configured separately at `0x00000000efe302beaa2b3e6e1b18d08d69a9012a` on chain 143.

## Deployment and activation

The configured pool token is immutable, so Mock AUSD cannot change into official
AUSD. `TOKEN_PROFILE=agora-ausd` pins the canonical token and asset, refuses
conflicting overrides and cannot silently deploy a mock token.

Configure `DEPLOYER_PRIVATE_KEY` in ignored `web/.env.local` using a dedicated
wallet with MON testnet. Keep it out of Git and chat. The relayer key is separate.
Use Node 22 and installed project dependencies:

```powershell
pnpm --filter contracts build
pnpm --filter web agora:preflight
pnpm --filter web agora:deploy:testnet
```

Preflight uses the app's strict manifest parser and selected-chain indexer
configuration. It reads token code, precision, permit domain/separator, nonce,
published faucet code and deployer funding. Its child receives the public
deployer address rather than private keys. `readyToDeploy` and
`configurationReady` describe setup, not a successful payment.

The deploy launcher gates on preflight and writes review candidates under
`.deploy-candidates/`. It reuses the existing Registry and deploys the existing
library/verifiers/pool. A conservative fee reserve covers 30 million gas at the
current max fee; this is a funding check, not the charged amount. After activation,
the launcher recognizes an official active pool and sends no new deployment.
Before activation, running the launcher again can create another candidate.

Compare the candidate with current public configuration, verify pool
token/admin/verifier code on-chain and retain every historical pool. Copy only
public pool settings into the app env, add the new pool to the indexer and restart
or rebuild consumers of NEXT_PUBLIC variables. A production bundle must be
rebuilt; runtime env alone does not update its browser configuration. No private
key belongs in a deployment candidate.

## Existing funds and invoices

The previous Mock AUSD pool becomes legacy and withdrawal-only. Notes are not
converted into official tokens. Select Previous pool on Cash out to withdraw
them. USDC and other asset scopes remain separate.

The dashboard shows the selected active pool, not the sum across historical
pools. Switching to the current USDC pool can therefore show zero while notes
remain in the old pool. Unlock Cash out and choose Previous USDC pool to inspect
those notes. The server cannot verify your private balance from aggregate pool
holdings; this requires your account's viewing keys on your device.

Pending invoices pin their original pool and cannot accept a new payment after
that pool is retired. Create a replacement with a new invoice number. Already
broadcast payments can still be reconciled against the old pool; activation does
not reset invoice state. Keep the pool-indexer running for recovery.

## Demo evidence

Verify issuer faucet funding, deposit, recipient discovery, private transfer and
withdrawal with real Monad testnet receipts, then exercise the PWA on a physical
phone. Unit/component tests and configuration preflight do not prove these flows.
No settlement-time guarantee or bounty acceptance is inferred from them.
