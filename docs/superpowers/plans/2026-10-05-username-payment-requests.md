# Username Payment Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let registered Mawee users request a fixed private USDC payment from another username and pay it from fragmented private balances, with encrypted request details and recoverable settlement.

**Architecture:** Introduce signed, encrypted participant-only requests and a two-input Merge circuit in a newly deployed pool. Keep request reservations atomic and relayer sends durable before broadcast; consolidate notes privately before one final request transfer. Integrate a Requests page and action modals into the existing dashboard shell, while retaining legacy-pool discovery and withdrawals.

**Tech Stack:** Existing Next.js 15/React 19, tRPC 11, Zod 4, MongoDB Node driver 6, viem 2.52.0, Noble 2, Circom 2/circomlib, snarkjs 0.7.6, Solidity 0.8.24/Hardhat 2, Envio 3.12.1, Vitest and Testing Library. Do not upgrade dependencies to deliver this feature.

**Spec:** [Approved design](../specs/2026-10-05-username-payment-requests-design.md). Read both documents before implementation. The user approved written-spec planning on 2026-10-05; implementation awaits plan review and execution-method selection.

## Global Constraints

- Branch: `feature/username-payment-requests`; base `origin/monad-migration` at `d2ba32cd6a68e084735b5e477856b10deb35cec1`.
- Payment from private balance, including combining multiple input notes.
- Amount and note encrypted; the server may know the participants and status.
- Dashboard Requests tile; a dedicated Requests page with Received and Sent tabs.
- Creation and payment confirmation use modals. No sidebar is added.
- Fixed amount, full payment, no partial payments.
- Public statuses Pending, Paid, Declined, and Cancelled.
- Only the addressee may pay or decline; only the requester may cancel.
- No editing after creation; cancel and create a replacement.
- No expiry, due date, reminder, or external notification in this release.
- Prevent repeated clicks; show Paid only after chain confirmation.
- Consolidate private notes in stages, then pay in one final transfer.
- Lists are paginated, 20 records at a time, newest first. Pending counts are independent of pagination.
- A note of at most 200 characters; amount is positive and bounded by the existing uint64 range.
- Creation: 20 per user/10 minutes; payment starts: 10 per user/10 minutes; participant queries: 120 per user/minute.
- Preparation reservation: 10 minutes of inactivity, releasable only when no transaction could have been broadcast.
- Default confirmation requirement: one receipt confirmation on testnet.
- Never merge notes across pools. Legacy pools are withdrawal-only in this feature.
- Private keys and decrypted request data remain in page memory.
- Do not put plaintext amount, note, salt, or decrypted payloads in persistent request/operation records, logs, analytics, or browser persistent storage.
- Preserve the unrelated local modification to `indexer/config.yaml`. Do not stage it incidentally.
- Do not deploy to testnet, change live configuration, reset data, move funds, push, or open a PR during plan execution without separate authorization.
- Follow the user's Context7 instructions for library-specific implementation syntax, configuration, and debugging.

## Review Focus

1. Emoji and multibyte notes: a 200-character note must fit a fixed-size envelope and round-trip; changing note length must not change ciphertext length. Task 2.
2. Equal timestamps across a page boundary: cursor pagination must neither skip nor repeat requests. Task 6.
3. One owner with two notes at the same leaf index in different pools: scanning and payment selection must keep them separate. Tasks 4 and 9.
4. Worker crash between reserving a nonce, signing, persisting, and broadcast: recover the same nonce and bytes without issuing another payment. Tasks 7 and 8.
5. Modal closes or account changes during payment: the operation stays visible to its participant; decrypted data from the old account disappears. Task 10.

## Delivery order and gates

These are dependent slices of one feature, not four independent products:

1. Tasks 1–4: shared contracts, encrypted payloads, merge proof, new pool, scoped balances.
2. Tasks 5–8: public indexing, private request API, durable relayer, settlement reconciliation.
3. Task 9: browser consolidation, request payment, and note recovery.
4. Tasks 10–11: product UI, complete integration evidence, and deployment runbook.

Each task has its own failing-test/pass/review/commit cycle. Do not wire the Pay
button before the duplicate-output, durable-send, and matching-receipt gates pass.
A failing crypto or recovery invariant blocks dependent tasks; do not replace it
with a UI-only workaround. Reviews use the spec, not just the task's test names.

## Preparation and file ownership

Execution starts by inspecting `git status --short`, staged diffs, the branch,
installed tools, and existing checks. Respect the checkout choice already made;
do not create a worktree implicitly. Run baseline web and contract tests once,
report existing failures, and keep caches and local test environments isolated.
This planning turn does not run product tests or change product code.

The existing VPS MongoDB configuration is standalone. The design below therefore
uses single-document compare-and-set and recoverable projections, not a hidden
requirement for replica-set transactions. Do not change VPS database topology.

### File map

| Unit | New files | Existing integration points |
| --- | --- | --- |
| Request contracts | `web/src/features/requests/types.ts`, `validation.ts`, `requestTypedData.ts` | `web/src/lib/typedData.ts` only if sharing existing exported primitives is needed |
| Request crypto | `web/src/features/requests/requestCrypto.ts` | Existing `crypto.ts` primitives, `keys.ts`, and `notes.ts` account recovery |
| Merge proof | `circuits/src/merge.circom`, `circuits/src/merkle-proof.circom`, `circuits/gen_merge_input.mjs`, `circuits/test/merge.test.cjs`, `contracts/src/verifiers/MergeVerifier.sol` | `circuits/build.sh`, existing circuit includes, verifier export, browser prover |
| Pool behavior | `contracts/test/helpers/poolFixture.ts`, `contracts/test/merge.test.ts`, `contracts/test/requestSettlement.test.ts` | `MaweePool.sol`, existing deployment fixtures and deploy/export scripts |
| Pool scope | `web/src/lib/pools.ts`, `web/src/server/modules/deposits/poolScope.ts`, `web/migrations/20261005090000-pool-scopes.js` | Environment schemas/examples, chain/mirror/notes/withdrawal code, deposits module |
| Indexing | `indexer/src/handlers/poolScope.ts`, `web/test/poolScopes.test.ts` | Envio schema/handlers/config generation/client and fallback indexer |
| Requests server | `web/src/server/modules/requests/{requests.schema,requests.errors,requests.repository,requests.service,requests.router}.ts`, `web/migrations/20261005100000-payment-requests.js` | Mongo accessors, server root, verified wallet resolution |
| Relayer journal | `web/src/server/lib/relayJournal.ts`, `durableRelayer.ts`, `web/migrations/20261005110000-relay-journal.js` | Existing `relayer.ts`, all relay service sends, server cron route |
| Payment operations | `web/src/server/modules/requests/requestOperations.ts`, `requestSettlement.ts`, `web/src/app/api/cron/request-payments/route.ts` | Requests router, durable relay, cron scheduler |
| Browser payment | `web/src/features/requests/{selectFunding,requestProofs,requestPayments,requestNoteRecovery}.ts` | `prover.ts`, `chain.ts`, scoped note scanning |
| Product UI | `web/src/app/(dashboard)/requests/page.tsx`, `web/src/components/dashboard/{RequestsDashboard,RequestList,CreateRequestDialog,PayRequestDialog,RequestOperationStatus}.tsx`, `web/src/features/requests/hooks/{useRequests,useRequestPayment}.ts` | Dashboard, ReceiveDialog, shell labels, auth-routes, middleware |
| Evidence | Focused tests listed below, `web/test/requestPayments.integration.test.ts`, `web/test/requests.browser.test.ts`, `docs/request-payments-operations.md` | Relevant package scripts, README/reference/features/local setup |

