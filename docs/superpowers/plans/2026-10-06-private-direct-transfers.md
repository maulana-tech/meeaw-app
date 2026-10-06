# Private Direct Transfers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method remains for the user to select; no agents are dispatched by this document.

**Goal:** Send USDC from private balance directly to another registered @username with an encrypted optional note, recoverable progress, and accurate participant history.

**Architecture:** Add signed participant-encrypted transfer records and a Transfers API, using the existing Merge/transfer circuits and durable relay journal. Extract only shared funding, submission evidence, and spend coordination primitives needed by both Requests and Transfers. Integrate Send into the balance card and normalize History from confirmed business operations and actual withdrawal evidence.

**Tech Stack:** Existing TypeScript, Next.js/React, tRPC, MongoDB, Noble cryptography, viem, snarkjs, Vitest/Testing Library, and Hardhat dependencies. No dependency installation or circuit generation is planned.

**Spec:** `docs/superpowers/specs/2026-10-06-private-direct-transfers-design.md` (approved in conversation before this plan).

## Global Constraints

- Send button on the balance card; modal input and confirmation; no new navigation destination.
- Input: username, USDC amount, optional encrypted note of at most 200 Unicode code points.
- Amount: 1 through `2^64 - 1` base units; parse using pool decimals, never floats.
- Active USDC pool only; reject self-transfers; legacy balances remain withdrawal-only.
- Exactly one nonterminal outgoing send per sender and pool across devices.
- Preserve Requests contracts and behavior; do not create artificial payment requests.
- Encrypt separately to both participant viewing keys; use a distinct transfer signing/encryption domain.
- Server never receives plaintext amount/note/salt or private keys through transfer APIs.
- Confirm only matching transaction calldata/events at configured confirmation depth.
- Persist relay-signed bytes before broadcast; uncertain outcomes cannot permit a new payment.
- Shared spend reservations cover Transfers, Requests, and withdrawals; MongoDB is standalone.
- No contract/verifier/circuit change, deployment, activation, push, merge, or unrelated refactor.
- Do not commit unless the user authorizes commits. Each task includes a scoped checkpoint, not automatic delivery.
- Use installed dependency versions. Before library-specific implementation, fetch current documentation through Context7 as required by AGENTS.md.

## Review Focus

1. Recipient key changes after review: require review again; never silently encrypt to new keys (Tasks 1, 9).
2. Crash between saving signed bytes and projecting status: recover identical bytes and keep spend claims pinned (Tasks 2, 6).
3. Conflicting Cash out/Request in another tab: reject the competing spend without charging it or marking Send successful (Tasks 2, 6, 10).
4. Browser/account change during proof generation: discard stale results and never submit under the new session (Task 7).
5. Lost chain ciphertext or spent source notes: recover owned outputs, preserve sent amount, and avoid fictitious cash-outs/change income (Tasks 5, 8).

## Execution setup and verification conventions

At execution time read the spec and applicable AGENTS.md files, inspect staged,
unstaged, and untracked changes, and use the using-git-worktrees skill if isolation
is needed. The inspected checkout is `feature/username-payment-requests`; do not
choose another base or copy uncommitted work implicitly. Both design documents are
currently local artifacts, so preserve/copy them explicitly if execution moves.

Web commands below run from `web/`: `pnpm test -- <test files>` expands to Vitest
run. Contract commands run from `contracts/`. Use Windows-compatible commands and
run commands sharing artifacts serially. RED means a relevant assertion fails;
module-not-found during the initial new test is acceptable only until the module
exists. GREEN requires actual command success, not a plan checkbox.

Real Mongo tests use an explicitly isolated database name prefixed
`mawee_direct_transfers_test_`; verify that name before cleanup and never mutate the
application database. Use the existing test isolation patterns. If Mongo/RPC is
unavailable, report blocked integration evidence rather than treating skipped tests
as passing. Do not print environment secrets.

## File structure and dependency order

