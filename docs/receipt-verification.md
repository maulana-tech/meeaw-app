# Verify a shared receipt

From History, an unlocked account can prepare a receipt and download its PDF and
JSON proof. Both files come from the same prepared bundle and carry the same
reference/fingerprint. Preparation checks the selected note against the original
pool's confirmed historical snapshot before downloads become available.

Open `/verify` without signing in and choose the JSON shared with the PDF. Compare
the complete `sha256:` fingerprint with the one printed in the PDF. The fingerprint
binds the proof data and issuer metadata; it is not an issuer signature or a
certificate that the PDF's other text is genuine.

## Results

| Result | Meaning |
| --- | --- |
| Verified on chain | The disclosed amount/commitment/path and the configured pool's confirmed historical root, leaf count, token and block hash agree. |
| Invalid proof | The file is malformed, its proof/labels disagree, or available canonical chain observations contradict it. |
| Unable to verify | The pool/network/version is unsupported, a legacy proof lacks an anchor, confirmations are insufficient, or historical RPC data is unavailable. |

A receipt proves the disclosed note's inclusion at its anchor. It does not prove
an invoice was settled, payer identity, legal identity, knowledge of a spending
secret, or that the note remains unspent. Username and generation time are
issuer-provided information. Notes that were later spent and legacy pools can
still have valid historical inclusion receipts.

## Privacy

The JSON intentionally discloses one note's amount, public owner key, salt and
Merkle inclusion path. The viewer processes it in browser memory. It does not
upload the proof, store it in browser databases, or send it through URLs/analytics.
Remove receipt clears the displayed data and file selection.

The public `receipts.chainSnapshot` query accepts only approved pool scope,
block number, and optional block hash. It never receives the file, amount, salt,
owner key, username or path. Its read-only response contains public chain state.
No wallet, signature or transaction is required to verify.
The dedicated receipt client omits credentials and authorization headers, and
does not consult the auth SDK. Verification can start before authentication is
ready, including for visitors who already have a session.

## Versions and RPC requirements

New exports use version 2 and carry an anchor with block number/hash and leaf count.
Version 1 remains locally checkable, including known USDC receipts without asset
metadata, but never gets a chain-verified result without an anchor. Ask the owner
to reissue it from History. PDF upload/extraction is not part of this release.

The configured server RPC must support historical `eth_call` at the anchored
block. Queries use the existing server-only relayer RPC when configured, otherwise
the configured public chain RPC. Chain observations rely on that provider.
Pruned history is an unavailable result, not proof that the receipt is false.
Export needs a healthy complete mirrored prefix and a matching historical state;
Retry refreshes/rebuilds rather than pairing an old path with a new block.

Canonical block hashes are checked before and after historical reads. A reorg
during the check is retryable; a stable canonical hash differing from the receipt
invalidates that anchor. The recent-root ring is not used to reject old receipts.
Each read has a three-second timeout and no automatic retries; the request has a
12-second deadline. Rate limiting is 20 queries/minute/IP and at most eight active
snapshot operations per server process, following current application patterns.

## Verification evidence

The implementation has real-cryptography parser/math tests, controlled historical
RPC and reorg/deadline tests, actual Verify/receipt dialog component tests, and
WalletProvider regressions for authenticated visitors staying on the public page.
Local Hardhat tests use the shipped proving artifacts: an anchored note still has
matching historical root/count after 31 additional deposits and after it is spent.
The recorded public test trace is also checked by the production local verifier
and comparison functions; that replay uses recorded observations, not live RPC.

Tests run without requiring an ignored workspace directory. Set the child-process
flag `RECEIPT_WRITE_EVIDENCE=1` only when explicitly generating local dummy PDF/trace
artifacts; the generator creates its directory. `receiptChainEvidence.test.ts`
skips the optional replay when no contract-generated trace exists. The actual
contract anchor test still runs independently and does not skip.

Independent read-only review found the authenticated public-route bootstrap and
diagnostic-output directory issues. Both were reproduced and fixed with regressions.
PDF claims distinguish issuer metadata, local-only v1, and confirmed export anchors.
Final suite/build/browser results and live-provider limits are recorded with delivery.
Production smoke returned 200 for `/verify` and 401 for the protected request-count
API. Desktop/mobile checks used synthetic proofs: v1 remained locally valid without
an anchor, changed proofs failed, a false canonical hash failed through the live
public query, and unavailable evidence allowed Retry/Remove. Mobile content had no
horizontal overflow. Positive UI results use controlled transport in component
tests; no real authenticated receipt-export or live payment was performed.

Read-only RPC probes found latest state available and a ten-block-old read
unavailable in one probe; a later deployment-block check completed and rejected a
synthetic false block hash. Provider availability is variable, so these observations
do not establish a blanket lack of archive support. Historical reads remain a
deployment prerequisite and failures remain unavailable outcomes.
No contract deployment, environment activation or application database migration is
included.

### Final local validation — 2026-10-07

- Web: 454 tests passed across 123 files using `--maxWorkers=1 --testTimeout=30000`.
  The larger runner deadline accommodates this Windows host; assertions are unchanged.
  Earlier five-second runs hit timeouts in existing mirror/indexer/withdraw tests,
  which also passed in isolated regressions.
- Contracts: full suite 46 passed, including real historical/root-expiry/spent-note
  proof evidence. Optional recorded trace replay passed in the local web suite.
- TypeScript, scoped source Biome, local production build and diff whitespace checks
  passed. This validates normal `build:local`, not standalone Windows packaging.
- Public Verify and the protected unauthenticated API smoke returned 200/401 as expected.
- Actual browser checks used synthetic proofs at desktop/mobile widths; successful
  UI verification uses controlled transport tests. There was no real authenticated
  export, live payment, migration or contract deployment.

Implementation branch: `feature/receipt-verification`. Delivery to the default
branch and then `dev` was explicitly authorized on 2026-10-07.