Do not create empty modules ahead of their task. Generated ABIs and verifiers
come from scripts. Break large existing files only where pool scope or durable
sending requires it. Other business features stay outside this plan.

### Shared interfaces established by Task 1

```ts
type PoolScope = `${number}:${string}`;
type RequestStatus = 'pending' | 'paid' | 'declined' | 'cancelled';
type OperationPhase = 'preparing' | 'submitting' | 'submitted'
  | 'confirmed' | 'failed' | 'needsReconciliation';
type Participant = {
  username: string;
  wallet: `0x${string}`;
  notePubkey: `0x${string}`;
  viewPubkey: `0x${string}`;
};
type PoolDescriptor = {
  scope: PoolScope;
  chainId: number;
  address: `0x${string}`;
  deployBlock: number;
  token: `0x${string}`;
  tokenDecimals: number;
  depth: 20;
  confirmations: number;
  role: 'active' | 'legacy';
  requestCapable: boolean;
};
type RequestMetadata = {
  version: 1;
  id: string;
  pool: PoolScope;
  requester: Participant;
  addressee: Participant;
  createdAt: string;
  recipientCommitment: `0x${string}`;
};
type RequestPayload = {
  metadata: RequestMetadata;
  amount: string;
  note: string;
  salt: string;
};
type Envelope = { ephemeralPk: `0x${string}`; ciphertext: `0x${string}` };
type SignedRequest = RequestMetadata & {
  requesterEnvelope: Envelope;
  addresseeEnvelope: Envelope;
  signature: `0x${string}`;
};
type PaymentRequest = SignedRequest & {
  status: RequestStatus;
  revision: number;
  operationId: string | null;
  updatedAt: string;
  receipt: { txHash: `0x${string}`; leafIndex: number; block: number } | null;
};
type RequestPage = { items: PaymentRequest[]; nextCursor: string | null };
type NoteOutput = {
  commitment: `0x${string}`;
  ephemeralPk: `0x${string}`;
  ciphertext: `0x${string}`;
};
type ProofWire = {
  a: readonly [string, string];
  b: readonly [readonly [string, string], readonly [string, string]];
  c: readonly [string, string];
};
type SubmissionBody = {
  version: 1;
  requestId: string;
  operationId: string;
  step: number;
  pool: PoolScope;
  kind: 'merge' | 'split' | 'payment';
  root: `0x${string}`;
  nullifiers: readonly `0x${string}`[];
  proof: ProofWire;
  outputs: readonly NoteOutput[];
};
type SignedSubmission = SubmissionBody & { signature: `0x${string}` };
type PaymentOperation = {
  id: string;
  requestId: string;
  pool: PoolScope;
  phase: OperationPhase;
  completedMerges: number;
  nextStep: number;
  txHash: `0x${string}` | null;
  updatedAt: string;
};
```

These are the app transport contracts, not an instruction to store decrypted
payloads. Server modules import metadata types without importing browser crypto.
DB documents use `Date`/`Binary`; router serializers convert to these wire types.

### Task 1: Define immutable request contracts and exact validation

**Files:** Create types, validation, and requestTypedData files above; tests
`web/test/requestValidation.test.ts` and `web/test/requestTypedData.test.ts`.

**Interfaces:** Produce the shared types, `parseRequestAmount(raw: string, decimals: number): bigint`,
`validateRequestNote(note: string): string`, `requestDigest(record: SignedRequest): Hex`,
and `submissionDigest(body: SubmissionBody): Hex`. Typed-data builders return
viem-compatible EIP-712 parameters for client signing and server verification.

- [ ] Write failing tests for exact base-unit parsing, self-request, invalid
  usernames, 200 Unicode code points, wrong scope, uint64 overflow, malformed
  ciphertext/keys, and digest changes when any immutable field changes.

```ts
import { describe, expect, it } from 'vitest';
import { parseRequestAmount, validateRequestNote } from '../src/features/requests/validation';
describe('request validation', () => {
  it('uses the actual token precision without floating-point rounding', () => {
    expect(parseRequestAmount('20.000001', 6)).toBe(20_000_001n);
    expect(() => parseRequestAmount('20.0000001', 6)).toThrow();
    expect(() => parseRequestAmount('0', 6)).toThrow();
    expect(() => parseRequestAmount('1e3', 6)).toThrow();
  });
  it('counts emoji as characters, not UTF-16 halves', () => {
    expect(validateRequestNote('🙂'.repeat(200))).toBe('🙂'.repeat(200));
    expect(() => validateRequestNote('🙂'.repeat(201))).toThrow();
  });
});
```

- [ ] Run `pnpm --filter web test -- test/requestValidation.test.ts test/requestTypedData.test.ts`; expect missing-module failures before implementation.
- [ ] Implement schemas and canonical digest encoding. Use numeric base-unit
  strings, UUID request/operation IDs, normalized addresses, strict 32-byte field
  elements, and bounds on proof coordinates. Do not copy the existing payment-link
  schema's hardcoded seven decimal places.

```ts
export function parseRequestAmount(raw: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error('Invalid token precision.');
  const text = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error('Enter a valid amount.');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error('Too many decimal places.');
  const units = BigInt(whole) * 10n ** BigInt(decimals)
    + BigInt(fraction.padEnd(decimals, '0') || '0');
  if (units <= 0n || units > (1n << 64n) - 1n)
    throw new Error('Amount is outside the supported range.');
  return units;
}
export function validateRequestNote(note: string): string {
  const text = note.trim();
  if ([...text].length > 200) throw new Error('Use 200 characters or fewer.');
  return text;
}
```

EIP-712 domain: name `Mawee Requests`, version `1`, request pool chain ID and
address. Request message binds ID, requester/addressee wallets, usernames/key
snapshots, creation timestamp, recipient commitment, and hashes of both envelopes.
Submission message binds operation, step, kind, pool, root, every nullifier,
proof hash and output hashes including ciphertext. Encode explicit typed fields
and arrays; never sign insertion-order-dependent `JSON.stringify` output.

- [ ] Repeat both focused tests; expect PASS and matching client/server digests.
- [ ] Commit only Task 1 files: `feat: define private payment request contracts`.

### Task 2: Implement two-party encrypted request payloads

**Files:** Create `requestCrypto.ts`, `web/test/requestCrypto.test.ts`, and
`web/test/helpers/requestFixtures.ts`.