| Unit | Files | Responsibility |
| --- | --- | --- |
| Transfer wire contract | `web/src/features/transfers/{types,validation,transferTypedData,transferCrypto}.ts` | Exact signed intent/submission formats; validation; participant envelopes |
| Shared submission primitives | `web/src/features/payments/{funding,proofOutputs,submissionTypes}.ts` | Pool-scoped funding, proof outputs, encrypted recovery data; request adapters |
| Spend coordinator | `web/src/server/lib/spendReservations.ts` | CAS-owned sender/pool and nullifier claims; fenced dispatch and safe cleanup |
| Persistence and API | `web/src/server/modules/transfers/transfers.{repository,schema,service,router,errors}.ts` | Authenticated intent and list/get/operation endpoints |
| Operations | `web/src/server/modules/transfers/{transferOperations,transferSettlement}.ts` | Submission authorization, durable relay, reconciliation |
| Client proof/recovery | `web/src/features/transfers/{transferProofs,transferNoteRecovery}.ts` | Merge/split/send proof building and verified owned-output recovery |
| Client orchestration | `web/src/features/transfers/hooks/{useDirectTransfer,useTransfers}.ts`, `web/src/features/transfers/transferStatusMonitor.ts` | Resume, polling, participant list, session checks |
| History evidence | `web/src/features/payments/{activityTypes,activityEvidence,activityRows}.ts` | Chain-backed semantic classification and participant row deduplication |
| UI | `web/src/components/dashboard/{SendTransferDialog,TransferProgress,PendingTransfersNotice,TransferDetailsDialog}.tsx` | Input, review, progress, pending entry point, detail |
| Migrations | `web/migrations/20261006100000-private-transfers.js`, `20261006110000-spend-reservations.js` | Collections and participant/state indexes; no TTL deletion of active operations |
| Fixtures | `web/test/helpers/transferFixtures.ts`, `spendFixtures.ts`, `transferOperationHarness.ts` | Real crypto, isolated DB, injected relay/receipt failure boundaries |

Tasks 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11.
Later tasks consume exported interfaces below; avoid implicit alternate naming.

### Task 1: Signed encrypted transfer intent

**Files:** Create transfer types/validation/typed-data/crypto files and
`web/test/{transferValidation,transferCrypto,transferTypedData}.test.ts`,
`web/test/helpers/transferFixtures.ts`. Consume existing `LocalAccount`, `Signer`,
`PoolDescriptor`, participant/envelope primitives, and test account/signers.

**Interfaces:** Export these types from transfer `types.ts`; keep request types
compatible and use adapters rather than renaming their roles.

```ts
type TransferParticipant = {
  username: string; wallet: Hex; notePubkey: Hex; viewPubkey: Hex;
};
type TransferMetadata = {
  version: 1; id: string; pool: PoolScope; sender: TransferParticipant;
  recipient: TransferParticipant; createdAt: string; recipientCommitment: Hex;
};
type TransferPayload = { metadata: TransferMetadata; amount: string; note: string; salt: string };
type SignedTransfer = TransferMetadata & {
  senderEnvelope: Envelope; recipientEnvelope: Envelope; signature: Hex;
};
type TransferReceipt = { txHash: Hex; leafIndex: number; block: number; confirmedAt: string };
type TransferRecord = SignedTransfer & {
  status: 'pending' | 'confirmed' | 'failed'; revision: number;
  operationId: string; updatedAt: string; receipt: TransferReceipt | null;
};
type TransferPage = { items: TransferRecord[]; nextCursor: string | null };
```

`Hex`, `PoolScope`, and `Envelope` are exported aliases of existing compatible
wire primitives. Define `CreateTransferInput` as `{id:string; pool:PoolDescriptor;
sender:TransferParticipant; recipient:TransferParticipant; account:LocalAccount;
signer:Signer; amount:bigint; note:string; createdAt:string}`.
Export `createSignedTransfer(input:CreateTransferInput):Promise<SignedTransfer>`,
`openTransfer(record:SignedTransfer,account:LocalAccount,pool:PoolDescriptor):Promise<TransferPayload>`,
`parseTransferAmount(raw:string,decimals:number):bigint`, and
`validateTransferNote(note:string):string`. `transferTypedData` returns typed-data
parameters matching the signer interface and binds all immutable record content.

- [ ] RED: create `makeTransferFixture()` using existing real test accounts and
  signers, returning `{record,payload,sender,recipient,outsider,pool}`. Encrypt/sign
  a 20-USDC payload with note `Lunch`. Start with:

```ts
it('opens identical content only for the two participants', async () => {
  const f = await makeTransferFixture();
  expect(await openTransfer(f.record, f.sender, f.pool)).toEqual(f.payload);
  expect(await openTransfer(f.record, f.recipient, f.pool)).toEqual(f.payload);
  await expect(openTransfer(f.record, f.outsider, f.pool)).rejects.toThrow();
});
```

- [ ] Run `pnpm test -- test/transferValidation.test.ts test/transferCrypto.test.ts test/transferTypedData.test.ts`.
- [ ] Implement bounded schemas, fixed 4096-byte plaintext frames, independent
  ephemeral keys/nonces, XChaCha20 envelopes, and distinct
  `mawee.transfer.envelope.v1`/transfer EIP-712 domain. Reuse existing crypto
  primitives; verify record signature before decrypting and commitment after.
- [ ] Add tests for 200/201 emoji code points, whitespace, empty note, decimal
  precision, uint64 limits, self-wallet, wrong scope, corrupted ciphertext,
  swapped envelopes/roles, altered recipient key, altered commitment, and replay
  of a request signature as a transfer. Envelope byte lengths are identical for
  empty and full notes; errors never include note content.
