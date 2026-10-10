# Official Agora AUSD support

Continue the approved Agora priority after activating local Mock AUSD. Prepare
the existing deposit, private-transfer and withdrawal flows to use Agora's
official Monad testnet token. No circuit or pool-contract behavior changes.

## Scope

- Share canonical Agora addresses and identify official AUSD by chain and token,
  never by the AUSD symbol alone.
- Add a deployment profile that pins AUSD and its official token, rejects wrong
  chains/conflicting token overrides and cannot silently deploy a mock token.
- Show official testnet funding guidance in Add funds and payer checkout. Retain
  existing mock mint controls; official AUSD must not call the mock mint method.
- Verify the existing gasless path uses the token's actual EIP-712 domain. The
  live token reports symbol AUSD but domain name Agora Dollar.
- Add a read-only preflight for official-token code, precision and permit domain,
  current manifest/indexer coverage and deployer availability.
- Document deployment/activation and legacy pool retention. Replacing the active
  AUSD pool leaves the mock pool withdrawal-only; pending invoices pinned there
  need a replacement before new payments.

## Execution and evidence

- [x] Write and run failing token-profile/funding-guidance regressions.
- [x] Implement shared constants, deployment profile and funding guidance.
- [x] Verify official permit-domain behavior and existing mock checkout behavior.
- [x] Run source types, scoped Biome, targeted web/contract tests and production
  build. Report browser/device limitations separately.
- [x] Run read-only live preflight. Deploy/activate only with an available,
  explicitly configured deployer wallet and a reviewed candidate preserving
  every indexed pool. Do not substitute the relayer key for a missing deployer.

Official sources checked on 2026-10-10:
[deployments](https://docs.agora.finance/developer/contract-deployments),
[permit support](https://docs.agora.finance/developer/advanced-erc-features).
Token: `0xa9012a055bd4e0edff8ce09f960291c09d5322dc` on chain 10143.
Faucet contract: `0xd236c18d274e54faccc3dd9dda4b27965a73ee6c`.
Faucet address is documented; its claim flow has not yet been exercised.

The user configured the dedicated deployer key during implementation. Deployment
and activation were completed after readiness/type/tests and review. The new pool
is `0xe19fc79a122a8314d43ac543bd72d27e6bf0d838`, creation block 69837052.
The old candidate initially recorded cached head 69837054; its metadata was
corrected from the verified receipt before activation. Future deployments use
the pool's matched successful creation receipt directly.