**Interfaces:** Consume Task 1 types/digests and existing note primitives.
Produce `sealRequest(payload: RequestPayload): { requesterEnvelope: Envelope; addresseeEnvelope: Envelope }`,
`openRequest(record: SignedRequest, account: LocalAccount, pool: PoolDescriptor): Promise<RequestPayload>`,
and `createSignedRequest(input: { id: string; pool: PoolDescriptor; requester: Participant; addressee: Participant; amount: bigint; note: string; createdAt: string }, signer: Signer): Promise<SignedRequest>`.
`requestFixtures.ts` exports `makeRequestFixture(): Promise<{ record: SignedRequest; payload: RequestPayload; requester: LocalAccount; addressee: LocalAccount; outsider: LocalAccount; pool: PoolDescriptor }>` with deterministic test-only accounts/signatures.

- [ ] Write a failing real-crypto test using the fixture. Test different
  envelope randomness, both participants, outsider rejection, fixed-length
  emoji payloads, wrong identity/AAD, tampered signature, and inconsistent
  decrypted amount versus recipient commitment.

```ts
it('opens for both participants and rejects outsiders', async () => {
  const f = await makeRequestFixture();
  expect(await openRequest(f.record, f.requester, f.pool)).toEqual(f.payload);
  expect(await openRequest(f.record, f.addressee, f.pool)).toEqual(f.payload);
  await expect(openRequest(f.record, f.outsider, f.pool)).rejects.toThrow();
});
```

- [ ] Run `pnpm --filter web test -- test/requestCrypto.test.ts`; expect FAIL.
- [ ] Implement the padded codec and authenticated encryption using existing
  Noble x25519/XChaCha20-Poly1305/HKDF imports after verifying their installed
  APIs through Context7. Use a 4,096-byte padded plaintext frame: 4-byte encoded
  JSON length, bounded canonical JSON bytes, and random remaining padding.
  Capacity accommodates 200 four-byte Unicode characters plus immutable metadata.
  Reject larger input rather than silently truncating. Encrypt twice with
  independent ephemeral keys and nonces; domain `mawee.request.envelope.v1`.

```ts
const FRAME_SIZE = 4096;
function packPayload(payload: RequestPayload): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(payload));
  if (encoded.length > FRAME_SIZE - 4) throw new Error('Request is too large.');
  const frame = crypto.getRandomValues(new Uint8Array(FRAME_SIZE));
  new DataView(frame.buffer).setUint32(0, encoded.length, false);
  frame.set(encoded, 4);
  return frame;
}
```

Do not serialize this plaintext anywhere except the in-memory envelope codec.
On open: verify signature first, select envelope by local viewing-key snapshot,
verify AEAD/AAD, decode bounded length, run strict payload schemas, match all
metadata, and recompute Poseidon(amount, requesterPk, salt). Reject mismatches
with a generic user error. Test fixture builders return complete records; they
must never appear in production modules.

- [ ] Run crypto and validation tests; inspect tests that assert ciphertext
  length stays equal for empty, ASCII, and 200-emoji notes and test log redaction.
- [ ] Commit: `feat: encrypt and authenticate payment requests`.

### Task 3: Add real Merge proofs and atomic pool invariants

**Files:** Create merge circuit, shared merkle-proof include, input generator,
circuit tests and MergeVerifier; modify `circuits/src/{transfer,withdraw}.circom`
only to share an identical Merkle template, `circuits/build.sh`,
`contracts/src/MaweePool.sol`, verifier/ABI exporters and all pool constructor
fixtures. Create `contracts/test/helpers/poolFixture.ts`, `merge.test.ts`, and
`requestSettlement.test.ts`. Stage generated `web/public/zk/merge.{wasm,zkey}`,
`verification_key_merge.json`, `artifacts-manifest.json`, and `web/src/lib/abi.ts`.

**Interfaces:** Merge witness has public `root`, `nullifierA`, `nullifierB`,
`outCommitment`; private `ownerSecret`, `amounts[2]`, `salts[2]`,
`pathElements[2][20]`, `pathIndices[2][20]`, `outSalt`.
Contract: `merge(bytes32 root, bytes32 nullifierA, bytes32 nullifierB, Proof proof, NoteOutput output) returns (uint32 outputIndex)`.
Fixture exports `deployPoolFixture()`, `depositOwnedNote(fixture, { amount, ownerSecret, salt }): Promise<{ leafIndex: number; commitment: bigint }>`,
`makeMergeProof(fixture, { indices: readonly [number,number]; ownerSecret: bigint; outSalt: bigint }): Promise<{ root: Hex; nullifiers: readonly [Hex,Hex]; proof: EvmProof; outputCommitment: Hex }>`,
and `makeTransferProof(fixture, { index: number; ownerSecret: bigint; recipientPk: bigint; recipientAmount: bigint; recipientSalt: bigint; changeSalt: bigint })`.
Returned fixture includes deployed `pool`, `usdc`, `publicClient`, `payer`, and
realization-order `leaves`/owned-note witness fixtures, following current pool tests.

- [ ] Add failing circuit witness and contract tests: honest merge, duplicate
  indices, wrong owner, different roots, overflow, corrupted nullifier/output,
  spent input, pause, full tree, and duplicate recipient commitment from two
  independently valid proofs. Keep input funds and spent flags unchanged on revert.

```ts
it('merges 10 and 15 without tokens leaving the pool', async () => {
  const f = await deployPoolFixture();
  await depositOwnedNote(f, { amount: 10_000_000n, ownerSecret: 42n, salt: 101n });
  await depositOwnedNote(f, { amount: 15_000_000n, ownerSecret: 42n, salt: 102n });
  const m = await makeMergeProof(f, { indices: [0, 1], ownerSecret: 42n, outSalt: 103n });
  await f.pool.write.merge([m.root, m.nullifiers[0], m.nullifiers[1], m.proof,
    { commitment: m.outputCommitment, ephemeralPk: toHex(7n, {size:32}), ciphertext:'0x1234' }]);
  expect(await f.usdc.read.balanceOf([f.pool.address])).to.equal(25_000_000n);
  expect(await f.pool.read.isSpent([m.nullifiers[0]])).to.equal(true);
  expect(await f.pool.read.isSpent([m.nullifiers[1]])).to.equal(true);
});
```

- [ ] Run `pnpm --filter contracts test -- test/merge.test.ts test/requestSettlement.test.ts`; expect FAIL before pool/circuit implementation.
- [ ] Implement constrained merge circuit and pool method. Share unchanged
  Merkle math rather than including transfer.circom's `main` in another circuit.
  Use Num2Bits(64) on amounts/sum, Bits2Num(20) on indices, and explicit inequality
  constraints. Input commitment/Poseidon owner and nullifier match existing notes.

```circom
component sameIndex = IsEqual();
sameIndex.in[0] <== leafIndices[0].out;
sameIndex.in[1] <== leafIndices[1].out;
sameIndex.out === 0;
component sameNullifier = IsEqual();
sameNullifier.in[0] <== nullifierA;
sameNullifier.in[1] <== nullifierB;
sameNullifier.out === 0;
signal combinedAmount;
combinedAmount <== amounts[0] + amounts[1];
component combinedBits = Num2Bits(64);
combinedBits.in <== combinedAmount;
```