- [ ] GREEN: run the three suites plus `test/requestCrypto.test.ts` and
  `test/requestTypedData.test.ts`. Checkpoint only the files in this task.

### Task 2: Shared spend reservations and fenced dispatch

**Files:** Create `spendReservations.ts`, reservation migration and
`web/test/{spendReservations,spendMigrations}.test.ts`, `helpers/spendFixtures.ts`.
Modify request operation submission and relay service Withdraw/Transfer entry
points plus `relayJournal.ts`/`durableRelayer.ts` only where fencing is needed.

**Interfaces:** Define `SpendOwner = {kind:'transfer'|'request'|'withdraw'|'ordinary-transfer';
id:string;sender:Hex;scope:PoolScope}` and `SpendClaim = {owner:SpendOwner; fence:number;
nullifiers:readonly Hex[]; phase:'reserved'|'dispatching'|'signed'|'uncertain'}`.
`SpendReservations(db:Db)` exposes:

```ts
claim(owner: SpendOwner, nullifiers: readonly Hex[], now: Date): Promise<SpendClaim>;
enterDispatch(claim: SpendClaim): Promise<SpendClaim>;
pinSigned(claim: SpendClaim, operationKey: string): Promise<void>;
release(claim: SpendClaim, evidence: 'unsigned-abandoned' | 'confirmed' | 'reverted'): Promise<void>;
reconcile(limit: number): Promise<{examined:number; released:number; unresolved:number}>;
```

Implementation uses a CAS coordinator document per sender/pool with an embedded
claim and incrementing fence; nullifier ownership documents have unique scoped
IDs. Acquire nullifier claims in deterministic order and compensate only owned,
unsigned claims on partial failure. Validate signed operation/proof shape and
simulate before permitting arbitrary nullifier reservations. Pin `dispatching`
before relayer signing; it never expires automatically. Recovery consults the
durable journal and accepted submission before releasing it. A crashed dispatch
cannot race expired cleanup into a different spend. No active TTL index.

- [ ] RED: real isolated Mongo fixture exports `{first,second,close}` where both
  are coordinators connected to the same database. Define constants `ownerA`,
  `ownerB` as different operation IDs for one sender/scope, and `nfA` as bytes32.

```ts
it('rejects another worker and keeps dispatch pinned beyond lease expiry', async () => {
  const f = await makeSpendFixture();
  try {
    const a = await f.first.claim(ownerA, [nfA], new Date('2026-10-06T00:00:00Z'));
    await f.first.enterDispatch(a);
    await expect(f.second.claim(ownerB, [nfA], new Date('2026-10-07T00:00:00Z'))).rejects.toThrow();
  } finally { await f.close(); }
});
```

- [ ] Run the reservation/migration suites; implement CAS filters including fence,
  owner, and current phase. Default unsigned lease is 60 seconds, renewable by
  the owning preparer. On expiration transition the previous owning operation
  safely before granting a new claim; stale callers cannot sign afterward.
- [ ] Route request payment/consolidation and every server relay withdrawal/
  ordinary transfer through the coordinator. Existing recovery retries identify
  the same operation. Thread `privyUserId` through ordinary relay service callers
  to derive verified sender ownership; never trust a supplied sender address.
  Change existing relay input/output schemas only additively where an idempotency
  ID is required, and update their callers in the same task.
- [ ] Add races for partial acquisition cleanup, request vs send, withdrawal vs
  send, stale fence release, DB failure after relay signing, and an invalid proof
  claiming another user's nullifier. No malformed caller can pin a valid user's
  spend by supplying unverified inputs.
- [ ] GREEN: reservation/migration suites plus existing `requestOperations`,
  `relay.router`, `durableRelayer`, `durableOrdinaryRelayer`, `relayJournal`, and
  `withdraw` suites. Preserve ordinary retry behavior. Scoped checkpoint.

### Task 3: Transfer persistence and authenticated intent API

**Files:** Create transfers repository/schema/service/router/errors, transfer
collection migration, `web/test/transfers.{repository,service,router}.test.ts`,
`web/test/transferMigrations.test.ts`. Modify `server/db/mongo.ts`, `server/root.ts`.

**Interfaces:** Export `getTransfers():Promise<Collection<TransferDoc>>` where
`TransferDoc` is `TransferRecord` with `_id=id` and server operation data. Each
record embeds operation state so intent creation + initial operation is one
document write. Expose `api.transfers.create({record:SignedTransfer})`,
`list({direction:'sent'|'received'|'all',cursor?:string})`, and `get({id:string})`.
Return `TransferRecord`, `TransferPage`, `TransferRecord` respectively. `create`
returns the existing record only for an identical signed digest and ID.

- [ ] RED: fixture contract `makeTransferRepositoryFixture()` returns
  `{repo,record,senderWallet,recipientWallet,outsiderWallet,close}`; `repo` provides
  `create(record)`, `getForParticipant(wallet,id)`, `listForParticipant(wallet,input)`.

