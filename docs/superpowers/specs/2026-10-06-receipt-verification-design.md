# Independently check a shared Mawee receipt

Date: 2026-10-06
Stage: written spec and implementation plan approved; inline execution authorized.
Inspected checkout: `feature/multi-asset-payment-flows`, `25b7664`.
Fetched default base: `origin/monad-migration`, `c707af0`.
PR #8 is merged. The inspected product files match `origin/monad-migration`.

## Intent and approved scope

Complete the existing selective-disclosure flow for freelancers, clients, and
accountants. A recipient of a shared receipt should be able to check the disclosed
note against a configured Mawee pool without signing in or seeing the owner's
remaining balance. The user selected PDF plus a separate JSON proof, with local
browser verification, and approved historical-block anchoring.

Success: the owner exports PDF and JSON from one verified disclosure. Another
person opens `/verify`, chooses the JSON, and sees whether its amount/commitment
and Merkle inclusion match a confirmed historical state of the correct pool.
Malformed or fabricated proofs fail. RPC outages and unavailable historical data
produce an unavailable result rather than a false accusation or success.

The result proves that the disclosed note commitment, amount, and recipient public
key were included in that pool at the anchored block. It does not prove an invoice
was paid, identify the payer, attest legal identity, demonstrate present possession
of a spending secret, or prove the note remains unspent.

## Existing evidence and the gap

- `lib/disclosure.ts` builds version-1 bundles and recomputes commitment and root.
  The verifier currently trusts the supplied path shape/directions and has no
  chain check. Matching a supplied root alone is insufficient evidence.
- `DiscloseDialog` scans a selected pool, builds the disclosure, and exports PDF.
  There is no JSON download or public verification page.
- `disclosurePdf.ts` prints the bundle in an appendix. Some existing copy claims
  ownership, verified ledger state, and recipient identity beyond the checks made.
- Pool mirrors carry `publishedBlock` and `publishedLeafIndex`. `ScanResult`
  currently omits those fields, so its Merkle path has no historical chain anchor.
- MaweePool exposes `currentRoot`, `nextIndex`, and `token`. Its recent-root ring
  expires as new leaves arrive. Checking `isKnownRoot` only at the latest block
  would wrongly make old receipts lose their verification path.
- Pool resolution already allowlists chain/address scopes and retains legacy pools.
  This work reuses those rules and the existing Poseidon/Merkle primitives.

## Product journey

### Export from History

The existing receipt action stays in History. An unlocked owner chooses a payment
and prepares its receipt. Preparation uses the payment's original scope, a healthy
contiguous mirror prefix, and its exact public watermark.

Before enabling the two download buttons, validate the bundle locally and match
its root and leaf count to the confirmed historical pool state. If the mirror is
behind, incomplete, or inconsistent, offer Refresh and rebuild from a new complete
snapshot. Do not attach a newer block to an older path or silently relabel a local
proof as chain verified. Historical-RPC failure leaves a retryable preparation
error; it does not export a version-2 receipt as verified.

PDF and JSON downloads use the same prepared immutable bundle. The PDF includes
the verification page address, a stable reference, and a full proof fingerprint
that can be compared with `/verify`. Its raw JSON appendix remains available.
Downloading either file does not create a server-side receipt record.

Changing account, locking, closing the dialog, or selecting another payment/pool
invalidates in-flight preparation and clears the downloadable bundle. An older
async result cannot populate a newer payment's receipt dialog.

### Public `/verify`

The page is accessible without Privy, wallet connection, unlock, or a signature.
The first screen asks the person to choose a receipt JSON file and explains that
the proof is checked locally. PDF upload is outside version one of this feature.

After selection, validate the file before expensive computation. Recompute the
commitment, inclusion root, reference/fingerprint, and displayed amount locally.
Only then request public chain metadata. Show the amount and configured asset,
network/testnet badge, proof fingerprint, checked block, and result. Advanced
details may expand to show the pool and commitment; they do not dominate the flow.

Result states:

| State | Meaning | Action |
| --- | --- | --- |
| Verifying | A validated proof is being checked | Choose another file or cancel |
| Verified on chain | Local proof and confirmed historical state match | Compare fingerprint with PDF |
| Invalid proof | Malformed data, broken math, or a conclusive chain mismatch | Choose another file |
| Unable to verify | Unsupported version/network/pool, missing archive data, insufficient confirmations, or RPC failure | Explain the reason and offer Retry where applicable |