Add `mapping(bytes32 => bool) insertedCommitments` and `DuplicateCommitment`
in `_insert`, including field-bound validation. A revert must undo any earlier
nullifier writes or inserts in the same transaction. Existing zero-change notes
remain allowed, with fresh random salts and distinct commitments.

- [ ] Compile with the existing Circom build workflow; inspect actual R1CS
  constraint count and choose a powers-of-tau capacity that exceeds the required
  constraints. Add an isolated merge setup/staging path that does not regenerate
  shipped deposit/withdraw/transfer keys. Verify unchanged artifact hashes,
  generate MergeVerifier, and regenerate ABIs. The build script must expose
  `bash circuits/build.sh merge` for this path; Windows execution may use the
  existing compatible Bash/WSL environment after tool discovery.
- [ ] Run `node circuits/test/merge.test.cjs`, targeted contract tests and then
  existing pool/gasless suites once. Tests use shipped wasm/zkeys and actual
  on-chain proof verification. Existing fixture helpers must pass the new merge
  verifier constructor argument; old deployed contracts remain ABI-readable.
- [ ] Commit: `feat: add private note consolidation and unique outputs`.

### Task 4: Make pool discovery and withdrawal explicitly scoped

**Files:** Create pools.ts, deposits/poolScope.ts, pool-scopes migration and
`web/test/pools.test.ts`; modify environment schemas/examples, chain.ts,
poolMirror.ts, notes.ts, withdraw.ts, useMyNotes.ts and WithdrawDashboard.tsx.
Extend existing env/mirror/notes/withdraw tests.

**Interfaces:** Consume `PoolDescriptor`/`PoolScope`. Produce
`listPools(): readonly PoolDescriptor[]`, `activePool(): PoolDescriptor`,
`resolvePool(scope: PoolScope): PoolDescriptor`, `scopeKey(chainId: number, address: Hex): PoolScope`,
`loadPoolMirror(pool?: PoolDescriptor): Promise<PoolMirror>`,
`refreshPoolMirror(pool?: PoolDescriptor): Promise<PoolMirror>`, and
`scanMyNotes(account: LocalAccount, options?: { refresh?: boolean; pool?: PoolDescriptor }): Promise<ScanResult>`.
Default omitted pool preserves active-pool behavior. Attach `scope` to ScanResult
and MyNote; withdrawal receives/validates scope and sends to that pool.

- [ ] Write failing tests for duplicate descriptors, exactly one active pool,
  wrong chain/depth, legacy balances and equal leaf indices in different pools.
  Input manifest `NEXT_PUBLIC_MAWEE_POOLS` is bounded JSON; old public environment
  variables produce one legacy/non-request-capable descriptor if no manifest is supplied.
  Never label the old pool request-capable just because the branch contains new ABI.

```ts
it('separates the same leaf index in different pools', () => {
  const a = scopeKey(31337, '0x1111111111111111111111111111111111111111');
  const b = scopeKey(31337, '0x2222222222222222222222222222222222222222');
  expect(a).not.toBe(b);
  expect(`${a}:0`).not.toBe(`${b}:0`);
});
```

- [ ] Run `pnpm --filter web test -- test/pools.test.ts test/poolMirror.test.ts test/notes.test.ts test/withdraw.test.ts`; expect scope failures.
- [ ] Implement normalized manifest parsing, direct Next public env access,
  approved-scope resolution, scoped RPC reads/write arguments, and mirror keys.
  Preserve existing IndexedDB public mirrors under their original scope.

```ts
export function scopeKey(chainId: number, address: `0x${string}`): PoolScope {
  return `${chainId}:${address.toLowerCase()}`;
}
export function scopedLeafId(scope: PoolScope, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid leaf index.');
  return `${scope}:${index}`;
}
```

Migrate old Mongo deposit/nullifier/index-state documents to explicit old pool
scope before enabling the manifest. Fail safely if legacy scope cannot be derived;
do not guess it from the new active address. Store scoped composite `_id` values,
not a globally unique leaf index. The migration takes explicit legacy scope from
environment and is idempotent; its down path must not delete transaction history.
Withdraw UI has a pool selector only when legacy balances exist, with clear
active versus legacy labels and no automatic withdrawal/redeposit.

- [ ] Repeat scoped tests and existing withdrawal UI tests. Verify manifests
  are publicly safe and contain no RPC credentials.
- [ ] Commit: `feat: preserve scoped active and legacy pool balances`.

### Task 5: Index merge spends correctly across all configured pools

**Files:** Modify `indexer/schema.graphql`, Pool.ts/Registry.ts handlers,
`indexer/src/indexer.test.ts`, `web/src/server/lib/envio.ts`, deposits
service/schema/router, and fallback pool-indexer logic. Create indexer poolScope
helper and `web/test/poolScopes.test.ts`; extend Envio snapshot/client tests.
Prepare indexer config output via deploy script fixtures; preserve the user's
existing dirty `indexer/config.yaml`.

**Interfaces:** Produce per-pool IDs/stats and scoped `deposits.snapshot`/stats
queries. Input includes `{ pool?: PoolScope; afterLeafIndex?: number; spentAfterBlock?: number }`;
server resolves it through Task 4's manifest, never arbitrary caller addresses.
Existing outputs keep their public data contract with explicit selected pool.

- [ ] Add failing event tests for Deposit + two Spend events in one merge,
  pool-specific roots, statistics, registry account scope, and old-pool queries.
  A merge consumes two notes and creates one: notes +1, spent +2, anonymity set -1.
  It must not count as two shielded transfers.

```ts
it('keeps consolidation out of transfer totals', () => {
  expect(classifyPoolTransaction(1, 2, 0)).toBe('merge');
  expect(classifyPoolTransaction(1, 1, 0)).toBe('incomplete');
  expect(classifyPoolTransaction(2, 1, 0)).toBe('transfer');
});
```

`classifyPoolTransaction` is exported from indexer poolScope.ts and defined in
the implementation step below. Add handler-level tests using existing Envio test
fixtures to assert actual per-pool aggregate deltas; the pure classification
test alone is not evidence that indexing correctly applies those deltas.

- [ ] Run `pnpm --dir indexer test` and scoped web snapshot tests; expect FAIL.
- [ ] Add scope to Note/Nullifier/Withdrawal/PoolStats/DailyStats, with
  `${scope}:${leafIndex}` and `${scope}:${nullifier}` IDs. Aggregate non-withdrawal
  spends once per scoped transaction using two deposits/one spend for transfer
  versus one deposit/two spends for merge; record incomplete groups without
  publishing a false aggregate. Per-tx operation summaries must settle idempotently.

```ts
export function classifyPoolTransaction(deposits: number, spends: number, withdrawals: number) {
  if (withdrawals === 1 && spends === 1 && deposits === 0) return 'withdraw';
  if (withdrawals === 0 && spends === 1 && deposits === 2) return 'transfer';
  if (withdrawals === 0 && spends === 2 && deposits === 1) return 'merge';
  if (withdrawals === 0 && spends === 0 && deposits === 1) return 'deposit';
  return 'incomplete';
}
```