```ts
it('persists one intent on retry and hides it from outsiders', async () => {
  const f = await makeTransferRepositoryFixture();
  try {
    await f.repo.create(f.record);
    await f.repo.create(f.record);
    expect((await f.repo.listForParticipant(f.senderWallet, {direction:'sent'})).items).toHaveLength(1);
    await expect(f.repo.getForParticipant(f.outsiderWallet, f.record.id)).rejects.toThrow('Not found');
  } finally { await f.close(); }
});
```

- [ ] Run repository/service/router/migration suites to RED.
- [ ] Implement signature and registry snapshot checks, authenticated wallet
  ownership, active pool gate, duplicate digest conflict, and participant-only
  projection. A partial unique index on sender/pool for `status:'pending'` enforces
  one pending outgoing send. Stable cursor uses creation time + ID, page size 20;
  received lists only expose accepted participant records. Initial operation ID
  is persisted with intent so a crash cannot orphan an invisible active send.
- [ ] Add tests for key changes between review and create, wrong signer/session,
  outsider get/list/status, same ID with altered body, cursor ties, and simultaneous
  creates. Store no plaintext payload fields. Map failures to bounded generic
  errors and register `transfers: transfersRouter` in `appRouter`.
- [ ] GREEN: the four suites and existing Requests router/service/repository.
  Migration down only drops newly created transfer indexes/collections after
  explicit operational authorization; do not run down against application data.

### Task 4: Shared proof outputs and direct transfer submissions

**Files:** Create shared payment funding/proofOutputs/submissionTypes and
`features/transfers/transferProofs.ts`, tests `transferProofs.test.ts` and
`paymentProofOutputs.test.ts`. Modify request proof helpers via adapters.

**Interfaces:** Re-export funding selection/action interfaces from their existing
implementation or move them with request compatibility exports. Define:

```ts
type TransferSubmissionBody = {
  version:1; transferId:string; operationId:string; step:number; pool:PoolScope;
  kind:'merge'|'split'|'payment'; root:Hex; nullifiers:readonly Hex[];
  proof:ProofWire; outputs:readonly NoteOutput[]; recoveryEnvelope:Envelope;
};
type SignedTransferSubmission = TransferSubmissionBody & {signature:Hex};
type TransferOperation = {
  id:string; transferId:string; phase:'preparing'|'submitting'|'submitted'|'confirmed'|'failed'|'needsReconciliation';
  nextStep:number; txHash:Hex|null; updatedAt:string;
};
```

`ProofWire` and `NoteOutput` alias existing compatible wire types. Export
`buildTransferSubmission(c:TransferProofContext,action:FundingAction):Promise<SignedTransferSubmission>`;
context is `{record:TransferRecord;operation:TransferOperation;account:LocalAccount;
scan:ScanResult;pool:PoolDescriptor;signer:Signer}`. New signing domain binds recovery
ciphertext as well as proof/body. Do not cast a transfer into `SignedRequest`.

- [ ] RED: fixture `makeTransferProofFixture({amounts:readonly bigint[],amount:bigint})`
  supplies context and decryptable output expectations; use actual commitment/
  encryption code and spy only expensive proof generation at the unit boundary.

```ts
it('binds the fixed recipient output and private change', async () => {
  const f = await makeTransferProofFixture({amounts:[25n],amount:20n});
  const s = await buildTransferSubmission(f.context, {kind:'payment',inputIndex:f.inputIndex});
  expect(s.outputs[0].commitment).toBe(f.context.record.recipientCommitment);
  expect(f.decryptSenderOutput(s.outputs[1]).amount).toBe(5n);
  expect(s.transferId).toBe(f.context.record.id);
});
```

- [ ] Run proof suites to RED; implement Merge/split/final builders with fresh
  scoped roots, local owner validation, signature verification, field-range and
  input shape validation, and exact final intent payload. Sender-only recovery
  envelope contains owned output amounts/salts/commitments, submission identity,
  and output position; persist it before broadcast through accepted submissions.
- [ ] Add fixed-size recovery-frame validation: one/two owned outputs fit the
  bounded frame. Reject stale scan, wrong account/pool, altered payload, zero or
  spent funding, uint64 overflow, and recipient/change swaps.
- [ ] GREEN: new suites plus existing `selectFunding`, `requestProofs`, and
  `requestCrypto`. Request signing/envelope domains remain unchanged.

### Task 5: Recover transfer notes after missing output delivery

**Files:** Create `transferNoteRecovery.ts`, `web/test/transferNoteRecovery.test.ts`;
modify `lib/notes.ts` with additive transfer recovery and avoid import cycles.

