# Monad Metropolis Hackathon

Meaw's submission notes: which track we're in, which bounties we claim, and
where each deliverable stands. This page is the checklist we work from —
the product docs live in [Quickstart](quickstart.md) and
[How Meaw Works](how-it-works.md).

## Track: Consumer Products & Payments

$30,000 USD, split evenly among 3 winners ($10,000 each).

The track's core question is *"what does a financial product look like when
onchain rails are leveraged as an advantage to design?"* It belongs to products
whose primary user is a consumer — someone who may not identify as a crypto
user — and whose core value is a financial experience rather than trading.

**Why Meaw fits.** The person we serve is a freelancer or small business that
invoices in USDC and does not want their income history public. The flow we
design around is not "use a shielded pool" — it is *share a link, get paid,
money lands in your private balance, cash out whenever*. The blockchain part
(the pool, the Merkle tree, the ZK proof) never surfaces in the UI: no gas, no
seed phrase, no chain jargon, and a payer can check out from any EVM wallet
with a QR code.

### How we answer the judging criteria

| Criterion | Weight | Our answer |
| --- | --- | --- |
| Technical Execution | 20% | Settlement is real and on-chain. `MaweePool` custody of USDC, Groth16 verification against the same zkey the browser proves with, nullifier-set double-spend protection, registry-published keys. Contract tests generate proofs from the browser artifacts and verify them on-chain. |
| Design & Craft | 20% | The "invisible blockchain" bar: username onboarding (`@dinar`), passkey or 6-digit PIN instead of a seed phrase, relayer-sponsored gas, shareable payment links and QR codes. A non-crypto client completes checkout without knowing what a wallet is. |
| Originality & Track Insight | 15% | Not a wallet with new branding. The product insight is unlinkability: a deposit and its later withdrawal cannot be tied together, so receiving money doesn't publish your ledger. Disclosure bundles cover the legitimate "prove it to my accountant" case. |
| Founder & Market Readiness | 25% | A named segment — USDC-invoicing freelancers and small businesses — with a specific pain point: public addresses make revenue, clients, and cash-out habits inspectable by anyone. |
| Traction & Path Forward | 20% | See the deliverables checklist below for user-testing status and the distribution plan we're submitting. |

### Deliverables

| Deliverable | Requirement | Status |
| --- | --- | --- |
| Project logo / graphic | JPG, JPEG, PNG or WEBP, max 3MB | Pending |
| Public GitHub repository | Fully accessible to `metropolis@hackathon.monad.xyz` | Pending (repo is private today) |
| Technical demo video | Max 3 minutes, live working product — not slides | Not recorded |
| Pitch video | Max 2 minutes — team, problem, why we build it | Not recorded |
| Live product link | Deployed on Monad testnet or mainnet, with access instructions for judges | Deployed to testnet; needs public URL + judge credentials note |
| Product advertisement (optional) | Max 30 seconds, not judged | Not recorded |

## Bounties we claim

Mobile implementation update (10 October 2026): the app includes a PWA manifest,
regular/maskable icons, static offline fallback, installation guidance and a
dashboard AUSD sending shortcut. This does not establish Agora eligibility or
real-device verification. Confirm the organizer's PWA/mock-token/onboarding and
stacking requirements before adding an Agora claim. See [mobile PWA](mobile-pwa.md).

Bounties are track-agnostic and stack on top of the track submission. We claim
two, and deliberately do not claim two others.

### Mera: One Passkey, Many Keys — $2,500 (chosen)

The bounty is for creative use of Mera's PRF for work that is *not* signing
blockchain transactions, judged on novelty, correct primitive use, and a
cross-device test.

- **The PRF namespace does non-account work.** One WebAuthn PRF ceremony
  (salt `sha256("mawee.prf.privacy-master.v1")`) yields a master that is
  HKDF-expanded into keys that never sign a transaction:
  - `mawee.owner.v1` — the Poseidon note secret that lets payers create notes
    only the recipient can spend.
  - `mawee.view.v1` — an x25519 viewing key that lets payers encrypt note
    metadata only the recipient can read.
- **Nothing sensitive is persisted.** Derived note and viewing secrets live in
  the page's memory only — never in localStorage, sessionStorage, IndexedDB,
  cookies or on the server. A reload re-locks the account; the same passkey
  re-derives byte-identical keys. The server holds only the credential id,
  transports and the viewing *public* key.
- **The cross-device test.** Sign in on a fresh browser profile (or clear site
  data mid-demo) and run the passkey unlock: the same keys come back, and the
  balance the account had on the other device is discoverable again.

Why this one and not the $5,000 Privy bounty: the Privy bounty requires
integration *beyond* authentication, and we intentionally keep Privy as
authentication and embedded-wallet signing only — our privacy keys are derived
from the passkey, not from Privy. Claiming Mera is the honest read of what we
actually built. See [Developer Reference](reference.md#passkey-derived-keys-mera-prf).

### Best Use of Envio — $1,000

`indexer/` is an Envio HyperIndex project that actually drives product
features, not an installed dependency:

- `Note`, `Nullifier` and withdrawal entities back local note discovery and
  the anonymity set shown on the pay and withdraw pages.
- Aggregates (`PoolStats`, daily series) power dashboard stats.
- `deposits.snapshot` publishes only a contiguous leaf prefix bounded by
  Envio's `_meta.progressBlock`, because Merkle proofs need every leaf — the
  schema design is non-trivial rather than a single-event token indexer.

Deliverable gap: a short demo of the data flowing end to end.

### Not claimed: Privy ($5,000)

Privy provides sign-in (Google, email, passkey) and the user-owned embedded
wallet on Monad. It is authentication infrastructure for us; the bounty requires
Privy-powered functionality beyond login, which we don't have and don't want to
overstate.

### Not claimed: Alchemy ($1,000 in credits)

Alchemy appears only as an optional `RELAYER_RPC_URL` for the gas relayer. That
is an RPC endpoint, not a meaningful integration.

## Demo plan

Invoice implementation update (10 October 2026): owner creation/list/void,
USDC/AUSD public checkout, canonical receipt verification and pool-indexer
reconciliation are implemented locally. This is implementation evidence;
physical-device and funded-testnet invoice demos still require verification.
See [Invoices](invoices.md).

The technical demo (≤3 min) walks one full loop against Monad testnet:

1. Sign in with a passkey, claim `@username`.
2. Second browser (or phone) pays the payment link — a private note appears.
3. Clear site data, reload, unlock with the same passkey — the balance
   reconstructs (the Mera stateless/cross-device test, live).
4. Cash out to a fresh wallet; show on-chain that the withdrawal doesn't link
   to the deposit.
5. Generate a disclosure PDF for one payment only.

The pitch video (≤2 min) covers the team, the freelancer-privacy problem, and
why on-chain rails make this possible now.

## Competition calendar

| Date | Milestone |
| --- | --- |
| Submission deadline | Check the [official hackathon page](https://monad.xyz) — treat it as the hard cutoff for repo access, videos and the live link. |

Update this row from the official schedule rather than trusting it from memory;
the deliverables checklist above is what must be finished by then.