Finalize summaries as event groups become complete rather than on the first
Spend. Legacy events still work. Read generated Envio 3.12 event types for source
address and chain; use current Context7 docs if APIs differ. Registry entities
are chain/registry scoped separately from pool-specific transaction histories.
Preserve contiguous-leaf publication bounded by indexer progress; a missing leaf
in one pool cannot be filled using another pool's leaf at the same index.

- [ ] Run codegen/typecheck with `pnpm --dir indexer codegen` and
  `pnpm --dir indexer typecheck`, then indexer and targeted web tests. Envio isn't
  in the root workspace, so do not use `pnpm --filter mawee-indexer`.
- [ ] Commit: `feat: index consolidation and legacy pools without collisions`.

### Task 6: Deliver authenticated encrypted request records and state transitions

**Files:** Create requests schema/errors/repository/service/router, payment-request
migration, `web/test/helpers/requestDb.ts`, and `web/test/{requests.repository,requests.service,requests.router}.test.ts`.
Modify Mongo accessor types and server root.

**Interfaces:** Service receives authenticated `privyUserId`, derives wallet
using currentWallet/verified ownership, and produces create/list/count/get/decline/cancel.
Public transport signatures:
`create(record: SignedRequest): Promise<PaymentRequest>`;
`listReceived({cursor?: string}): Promise<RequestPage>`;
`listSent({cursor?: string}): Promise<RequestPage>`;
`pendingCount(): Promise<number>`;
`get({id: string}): Promise<PaymentRequest>`;
`decline({id: string; revision: number})` and `cancel({id: string; revision: number})`
return the updated request. Server uses `Date`/`Binary` and does not import the
payload decoder or accept plaintext body fields.

- [ ] Write failing ownership, idempotency, signature, terminal-race, envelope
  bounds, cursor tie-break, generic 404, and independent pending-count tests.

```ts
it('does not skip requests sharing the cursor timestamp', async () => {
  const db = await openIsolatedRequestDb();
  await seedRequests(db, { count: 23, sameCreatedAt: true });
  const first = await listReceivedForWallet(db, recipientWallet, null);
  const second = await listReceivedForWallet(db, recipientWallet, first.nextCursor);
  expect(first.items).toHaveLength(20);
  expect(second.items).toHaveLength(3);
  expect(new Set([...first.items, ...second.items].map(r => r.id)).size).toBe(23);
});
```

Create test-only openIsolatedRequestDb/seedRequests/listReceivedForWallet adapters
to real repository methods. Use a uniquely named disposable Mongo test DB,
never the configured application DB; close/drop only that verified test DB.

- [ ] Run focused repository/service/router tests; expect FAIL before modules exist.
- [ ] Implement one-document atomic transitions, signature verification, wallet
  and registry checks, idempotent create, and strict outputs. Use creation index
  `(participantWallet, createdAt DESC, _id DESC)` and a matching two-field cursor.
  Cursor decoding is bounded and participant-filtered. Query 21 rows to return
  20 and a next cursor. Counts query all pending received records.

```ts
const changed = await requests.findOneAndUpdate(
  { _id: id, status: 'pending', revision, operationId: null, requesterWallet: callerWallet },
  { $set: { status: 'cancelled', updatedAt: new Date() }, $inc: { revision: 1 } },
  { returnDocument: 'after', includeResultMetadata: false },
);
if (!changed) throw new RequestConflictError();
```

Indexes: unique request `_id`; unique `(scope, recipientCommitment)`; participant
created-time indexes; participant status indexes. The request record embeds its
active reservation so ownership/status/reservation changes are one atomic write.
Projection into the operations collection is idempotent and reconstructible.
Apply the spec's limits to authenticated user IDs. Call terminal operations only
after reconciliation of known submitted work. Do not expose raw envelopes via
public routes or include plaintext in error/log context.

- [ ] Run focused tests with real Mongo repository evidence plus router unit
  auth boundaries; report those evidence classes separately.
- [ ] Commit: `feat: add participant-only encrypted request APIs`.

### Task 7: Persist relayer signing and nonce ownership before broadcast

**Files:** Create relayJournal.ts, durableRelayer.ts, relay-journal migration,
`web/test/relayJournal.test.ts`, `web/test/durableRelayer.test.ts`.
Modify existing relayer.ts/service calls to share the same durable wallet coordinator.

**Interfaces:** `prepareRelay({operationKey: string; pool: PoolDescriptor; data: Hex; expectedOutputs: readonly Hex[]}): Promise<{txHash: Hex; serializedTransaction: Hex}>`;
`broadcastRelay(operationKey: string): Promise<{txHash: Hex}>`;
`reconcileRelay(operationKey: string): Promise<{state:'confirmed'|'reverted'|'unknown'; txHash: Hex; receipt: TransactionReceipt | null}>`.
`relayWrite` retains existing hash/receipt return compatibility for ordinary sends.
Internal docs record wallet/chain, fenced owner, operation key, nonce, signed bytes,
hash, expected output metadata, and execution phase, never private note inputs.

- [ ] Write failing tests at each crash boundary, two process instances,
  concurrent ordinary withdraw plus merge, duplicate idempotency keys with
  altered calldata, and uncertain RPC errors. Persist before send is asserted.

```ts
it('rebroadcasts identical bytes after an uncertain send', async () => {
  const first = await journal.prepare(operationKey, preparedTransaction);
  rpc.sendRawTransaction.mockRejectedValueOnce(new Error('RPC timeout'));
  await expect(sender.broadcast(operationKey)).rejects.toThrow();
  const restarted = makeDurableSender(journal, rpc);
  await restarted.broadcast(operationKey);
  expect(rpc.sendRawTransaction.mock.calls.map(([arg]) => arg.serializedTransaction))
    .toEqual([first.serializedTransaction, first.serializedTransaction]);
  expect(journal.signCount).toBe(1);
});
```

`makeDurableSender` is a constructor in durableRelayer.ts accepting a journal and
viem client port. Its tests provide full fake RPC responses and a real-Mongo journal
where verifying cross-process atomicity; signCount is a test spy, not persisted data.

- [ ] Run focused journal/sender and existing relayer tests; expect missing durability assertions to fail.
- [ ] Implement a single in-flight send per `(chainId, relayerWallet)` in one
  Mongo wallet-coordinator document. Use revision/fencing CAS and embed the active
  nonce and signed-send record in that atomic document before any broadcast.
  History records are projections recoverable from it. A reservation without signed
  bytes may expire only after fencing its old worker. Signed work does not expire
  into a new nonce assignment. Each old worker must win the fenced persist CAS
  before it has permission to broadcast; stale workers stop on a CAS miss.

```ts
const prepared = await walletClient.prepareTransactionRequest({
  account, to: pool.address, data, nonce: reservedNonce,
});
const serializedTransaction = await walletClient.signTransaction(prepared);
const txHash = keccak256(serializedTransaction);
await journal.persistSigned({ operationKey, fence, serializedTransaction, txHash });
await walletClient.sendRawTransaction({ serializedTransaction });
```