**Interfaces:** `recoverTransferNotes(input:{record:TransferRecord;
submissions:readonly SignedTransferSubmission[];evidence:readonly ConfirmedTransferStep[];
account:LocalAccount;scan:ScanResult;pool:PoolDescriptor}):Promise<readonly MyNote[]>`.
`ConfirmedTransferStep = {step:number;txHash:Hex;block:number;confirmedAt:string;
outputs:readonly {position:number;leafIndex:number;commitment:Hex}[]}` is participant
projection of server-verified steps. Recovery never trusts a client-provided hash.

- [ ] RED: extend the proof fixture with a confirmed-step factory that uses the
  correct scoped scan leaves and transaction identity.

```ts
it('recovers recipient amount only at the verified matching leaf', async () => {
  const f = await makeTransferRecoveryFixture();
  const notes = await recoverTransferNotes(f.recipientInput);
  expect(notes.find(n => n.leafIndex === f.recipientLeaf)?.amount).toBe(20n);
  await expect(recoverTransferNotes(f.wrongScopeInput)).rejects.toThrow();
});
```

- [ ] Run recovery suite to RED. Reconstruct recipient from signed intent salt;
  reconstruct sender Merge/split/change outputs from signed encrypted recovery
  envelope. Recompute commitment, verify ownership, compare scoped leaf and step
  evidence, determine spent status from nullifier evidence, and deduplicate by
  pool/leaf. Never mark an operation confirmed from reconstructed note alone.
- [ ] Tests: fresh account unlock, unreadable envelope, wrong leaf/commitment,
  missing confirmation, ciphertext loss, spent recovered output, and outsider.
- [ ] GREEN: transfer recovery plus existing `requestNoteRecovery`, `notes`,
  `notesPrivacy`, `notesSession`, and `poolMirror` tests.

### Task 6: Durable transfer operation and settlement endpoints

**Files:** Create `transferOperations.ts`, `transferSettlement.ts`, tests
`transferOperations.test.ts`, `transferSettlement.test.ts`, and
`helpers/transferOperationHarness.ts`; extend transfers router/schema/service.
Modify cron request-payments route and its existing route test, leaving the
authenticated cron URL usable by current deployment.

**Interfaces:** Expose `api.transfers.status({id}) -> TransferOperation`,
`submit({submission:SignedTransferSubmission}) -> TransferOperation`,
`resume({id}) -> TransferOperation`, and
`evidence({id}) -> {submissions:SignedTransferSubmission[];steps:ConfirmedTransferStep[]}`.
Evidence is participant-only; sender-only envelopes remain encrypted.
Export `reconcilePendingTransfers({limit:number}):Promise<{examined:number;confirmed:number;unresolved:number}>`.
Extract compatible pure submission encoding/evidence primitives from request
settlement; `verifyTransferReceipt` takes the current verifier input shape but a
transfer submission and `recipientCommitment`, returning its existing
`{valid:boolean;leafIndex:number|null;reason:string|null}` shape.

- [ ] RED: the harness wraps real Mongo repositories/reservations/journal and an
  injected chain port with `broadcasts:Hex[]`, `signCount:number`, configurable
  receipts, and `failNextProjectionWrite()`. Its `submit(s)` invokes the actual
  service with fixture auth; `reconcile()` invokes the actual reconciler.

```ts
it('reconciles a lost status write without another signed transaction', async () => {
  const f = await makeTransferOperationHarness();
  try {
    f.failNextProjectionWrite();
    await f.submit(f.finalSubmission).catch(() => {});
    await f.reconcile();
    expect(f.signCount).toBe(1);
    expect((await f.read()).status).toBe('confirmed');
  } finally { await f.close(); }
});
```

- [ ] Run operation/settlement suites to RED. Implement record CAS on revision,
  operation ID, step and phase; validate sender signature, active scope, existing
  fixed final commitment, input/output arity, encrypted output/recovery bounds,
  and proof simulation. Persist accepted submission before acquiring dispatch
  authorization and before relayer signing. Durable operation key is
  `transfer:<id>:<step>`, digest bound to exact calldata and confirmation settings.
- [ ] Integrate Task 2 claims and the durable journal; reuse recorded signed bytes
  on unknown outcomes. Record confirmed preparatory evidence, advance one step,
  return preparing; only final matching receipt changes status to confirmed.
  Final revert terminates safely with sender preparation funds still available.
  Unknown/pending/reorged insufficient-confirmation receipts stay pending.
- [ ] Extend cron response with `transfers` and spend-cleanup summaries; keep
  existing auth/config gates and request summaries. Status endpoints remain
  read-only DB projections. Reconciliation is bounded and idempotent across workers.
- [ ] Test unrelated receipt, wrong chain/pool/calldata/ciphertext/nullifier,
  insufficient confirmations, duplicate changed submission, two workers, accepted
  submission crash, lost signed projection, unknown broadcast, reverted final
  payment, safe unsigned abandonment, and stuck dispatch recovery. Failed before
  spending releases safely; timeout never authorizes a new operation.