Local-check and chain-check details remain distinct. A successful local check must
not display the overall green result when the chain check is unavailable. Changing
the file or retrying invalidates previous requests/results; an older request cannot
overwrite the currently selected proof. Removing the file clears its disclosed data.

## Proof versions and validation

Introduce a version-2 anchored bundle. Retain the existing version-1 fields and
representations where possible: pool, CAIP-2 network, leaf index, commitment/root
as decimal strings and unprefixed 32-byte hex aliases, integer amount, owner public
key, salt, Merkle path, optional username, and disclosure-generation timestamp.
Version 2 requires asset and token precision plus:

```text
anchor:
  blockNumber: nonnegative safe integer
  blockHash: 0x-prefixed 32-byte hash
  leafCount: positive integer, at most 2^pool.depth
```

The proof root must be the pool's `currentRoot()` at the anchor block, and leafCount
must equal `nextIndex()` at that same block. The target index must be below
leafCount. Derive network/pool metadata from the scoped configuration, not the
currently selected dashboard currency. Keep a legacy pool verifiable even though
it no longer accepts deposits.

Use a strict versioned parser with a maximum UTF-8 input size of 64 KiB. Validate:

- Supported version shape and bounded strings; unknown version is unsupported.
  Cryptographic decimal strings have at most 78 digits before BigInt parsing;
  amount strings have at most 20 digits. Bound username to 33 characters, network
  to 32, amountLabel to 80, and generation timestamp to 40. Addresses/hashes must
  have the exact lengths and formats appropriate to their fields.
- Amount is a positive uint64 integer string; all cryptographic scalar values
  lie within the BN254 scalar field before hashing.
- Path length equals the configured pool depth (20 for current pools), directions
  are 0/1, and each direction equals the corresponding leaf-index bit. Path
  arrays have identical lengths; indices are bounded by tree capacity.
- Decimal/hex aliases represent exactly the same commitment/root. Leading-zero
  decimal encodings are normalized by the schema/serializer before fingerprinting.
- Known-network pool addresses resolve to an approved scope. No arbitrary caller
  RPC endpoint, contract address, registry, or token is followed.
- For a known scope, asset and precision match its immutable configured token.
  Recompute display amount rather than trust `amountLabel`; a conflicting label
  is reported as invalid. Preserve legacy missing USDC metadata as described below.
- Username is bounded display text, not HTML or an authenticated identity claim.
  A valid generation timestamp remains issuer-supplied metadata, not a proven
  payment timestamp.

The fingerprint is SHA-256 of a deterministic serialization of the normalized
bundle, covering metadata and anchor as well as proof values. It is computed
outside the bundle to avoid self-reference. PDF and JSON derive the same reference
and fingerprint. This comparison binds those two artifacts to the same data;
it is not an issuer signature and does not certify a modified PDF's other prose.

Version-1 bundles remain importable. Apply structural/math validation, including
leaf-index/path consistency and alias matching. Missing asset/precision in an old
bundle may use the known USDC pool's descriptor; never invent metadata for an
unknown scope. Show "Local proof valid; historical chain anchor missing" as an
Unable to verify result, without a Verified on chain badge. The owner can reissue
an anchored receipt from History. Old PDFs remain documents; importing their raw
appendix requires extracting JSON outside this version's UI.

## Historical chain verification

Carry the public mirror watermark into ScanResult without losing it in request or
transfer recovery helpers. A disclosure must use a contiguous leaf prefix bounded
by that watermark. Verify the note's stored leaf equals its recomputed commitment;
do not merely compute a path for an unchecked target leaf.

Add a read-only public metadata query that accepts only approved pool scope and
bounded block number/hash. It must never accept amount, salt, owner key, proof
path, filename, file contents, or user identity. The response returns typed public
observations: actual RPC chain id, canonical block hash/number, pool root, nextIndex,
token address, token decimals, and confirmation status.

Read contract state at one block number. Compare the block hash before and after
the state reads so a reorg during verification cannot mix states. A hash changing
during the reads returns Unable to verify with a retry action. Verify the
configured token address and precision against that state's token. The block must
be at/after pool deployment, not in the future, and meet the configured confirmation
policy. Root, count, and block hash in the bundle must match the public observation.
Recompute the path locally and compare it against this independently read root.
Chain observations rely on the configured RPC provider; the indexer mirror alone
is not an authoritative anchor.

Do not rely on the latest recent-root ring, an indexer-reported root, or presence
of a commitment alone as a substitute for this anchored-root check. A changed
canonical hash, valid RPC state with a different root/count/token, or wrong index
is a conclusive mismatch. Transport errors, pruned history, unsupported historical
reads, and insufficient confirmations remain unavailable, not invalid.