Reserve against RPC pending nonce only after reconciling an existing coordinator
slot. Compare confirmed/pending nonce, but never interpret `nonce too low` alone
as success. External relayer-wallet use or an unknown transaction using its nonce
is a reconciliation problem. Do not advance past a missing nonce or make automatic
fee replacement transactions in v1. Keep an explicit operator-required state when
RPC uncertainty or fee starvation cannot be resolved by identical rebroadcast.
All existing register/deposit/withdraw/transfer/mint sends use this coordinator;
leaving a second process-local sender bypass would break nonce safety.

- [ ] Run crash/concurrency tests and existing relay service tests. Check that
  serializing RPC exceptions never leaks signed payloads or secrets in logs.
- [ ] Commit: `feat: journal relayer transactions before broadcasting`.

### Task 8: Reserve requests, verify submissions, and reconcile settlement

**Files:** Create requestOperations.ts, requestSettlement.ts, request-payments
cron route, `web/test/{requestOperations,requestSettlement,requestPayments.route}.test.ts`.
Modify requests router, current cron scheduler in docker-compose.yml, and Mongo accessors.

**Interfaces:** `beginPayment({id: string; revision: number; attemptId: string}): Promise<PaymentOperation>`;
`submitConsolidation(input: SignedSubmission): Promise<PaymentOperation>`;
`submitPayment(input: SignedSubmission): Promise<PaymentOperation>`;
`paymentStatus({id: string}): Promise<PaymentOperation | null>`.
Internal `reconcileRequestOperation(operationId: string): Promise<PaymentOperation>`;
`reconcilePendingRequests({limit: number}): Promise<{examined:number; confirmed:number; unresolved:number}>`.
Cron uses existing CRON_SECRET validation, processes at most 20 operations/run,
and logs only aggregate counts and opaque operation identifiers.

- [ ] Add failing reserve/cancel races, stale revision, outsider/wrong addressee,
  substituted ciphertext, duplicate step, wrong recipient output, direct deposit
  receipt, other-pool receipt, missing Spend, revert, pending hash, and DB-write
  failure after confirmed transfer tests.

```ts
it('cannot mark a request paid from a deposit with the same output', async () => {
  const result = verifyRequestReceipt({
    pool, submission: finalSubmission, transaction: depositTransaction,
    receipt: depositReceipt, confirmations: 1,
  });
  expect(result.valid).toBe(false);
});
it('keeps a broadcast reservation blocked after HTTP timeout', async () => {
  await operations.markUncertain(operationId);
  await expect(service.cancel(requestId, requesterId, revision)).rejects.toThrow();
  await expect(service.beginPayment(requestId, payerId, newAttemptId)).rejects.toThrow();
});
```

Export pure `verifyRequestReceipt` from requestSettlement.ts with the input fields
above; return `{valid:boolean; leafIndex:number|null; reason:string|null}`. Tests
define full fixture transaction input/event logs; do not only compare hashes.

- [ ] Run targeted operation/settlement/route tests; expect FAIL.
- [ ] Implement atomic request reservation, append-only step digests, signed
  addressee checks, pool/capability checks, exact arity (merge: 2 nullifiers/1
  output; preparatory self-split/payment: 1 nullifier/2 outputs), duplicate-input rejection, expected
  output match, and durable journal calls. Verify stored signature/digest before
  retrying an operation. Reject changes to a prior step's body. Rescan prerequisites
  are handled by the browser; the server independently simulates every proof.

```ts
const reserved = await requests.findOneAndUpdate(
  { _id: id, addresseeWallet: callerWallet, status: 'pending', revision, operationId: null },
  { $set: { operationId: attemptId, reservation: { phase: 'preparing', updatedAt: now }, updatedAt: now },
    $inc: { revision: 1 } },
  { returnDocument: 'after', includeResultMetadata: false },
);
if (!reserved) throw new RequestConflictError();
```

Write operation projection after reservation. If that write fails, reconstruct
from embedded reservation; do not release work that may have a signed journal
entry. Each merge confirmation advances nextStep and retains request Pending.
Final receipt verification checks tracked transaction input, correct pool/chain,
successful status, confirmation count, expected Spend and recipient Deposit.
Persist confirmed evidence before CAS Paid. Read/reconciliation retries repair
DB failures idempotently and never trust a client-reported receipt.

Before releasing a 10-minute preparation timeout, reconcile all signed/coordinator
entries for its request. Broadcast/unknown work never becomes retryable by time
alone. Require relayer availability and request-capable scope before beginPayment.
Schedule the protected reconciliation route alongside the existing minute poller;
return promptly with aggregate outcome and resume remaining operations next run.

- [ ] Run tests against the standalone Mongo test DB and mocked RPC uncertainty;
  add a local-chain receipt test before considering settlement complete.
- [ ] Commit: `feat: reconcile private request payments safely`.

### Task 9: Orchestrate browser funding, proofs, and recovery

**Files:** Create selectFunding.ts, requestProofs.ts, requestPayments.ts,
requestNoteRecovery.ts, and `web/test/{selectFunding,requestProofs,requestPayments,requestNoteRecovery}.test.ts`.
Modify prover.ts, scoped chain adapters and notes.ts only at integration boundaries.

**Interfaces:** `selectFunding(notes: readonly MyNote[], amount: bigint, scope: PoolScope): readonly MyNote[]`;
`buildMergeSubmission({record, operation, account, scan, inputIndices, signer}): Promise<SignedSubmission>`;
`buildPaymentSubmission({record, payload, operation, account, scan, inputIndex, signer}): Promise<SignedSubmission>`;
`buildSplitSubmission({record, operation, account, scan, inputIndex, splitAmount, signer}): Promise<SignedSubmission>`;
`payRequest({record, payload, account, signer, onProgress, signal}): Promise<PaymentOperation>`;
`resumeRequestPayment({record, account, signer, onProgress, signal}): Promise<PaymentOperation>`;
`recoverRequestNote({record, payload, scan, account}): Promise<MyNote | null>`.
`onProgress` receives `{phase:OperationPhase; completedMerges:number; txHash:Hex|null}`.
Proof builders keep private witnesses in browser memory; transport is SignedSubmission only.
All builder parameter objects carry concrete Task 1 types plus the existing
`LocalAccount`, `ScanResult`, and `Signer`; input indices are integer leaf indices
in scan.scope, and splitAmount is a positive bigint. Export `MergeInput` from
prover.ts using Task 3's exact witness field names and public-signal ordering,
and `proveMerge(input: MergeInput): Promise<{proof:EvmProof; ms:number}>` following
the existing proveTransfer return convention. No server path receives MergeInput.

- [ ] Write selection and orchestration failures first: a covering single note,
  10+15 covering 20, many small notes, wrong pool, zero/spent notes, stale root,
  interruption after merge, duplicate click, server uncertainty, and missing note
  ciphertext recoverable from encrypted request salt. Include the uint64 edge:
  two individually valid large notes whose sum exceeds uint64 can still fund a
  valid request by splitting off only the needed contribution before merging.