- [ ] GREEN: new suites, existing Requests operations/settlement/route, journal,
  and durable relay suites. Mock chain boundaries do not count as real-chain proof.

### Task 7: Client orchestration and status polling

**Files:** Create transfer hooks/status monitor; tests `directTransfer.test.tsx`,
`transferStatusMonitor.test.ts`, `transferListPolling.test.tsx`.

**Interfaces:** `useDirectTransfer(record:TransferRecord|null)` returns
`{operation:TransferOperation|null;working:boolean;error:string|null;
checking:boolean;continueSend():Promise<TransferOperation|null>}`.
`useTransfers(direction:'sent'|'received'|'all')` returns participant records,
pending send, stable pagination, loading/error, and refetch. Status monitor keys
include lowercase wallet + transfer ID, reference-counts subscribers, and stops
on terminal status/unmount/identity change. No note plaintext in query-cache keys.

- [ ] RED: hook fixture renders through existing `renderWithTRPC.tsx`, mocks
  API/scan/prover boundaries and holds a controllable promise for proof completion.

```ts
it('discards proof results after account change', async () => {
  const f = await makeDirectTransferHookFixture();
  const pending = f.start();
  f.changeAccount();
  f.finishProof();
  await pending;
  expect(f.submitted).toHaveLength(0);
});
```

- [ ] Run hook/polling suites to RED. On resume fetch record + operation, unlock,
  decrypt intent, fresh-scan with recovery, choose funding action, build and submit
  one step, wait for confirmed evidence, then refresh before choosing next step.
  Check session token/account/pool before and after each asynchronous boundary.
  Reopen submitted operations in monitor-only mode; never rebuild a final proof
  from stale local progress. Only explicit Continue restarts preparation.
- [ ] Test 10+15 sends 20, three inputs, split overflow, stale indexer, relayer
  unavailable, insufficient active funds with sufficient legacy funds, modal
  subscriber removal, reload after Merge, and lock during signing. Invalidate
  transfer records, private notes, activity evidence, and balances on confirmation.
- [ ] GREEN: new suites plus Requests payment/polling and `useMyNotes` suites.

### Task 8: Evidence-based participant history

**Files:** Create shared activity types/evidence/rows; modify
`ActivityFeed.tsx`, `HistoryDashboard.tsx`, `dashboardAnalytics.ts`, `Dashboard.tsx`,
`useMyNotes.ts` only as needed; add `activityRows.test.ts`, `activityEvidence.test.ts`,
`HistoryDashboard.test.tsx`, and update dashboard analytics tests.
Extend `deposits` participant evidence API with actual withdrawal evidence rather
than inferring cash-out from a note's spent timestamp.

**Interfaces:** Define `ActivityRow = {id:string;scope:PoolScope;
kind:'received'|'sent'|'cashedOut'|'attempt'|'unclassified';status:'pending'|'confirmed'|'failed';
amount:bigint|null;note:string|null;counterparty:string|null;at:string;txHash:Hex|null;
leafIndex:number|null;locked:boolean;transferId:string|null}`.
`buildActivityRows(input:{notes:readonly MyNote[];transfers:readonly TransferRecord[];
payloads:ReadonlyMap<string,TransferPayload>;steps:readonly ConfirmedTransferStep[];
evidence:readonly PaymentActivityEvidence[];viewer:Hex}):readonly ActivityRow[]`.
`PaymentActivityEvidence = {scope:PoolScope;txHash:Hex;block:number;at:string;
kind:'deposit'|'merge'|'split'|'transfer'|'withdraw';inputs:readonly Hex[];
outputs:readonly {commitment:Hex;leafIndex:number}[];withdrawAmount:string|null}`.
Evidence classifies decoded calldata against receipt events; participant-specific
owned-note associations are calculated in the browser. Respect scope/indexer
watermarks and chain confirmation depth; do not infer from absent RPC data.

- [ ] RED: pure fixture has real business transfer of 20, sender change 5, and
  Merge output 25, with evidence associations for all three.

```ts
it('shows one send and no consolidation income or fictitious cash-out', () => {
  const f = makeActivityFixture();
  const rows = buildActivityRows(f.senderInput);
  expect(rows.filter(r => r.kind === 'sent').map(r => r.amount)).toEqual([20n]);
  expect(rows.filter(r => r.kind === 'cashedOut')).toHaveLength(0);
  expect(rows.some(r => r.kind === 'received' && r.amount === 5n)).toBe(false);
});
```

- [ ] Run activity/history suites to RED. Read public verified transaction evidence
  in bounded batches with cached scope/hash keys, after authenticated participant
  request validation. Decode actual withdrawal amount, preserving sequential
  withdrawals of separate notes. Join request business events and transfer records
  by fixed output/transaction; exclude preparatory self-transfers and owned change.
  Generic incoming transfer without a business record remains a received note only
  if evidence classifies it as recipient rather than sender change. Unknown evidence
  is an explicitly unclassified/awaiting-detail row, not fake income or cash-out.