Bound public-query concurrency/rate, RPC timeouts, and retries using existing
server patterns. Configure RPC endpoints through existing server configuration;
do not introduce a caller-controlled URL or unbounded event scan. No new blockchain
transaction, contract, circuit, verifier, or indexer schema is needed.

## Privacy and truthful receipt wording

The file contains intentionally disclosed details of one note. Process it in page
memory, without localStorage, IndexedDB, server upload, file-content analytics,
console dumps, or error telemetry containing the payload. Only public chain
coordinates go to the metadata query. Do not include disclosure data in a URL,
query string, or verification QR. Any QR/link points to the empty verification page.

A note public key in a valid commitment is not proof of the uploader's identity or
knowledge of the corresponding spending secret. Username remains explicitly
"Provided by receipt issuer". The viewer does not resolve registry ownership or
perform historical-key identity verification in this version.

Update PDF copy to state the checks actually performed. Remove unconditional
ownership/identity assertions and distinguish receipt generation time from note
inclusion time. Use the configured asset's name; do not label every asset USD Coin.
The PDF's verified snapshot describes the export-time check; the receiving person
uses `/verify` to recheck the JSON against the current canonical chain view.

No note secret, viewing private key, nullifier secret, or complete private history
is exported. A proof's note salt and public owner key remain intentionally disclosed
as in the current bundle. Do not compute or reveal current spending status.

## Scope boundaries

Included: anchored PDF/JSON export, strict browser parser/math verifier, allowlisted
public historical-state query, public verification UI, current/legacy pool handling,
version-1 import behavior, truthful PDF copy, docs, and focused regression evidence.

Excluded: PDF extraction, server-hosted receipts, share-by-id storage, receipt
signatures, automatic invoice settlement, sender/legal-identity checks, historical
registry-key attribution, recovery-key rotation, spending-status queries, new assets,
mainnet activation, contract deployment, and unrelated payment-flow refactoring.

## Acceptance and verification

1. Export one selected note into matching PDF/JSON. Their reference and fingerprint
   match the verifier, with correct asset, precision, pool, and block anchor.
2. A valid version-2 receipt verifies without account login or wallet interaction.
   No uploaded disclosure fields appear in requests, persistent browser storage,
   logs, or telemetry. File input works by keyboard and on mobile.
3. Reject changed amount/salt/owner key, changed siblings, wrong leaf index or path
   directions, field overflow, excessive file size, bad aliases, and inconsistent
   amount/asset labels. Unsupported pools/networks do not trigger arbitrary RPC calls.
4. Reject a self-consistent fabricated tree that never existed on chain. Reject
   a proof from pool A anchored to pool B, including equal leaf indices/amounts.
5. Real local-contract evidence: an old anchored receipt still verifies after more
   than 30 subsequent root updates; the latest `isKnownRoot` need not recognize it.
   Anchor reads match the original root and count at the historical block.
6. Missing historical data, RPC timeouts, insufficient confirmations, and a reorg
   are surfaced according to the result model. A positive result never persists
   after the selected file changes. Export-account/lock/pool races cannot expose
   the previous bundle.
7. Old version-1 bundles with and without USDC metadata retain local verification;
   they do not claim anchored chain verification. Existing PDF export consumers,
   disclosure math, Send/Requests, and recovery scans retain compatible behavior.
8. Receipt verification checks inclusion even if a note was later spent or the
   pool became legacy. It does not confuse inclusion with available balance.
9. Run relevant parser/crypto/service/UI/PDF regressions and real local-chain tests,
   TypeScript, scoped lint, and the supported Windows local production build.
   Smoke-test the public verifier unauthenticated and actual components at desktop
   and mobile sizes. Distinguish controlled RPC/transport, local-chain proof, and
   authenticated/live-testnet evidence; report limitations honestly.

## Delivery and self-review

This approval authorizes writing the spec, not product implementation. The next
stage is user review of this saved spec, followed by writing an implementation
plan and selecting its execution method. Preserve the preference for inline work
when that stage is reached. Do not commit, push, create another PR, migrate an
application database, deploy, or activate capabilities without authorization for
this new work; the previous feature's delivery authorization does not carry over.

Self-review: transport choice and historical-block approach match the approved
design. Public observations anchor private local math without uploading the file.
The same-block hash/root/count constraints address root rotation and indexing
watermarks. Unsupported/pruned data cannot become false green/red results. Legacy
compatibility and identity/ownership limits are explicit. No new product subsystem
beyond completing the existing receipt flow is included.