```ts
it('uses a single covering note before consolidating', () => {
  const notes = [makeNote({scope, amount:10n, leafIndex:0}), makeNote({scope, amount:25n, leafIndex:1})];
  expect(selectFunding(notes, 20n, scope).map(n=>n.leafIndex)).toEqual([1]);
});
it('never funds a request using another pool', () => {
  const notes = [makeNote({scope:legacyScope, amount:100n, leafIndex:0})];
  expect(() => selectFunding(notes, 20n, activeScope)).toThrow();
});
```

Define makeNote as a complete MyNote test helper with salt, spent=false and scope.

- [ ] Run the four focused test files; expect missing-function failures.
- [ ] Implement deterministic selection, actual merge witness construction,
  fixed-salt final payment, self-change encryption, signatures, and resume.

```ts
export function selectFunding(notes: readonly MyNote[], amount: bigint, scope: PoolScope) {
  if (amount <= 0n) throw new Error('Invalid payment amount.');
  const eligible = notes.filter(n => n.scope === scope && !n.spent && n.amount > 0n);
  const covering = eligible.filter(n => n.amount >= amount)
    .sort((a,b) => a.amount === b.amount ? a.leafIndex-b.leafIndex : a.amount < b.amount ? -1 : 1);
  if (covering[0]) return [covering[0]];
  const descending = [...eligible].sort((a,b) => a.amount === b.amount ? a.leafIndex-b.leafIndex : a.amount > b.amount ? -1 : 1);
  const chosen: MyNote[] = []; let total = 0n;
  for (const note of descending) { chosen.push(note); total += note.amount; if(total >= amount) return chosen; }
  throw new Error('Your private balance is too low.');
}
```

Each iteration queries the persisted operation, refreshes that pool's contiguous
mirror, selects unspent notes, creates the next proof with a fresh random output
salt, signs the full submission, and sends one step. Wait for confirmation and
discover/verify its output before constructing another proof. Never use cached
plaintext or a new random salt to retry an already journaled step. The full node
salt is encrypted in its submitted output, so after reload ordinary scanning
recovers it; otherwise wait for indexing, rather than fabricate a leaf/path.

If one note covers the amount, submit the exact requester commitment plus change.
For a chosen merge whose sum would exceed uint64, first use the existing transfer
circuit to split the next input into the contribution required for payment and
its remaining balance, both owned by the payer. Treat this as `kind:'split'`
through submitConsolidation, with a signed body, journaled step and two recoverable
outputs. Merge only the required contribution. This is preparation, not partial
payment; it makes the spec's valid-amount/adequate-balance promise hold at the
numeric boundary without weakening Merge's uint64 constraint. Tests must confirm
the unused balance remains private and a split never marks the request Paid.
Verify the generated recipient note by test decrypt/pack consistency using the
known payload; the payer does not possess the requester viewing secret. Request
note recovery matches commitment and leaf, recomputes the owner nullifier, and
consults spent state before inclusion. Dedupe against normally decrypted notes.
Do not expose preparation outputs as income in the request receipt; distinguish
owned consolidation from received payments where the operation evidence identifies it.

AbortSignal stops local work/polling only. It must never convert a submitted
operation into Cancelled or Failed. Account-switch cleanup clears plaintext
and detaches the old progress subscription; the persisted operation survives.

- [ ] Run focused tests, existing notes/withdraw/prover parity tests, and a real
  local-chain 10+15 ->20 transfer sequence with shipped artifacts.
- [ ] Commit: `feat: pay requests from consolidated private balances`.

### Task 10: Integrate the Requests page, modals, and dashboard entry

**Files:** Create page/components/hooks in the file map and
`web/test/{RequestsDashboard,CreateRequestDialog,PayRequestDialog,RequestOperationStatus}.test.tsx`.
Modify Dashboard.tsx, ReceiveDialog.tsx, DashboardShell.tsx, auth-routes.ts,
middleware tests, AppShell protection tests and relevant dashboard tests.

**Interfaces:** `useRequests(direction:'received'|'sent')` returns paginated
metadata, decrypted in-memory display items, loading/error/unlock flags and
terminal actions; `useRequestPayment(request: PaymentRequest | null)` exposes
review balance, active operation, pay/resume, and progress. Components consume
these hooks; never duplicate crypto or state transitions in view files.
Create dialog props: `{open:boolean; onOpenChange(open:boolean):void; onCreated(record:PaymentRequest):void}`.
Pay dialog props: `{request:PaymentRequest|null; open:boolean; onOpenChange(open:boolean):void}`.

- [ ] Write failing UI tests for Received/Sent, independent count, fixed-amount
  review, insufficient active balance with legacy funds, locked/decrypt-error
  states, signature/username lookup failure, confirm decline/cancel, repeated
  Pay clicks, closing modal during submission and switching authenticated account.

```tsx
it('keeps pending payment visible when the review modal closes', async () => {
  render(<RequestsDashboard />);
  await user.click(screen.getByRole('button', { name: 'Review request from @alice' }));
  await user.click(screen.getByRole('button', { name: 'Pay 20 USDC' }));
  await user.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.getByRole('status')).toHaveTextContent('Sending payment');
  expect(screen.queryByText('Paid')).not.toBeInTheDocument();
});
```

Use existing renderWithTRPC and WalletProvider test adapters to supply complete
request/operation fixtures. These tests validate UI behavior, not real settlement.

- [ ] Run these files in existing happy-dom/testing-library conventions; expect FAIL.
- [ ] Implement Requests route protection, active-shell label/back link,
  Received/Sent tab state and load-more pagination; count drives dashboard tile.
  Creation resolves username/key snapshot, creates signed encrypted data and
  redirects to Sent. Receive's username option invokes the same modal.

```ts
export const REQUESTS_PATH = '/requests';
// Include REQUESTS_PATH in DASHBOARD_PATHS to retain existing protection rules.
```

Use existing linen/glass primitives and dashboard layout; no new sidebar or
global visual redesign. Paid/declined/cancelled rows are read-only. Loading is
different from empty, a failed fetch offers retry, locked rows offer unlock,
and unsupported pools/relayer unavailable explain why Pay is disabled. Do not
show a fake zero balance on scan failure. Render amounts from bigint/base units,
not lossy Number conversions; review shows exact token precision.
Use native Base UI dialog focus management, Escape/close, aria labels, and a
polite live progress region; avoid announcing every poll. Confirmation closes
only after the action is acknowledged. On account changes, clear decrypted
queries and modal state so another user's plaintext cannot flash on screen.

- [ ] Run focused UI/auth tests and inspect browser layout at 360px and desktop.
  Check actual dashboard integration; the conversation preview is not a screenshot
  of these components and cannot substitute for browser evidence.
- [ ] Commit: `feat: add payment request page and action dialogs`.

### Task 11: Verify the full feature and prepare deployment without activation