- [ ] Confirmed rows use block time and stable scoped IDs. Locked rows have null
  amount/note, no decrypted cache persistence; unreadable metadata is distinct from
  zero. Preserve receipt access for genuine received notes and show pending/failed
  transfers as attempts. Filters All/Received/Sent/Cashed out use business kind.
- [ ] Update weekly analytics to consume the same normalized rows, adding sent
  totals without counting Merge/change; retain its existing consumers in one task.
  CSV escapes commas/quotes/newlines and neutralizes leading formula characters
  in user text while preserving numeric amounts and direction.
- [ ] GREEN: new suites plus existing `dashboardAnalytics`, disclosure, note,
  withdrawal, and Requests activity regressions. Scope all matching by pool, never
  leaf index alone. No change to disclosure cryptographic claims.

### Task 9: Send modal, pending entry point, and History details

**Files:** Create SendTransferDialog/TransferProgress/PendingTransfersNotice/
TransferDetailsDialog; modify BalanceCard/Dashboard/HistoryDashboard/ActivityFeed.
Tests `SendTransferDialog.test.tsx`, `PendingTransfersNotice.test.tsx`,
`TransferDetailsDialog.test.tsx`, and existing BalanceCard tests.

**Interfaces:** `BalanceCard` adds `onSend?:()=>void`.
`SendTransferDialog({open,onOpenChange,onCreated}):JSX.Element` where
`onCreated(record:TransferRecord):void` records the returned active intent.
`TransferProgress({record,onClose}):JSX.Element` uses Task 7 orchestration;
`PendingTransfersNotice({record,onOpen}):JSX.Element` remains visible when locked;
`TransferDetailsDialog({record,open,onOpenChange}):JSX.Element` decrypts only on unlock.
Use existing modal/button/feedback primitives, typography, theme, and focus rules.

- [ ] RED: use Testing Library/user-event through the existing tRPC provider.

```ts
it('requires a new review when the recipient key changes', async () => {
  const f = await renderSendTransferFixture();
  await f.enter('bob', '20', 'Lunch');
  await f.review();
  f.rotateRecipientKeys();
  await f.confirm();
  expect(f.created).toHaveLength(0);
  expect(f.screen.getByText(/review.*recipient/i)).toBeVisible();
});
```

- [ ] Run UI suites to RED. Input -> review -> progress; show recipient/amount/note
  before confirmation, back preserves unsent form, pending record is resumed
  instead of creating another. Confirm re-resolves registry snapshot and disables
  concurrent clicks. Show current active balance, distinct legacy balance guidance,
  scan/relay/unlock states, and exact configured token precision.
- [ ] Dashboard owns selected active transfer; participant pending query restores
  it on reload. Closing progress only closes UI. Pending notice reopens it and
  History can open the same record. Terminal progress exposes transaction link
  for the configured network, not hardcoded testnet explorer.
- [ ] Cover empty note, 201 emoji, unknown/self username, insufficient balance,
  click twice, modal close/reopen, locked detail, confirmation, failure/uncertainty,
  keyboard tab/focus return, mobile viewport and both dashboard themes. Do not show
  amount/note in the locked pending notice. Follow UI skills during implementation.
- [ ] GREEN: new UI and BalanceCard/HistoryDashboard tests; affected Requests
  dialogs still render and submit correctly. Perform browser visual review in Task 11.

### Task 10: Real-chain transfer lifecycle and failure regression

**Files:** Create `contracts/test/directTransfer.test.ts`,
`web/test/directTransfer.integration.test.ts`; extend transfer fixture/harness
only for real RPC and isolated Mongo adapters. No production Solidity edits.

**Interfaces:** Reuse existing `deployPoolFixture`, `depositOwnedNote`, `syncLeaves`,
`makeMergeProof`, `makeTransferProof`, `b32`, and `output` exports; inspect their
argument types before constructing tests. Integration fixture
`makeDirectTransferIntegrationFixture()` owns local pool, participant signers,
isolated DB, real service caller, and cleanup; exposes `send20From10And15()` and
`participantBalances():Promise<{sender:bigint;recipient:bigint}>`.

- [ ] RED: real integration expectation:

```ts
it('settles fragmented funding once and leaves private change', async () => {
  const f = await makeDirectTransferIntegrationFixture();
  try {
    const record = await f.send20From10And15();
    expect(record.status).toBe('confirmed');
    expect(await f.participantBalances()).toEqual({sender:5n,recipient:20n});
    await expect(f.replayWithChangedSubmission()).rejects.toThrow();
    expect(await f.participantBalances()).toEqual({sender:5n,recipient:20n});
  } finally { await f.close(); }
});
```