**Files:** Create `web/test/requestPayments.integration.test.ts`, browser smoke
harness `web/test/requests.browser.test.ts`, deployment tests
`contracts/test/deploymentConfig.test.ts`, and `docs/request-payments-operations.md`.
Modify deploy.ts, its isolated config-output helper, README, docs/features.md,
reference.md and local-setup.md; add documented local integration test scripts.

**Interfaces:** Deployment preparation emits pool manifest and indexer candidate
configuration to an explicitly specified output directory. It must not overwrite
web/.env.local or indexer/config.yaml by default. Preserve legacy descriptors and
registry addresses; require an explicit activation option outside this plan.
Integration fixture provides an isolated local chain, disposable Mongo DB,
funded relayer, real signed encrypted records/proofs, and scoped indexers.

- [ ] Write failing local-chain integration scenarios for create ->merge ->pay,
  multiple merges ->reload ->resume, two independently valid attempts targeting
  one commitment, declined/cancelled operations, unknown broadcast ->reconcile,
  missing event ciphertext ->request note recovery, and legacy withdrawal after
  activating a new descriptor in the isolated fixture.

```ts
it('settles a full request and retains five USDC privately', async () => {
  const scenario = await createLocalRequestScenario({ payerNotes:['10','15'], amount:'20' });
  await scenario.payAndReconcile();
  expect(await scenario.requestStatus()).toBe('paid');
  expect(await scenario.payerPrivateBalance()).toBe(5_000_000n);
  expect(await scenario.requesterPrivateBalance()).toBe(20_000_000n);
  expect(await scenario.poolTokenBalance()).toBe(25_000_000n);
});
```

Define `createLocalRequestScenario` in this integration test's helper with actual
contracts, actual artifacts, real Mongo and service/router entry points. Service
tests with trusted test identities are distinct from Privy-token validation.
Browser smoke uses real configured Privy accounts and the local test chain;
if interactive sign-in is needed, request only that missing user action and
continue other evidence. No production bypass/mock-auth flag ships in the app.

- [ ] Run the integration command with a specifically isolated database and
  chain. Expect FAIL before complete wiring, then implement only missing feature
  wiring/config-output behavior discovered by those tests.

```ts
function deploymentOutputPaths(directory: string) {
  return {
    manifest: path.join(directory, 'pool-manifest.json'),
    publicEnv: path.join(directory, 'web.env.candidate'),
    indexer: path.join(directory, 'indexer.config.candidate.yaml'),
  };
}
```

Deployment fixture tests copy sample config into a temporary test-owned directory,
assert that legacy entries remain and only candidate files change, and never
invoke the real deploy script against testnet. Write the runbook: circuit
artifact hashes/capacity, local migration invocation, legacy manifest values,
new-pool deploy preparation, explicit activation review, scoped indexer warmup,
relay balance monitoring, reconciliation job, rollback-to-old-config procedure,
and withdrawal access to both pools. Rolling back configuration cannot roll back
mined transfers; preserve journal and indexed history.

- [ ] Run required verification serially where outputs share artifacts:

```powershell
pnpm --filter contracts build
pnpm --filter contracts test
node circuits/test/merge.test.cjs
pnpm --filter web test
pnpm --filter web lint
pnpm --filter web build
pnpm --dir indexer codegen
pnpm --dir indexer typecheck
pnpm --dir indexer test
git diff --check
git diff --cached --check
```

The existing `web lint` script uses `next lint`; record baseline tool failure if
unsupported by installed Next instead of claiming success. Run the configured
Biome check on changed files as a supplemental check, not a substitute secretly
presented as the original lint passing. The circuits package's existing `test`
script is a placeholder; use the real circuit test command created in Task 3.
Do not install/update tools just to hide a baseline failure.

- [ ] Browser smoke at desktop/mobile covers real creation, signature/unlock,
  payment progress, resume, count/status changes, insufficient active balance,
  and legacy withdrawal. Log exactly which parts used actual auth, real RPC,
  disposable DB or mocks. Publish no screenshot containing confidential data.
- [ ] Review every spec acceptance criterion against evidence; stop release
  handoff if double-payment, privacy, rollback or nonce-recovery evidence fails.
- [ ] Commit only feature/docs/tests: `test: verify request payment lifecycle and deployment boundaries`.

## Self-review map

| Spec section | Tasks |
| --- | --- |
| Product flow and status rules | 6, 8, 10 |
| Encryption, signature, memory-only secrets, snapshots | 1, 2, 6, 9, 10 |
| Auth, pagination, idempotency, rate limits | 1, 6, 8 |
| Merge proofs, arbitrary fragmentation, no partial payout | 3, 9, 11 |
| Duplicate output and confirmed exact settlement | 3, 7, 8, 11 |
| Ciphertext integrity and request note reconstruction | 2, 8, 9, 11 |
| Durable nonce ownership, restart/retry, reservation races | 6, 7, 8, 11 |
| Legacy balances, scoped indexing, deployment boundaries | 4, 5, 11 |
| UI, accessibility, mobile, independent pending count | 10, 11 |
| Actual proof/DB/browser evidence and limits | All focused tests, final Task 11 |

The required test-cycle snippets define critical invariants; implementations
also include the explicitly enumerated cases in each task. New helper names
and transport contracts are established in the owning task's Interfaces block.
Before each scoped commit, inspect staged/unstaged/untracked paths and verify
the user's unrelated indexer changes have not been staged or overwritten.

No unresolved spec coverage gaps remain in this plan. The uint64 self-split
preparation in Task 9 is a numeric-boundary implementation of the approved
adequate-total-balance promise, not a new partial-payment feature. It uses the
existing transfer circuit and adds no separate user flow.

## Execution handoff

Review this plan before implementation and select the execution method:

- **Subagent-driven:** separate implementer and reviewer per task, then a branch
  review. Recommended here because cryptographic constraints, database recovery,
  and settlement interact across several boundaries and a mistake could lose access
  to private funds or duplicate a payment. No subagents are dispatched during planning.
- **Native:** implement tasks in this session with one final independent review.
  Lower coordination overhead; errors can travel farther before independent review.

No implementation, dependency install, migration, live transaction, deployment,
or push has been authorized or performed by writing this plan.

## Documentation checked during planning

Context7 primary-library sources checked on 2026-10-05:

- [viem local transaction preparation/signing](https://github.com/wevm/viem/blob/main/site/pages/docs/actions/wallet/prepareTransactionRequest.md)
  and [raw broadcast](https://github.com/wevm/viem/blob/main/site/pages/docs/actions/wallet/sendRawTransaction.md).
- [MongoDB driver v6 document-return behavior](https://github.com/mongodb/node-mongodb-native/blob/main/etc/notes/CHANGES_6.0.0.md)
  for single-document atomic findOneAndUpdate/CAS (no `.value` wrapper by default).
- [Circom quadratic constraints](https://github.com/iden3/circom/blob/master/mkdocs/docs/circom-language/constraint-generation.md).

Installed package versions and current repository interfaces were read directly.
Fetch current Noble, Envio, and other library-specific docs when their tasks are
executed; do not infer APIs solely from these conceptual snippets.