- [ ] Run `pnpm exec hardhat test test/directTransfer.test.ts` from `contracts/`;
  use real browser wasm/zkeys and fixture-generated proofs. Test wrong ownership,
  duplicate fixed commitment, several Merge steps, and wrong final recipient.
  Do not regenerate artifacts to make a failing proof pass.
- [ ] Run `pnpm test -- test/directTransfer.integration.test.ts` from `web/`
  against an explicitly configured local RPC/isolated Mongo. Exercise actual API,
  signatures, journal, recovery, and settlement with local contract receipts.
- [ ] Fault-inject lost status projection, crash/restart with persisted bytes,
  unsigned expiration, pending receipt, and missing ciphertext. Race transfer vs
  request and transfer vs withdrawal through their real service paths; assert only
  one owns each shared input and a losing attempt never produces a payment.
- [ ] GREEN: local-chain suites and existing Merge/requestSettlement/pool/gasless
  contract tests. Distinguish mocked failure boundaries from real settlement.

### Task 11: Documentation, browser proof, and handoff

**Files:** Update README shielded-transfer description, `docs/features.md`,
`docs/quickstart.md`, `docs/local-setup.md`; create
`docs/direct-transfer-operations.md`. Update plan checkboxes only with evidence.

- [ ] Document migrations, shared reservations, bounded cron reconciliation,
  unsigned vs signed recovery rules, stuck-send diagnosis, active/legacy balances,
  encrypted metadata visibility, History semantics, and supported fresh-device
  recovery. Preserve current cron deployment URL and auth instructions.
- [ ] Run affected focused suites first, then full `pnpm test` from `web/` once.
  Run `pnpm exec tsc --noEmit -p tsconfig.json` and `pnpm build` serially from
  `web/`; contract tests run separately. Inspect the installed lint script before
  using it: it currently calls `next lint`; unsupported CLI is a reported tooling
  limitation, not a pass. Use the established scoped Biome check for modified files
  without broad autoformatting unrelated source.
- [ ] Browser smoke on mobile and desktop: two accounts, Send with encrypted
  note, received/sent History, private change, close/reopen, reload after preparation,
  recovery on another supported browser, wrong username, insufficient active funds,
  account switch, and actual Cash out. Record which actions used real local chain
  and which used testnet. Testnet uses only explicitly authorized test funds/accounts.
- [ ] Self-review spec coverage, signature domains, secret persistence, stale
  session checks, reservation cleanup, fixed recipient commitment, and History
  classification. Run `git diff --check`, inspect staged/unstaged/untracked files.
- [ ] Produce handoff evidence with commands/results, real-chain transaction IDs
  where available, known limitations, and operational prerequisites. Do not push,
  deploy, activate pools, or merge. If commits are authorized, commit only scoped
  feature/docs/tests and attach any subsequently authorized created PR.

## Spec coverage and review result

| Spec requirement | Tasks |
| --- | --- |
| Approved modal and optional encrypted note | 1, 9 |
| Active pool, self rejection, recipient snapshot review | 1, 3, 4, 7, 9 |
| Participant-only signed persistent intent | 1, 3 |
| Fragmented funding and uint64 split | 4, 7, 10 |
| Shared claims, cross-device concurrency, safe expiration | 2, 6, 10 |
| Durable bytes, exact receipt, pending uncertainty | 6, 10 |
| Recipient and sender missing-output recovery | 4, 5, 7, 10 |
| Reopen/reload, locked pending notice, identity switch | 7, 9 |
| History, actual cash-out evidence, analytics, CSV | 8, 9 |
| Existing Requests and withdrawals regression | 2, 4, 6, 8, 10, 11 |
| Tests, mobile/desktop verification, operational docs | 10, 11 |

MongoDB reference checked through Context7: single-document writes are atomic,
CAS filters should include the expected current value, and multi-document writes
are not collectively atomic. See
https://www.mongodb.com/docs/manual/core/write-operations-atomicity/ . This plan
therefore uses fenced single-document ownership and explicit recovery instead of
replica-set transactions. Expiration is an application recovery decision, never
automatic deletion of signed/pending operations.

Execution requires user review of this plan and selection of native or
subagent-driven execution. Writing this plan has not changed product source.

## Execution record

The user approved inline execution. Product code and local verification are now
implemented; see `docs/direct-transfer-verification.md` for concrete commands,
counts, review fixes, decisions, and verification boundaries. Test cases were
consolidated into feature suites rather than creating every suggested filename.
Accepted submissions moved to a separate step collection after independent review
identified the MongoDB document-size limit; recovery reads are batched/paginated.
Authenticated browser/testnet E2E and successful Windows standalone packaging are
not claimed. The user subsequently authorized commit/push and PR creation on
`feature/private-direct-transfers` targeting `monad-migration`; deployment and
merge remain outside this authorization.
