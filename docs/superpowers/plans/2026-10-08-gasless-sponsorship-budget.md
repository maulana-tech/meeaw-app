# Gasless Sponsorship Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give users one quota unit per gasless action while bounding every relayer transaction's native MON liability, including retries and pending work.

**Architecture:** One bounded, authoritative Mongo ledger per chain atomically owns quota and budget reservations. The existing durable sender enforces frozen child allocations before signing/broadcast; application operations persist a shared parent action. Existing journal projections and cron support terminal accounting, legacy import and recovery without replica-set transactions.

**Tech Stack:** Existing TypeScript, Next.js/React, tRPC, MongoDB driver, viem, Zod, Vitest/Testing Library and Hardhat. No new package, contract, circuit, funded wallet or live environment change.

**Spec:** `docs/superpowers/specs/2026-10-08-gasless-sponsorship-budget-design.md`.

## Global Constraints

- One user action consumes at most one unit; all merges, splits and the final payment consume its envelope.
- Daily windows reset at 00:00 UTC. MongoDB server time owns admission/rollover; no client accounting date or backwards rollover.
- Monetary values are exact integer wei. No floating-point fee counters or USD price feed.
- Configuration examples: authenticated 20/day, guest wallet 20/day, anonymous aggregate 100/day; global 5 MON/day, anonymous 1 MON within it, action 0.5 MON; balance floor 0.1 MON.
- Global/anonymous/action budgets and gas-price ceiling require explicit valid configuration. Missing policy pauses new sponsorship, never restores unlimited relay.
- Bound authoritative state to 256 actions, 16 children per action and 4,096 current-day principal counters; keep raw bytes/calldata in the journal.
- Unknown signed work retains liability. Retrying the same signed transaction uses identical bytes; an elapsed timer does not release it.
- First canonical mined child, including a revert, consumes the action unit once. Known unsigned abandonment returns its reserved unit.
- Native Monad accounting uses gross gas limit times effective price; local Hardhat uses actual Ethereum-style fee accounting.
- Outstanding liabilities and unconsumed quota reservations survive UTC rollover. Continuing a charged action never charges another quota unit.
- Public checkout remains usable without login. Never identify an anonymous spender by withdrawal destination or add raw IP to the ledger.
- No automatic switch to user-paid gas. Wallet settlement for app Send/request workflows is excluded.
- Scope local development only. No push/PR/merge, live migration, deployment or funded transaction is included in this plan's execution authority.

## Review Focus

1. A wallet callback returns after unsigned cancellation: stale bytes cannot be persisted or broadcast against released credit (Tasks 2–3).
2. A real revert occurs after successful simulation: its gas costs and one action unit remain charged (Tasks 1–3).
3. An old-day unknown transaction is mined after midnight: liability carries over and settles to the block's UTC day without a second quota charge (Tasks 2–3).
4. A guest strips auth or changes the destination to evade a limit: anonymous/global cost limits still apply; destination is never treated as account ownership (Task 4).
5. Restart after signed publication but before projection/fee settlement: import/reconciliation preserves old work, returns the same result and does not reset the budget (Tasks 2, 3, 7).

## File Responsibilities

Shared browser-safe model and copy live in `web/src/features/sponsorship/`.
Server-only rules and persistence live in `web/src/server/modules/sponsorship/`:

| File | Responsibility |
| --- | --- |
| `types.ts` (shared) | Action kinds, ticket references, availability/quota DTOs |
| `policy.ts` | Environment parsing and exact native-unit ceilings |
| `fees.ts` | Frozen transaction validation, upper liability and accounted fee |
| `ledgerModel.ts` | Bounded state, commands, pure reducer and invariants |
| `ledger.repository.ts` | Mongo server clock, CAS retry, archival and projection |
| `ledger.service.ts` | Authenticated action admission, step allocation and settlement |
| `principals.ts` | Server-derived auth/verified guest/anonymous principals |
| `ordinaryIdentity.ts` | Stable public-relay business identity and replay lookup |
| `bootstrap.ts` | Bounded legacy scan/import and current-day baseline |
| `reconcile.ts` | Canonical fee evidence and interrupted publication repair |
| `sponsorship.schema.ts` / `sponsorship.router.ts` | Strict status and batch-admission API |
| `useSponsorship.ts` / `SponsorshipNotice.tsx` (shared) | Fresh user status, review/error copy |

Do not split existing request/transfer modules into a new general framework. Add narrowly scoped sponsorship adapters and preserve their current proof/generation/receipt boundaries.

## Contracts Carried Between Tasks

Implement the following exported types in Task 1. Stored versions use decimal strings for wei and ISO strings for time; executable versions below use bigint/Date internally.

```ts
type ActionKind = "register" | "rotation" | "deposit" | "withdraw" |
  "withdraw-batch" | "legacy-transfer" | "send" | "request-pay" | "faucet";
type Principal = { kind: "user" | "guest-wallet" | "anonymous"; key: string };
type SponsorPolicy = {
  revision: string; userLimit: number; guestWalletLimit: number;
  anonymousLimit: number; globalWei: bigint; anonymousWei: bigint;
  actionWei: bigint; balanceFloorWei: bigint; feeCeilingWei: bigint;
  maxChildren: number;
};
type PolicyState = { ready: true; policy: SponsorPolicy } |
  { ready: false; reason: "configuration" };
type ActionIntent = {
  chainId: number; actionId: string; kind: ActionKind; principal: Principal;
  businessDigest: `0x${string}`; maximumChildren: number;
};
type ActionTicket = { chainId: number; actionId: string; fence: number };
type ChildTicket = ActionTicket & { childId: string; childFence: number };
type FrozenTx = {
  chainId: number; from: `0x${string}`; to: `0x${string}`;
  data: `0x${string}`; nonce: number; gas: bigint; value: 0n;
  fee: { type: 0; gasPrice: bigint } |
    { type: 2; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };
};
type FeeEvidence = {
  hash: `0x${string}`; block: bigint; blockHash: `0x${string}`;
  blockTime: Date; outcome: "confirmed" | "reverted";
  gasUsed: bigint; effectiveGasPrice: bigint; transaction: FrozenTx;
};
type QuotaStatus = {
  configured: boolean; available: boolean;
  reason: "configuration" | "initializing" | "quota" | "budget" |
    "anonymous-budget" | "balance" | "cost" | "capacity" | "rpc" | null;
  limit: number | null; used: number | null; reserved: number | null;
  remaining: number | null; resetAt: string;
};
type SponsorBinding = { action: ActionTicket; childId: string };
```

`SponsorshipError` exports one `reason` from the status reason union. Preserve it across relay wrappers and operation handlers. `isSponsorshipError(error)` is shared server-side narrowing; browser DTOs contain sanitized reason/copy only.

The Task 2 fixture helper exports `createSponsorFixture(overrides:Partial<SponsorPolicy>)` with isolated `db`, `policy`, independent `a`/`b` ledger instances, `intent(label):ActionIntent`, a controllable test-only `clock`, and `close()`. No existing app database is dropped. Its `accounting` adapter exports `globalSpent():Promise<bigint>`, `anonymousSpent():Promise<bigint>`, `held():Promise<bigint>`, `usedActions(subject:string):Promise<number>`, `parentChildren(ticket:ActionTicket):Promise<readonly string[]>`, and `receiptCharges(hash:Hex):Promise<readonly FeeEvidence[]>`, reading authoritative state/archive through production repository methods. It is a read adapter, not a second implementation of accounting rules.

Router/service fixtures extend that helper with real authenticated/guest callers and injected RPC/Privy ports. Sender fixtures expose a locally signing viem port and `recovery.serializedBytes(hash):Promise<Hex>` from `RelayJournal`; never mock the sponsorship ledger or its admission/settlement decisions. `Hex` here is viem's `0x`-prefixed string type. Task steps' fixture variables refer to these factories.

## Task 1: Policy, Shared Types and Exact Fee Rules

**Files:** Create shared `types.ts`; server `policy.ts`, `fees.ts`, `sponsorship.errors.ts`; tests `web/test/sponsorshipPolicy.test.ts`, `sponsorshipFees.test.ts`. Modify `web/src/env.server.ts` and `web/.env.example`.

**Interfaces:** `loadSponsorPolicy(env): PolicyState`; `maximumLiability(tx: FrozenTx): bigint`; `accountedFee(tx, evidence): bigint`; `validateSignedTx(bytes, expected: FrozenTx): Promise<void>`.

- [ ] Write failing policy cases for missing required monetary limits, invalid decimal/exponent values, sub-budget > global, action > global, fee cap zero, and children outside 1..16.

```ts
expect(loadSponsorPolicy({})).toEqual({ready:false,reason:"configuration"});
expect(loadSponsorPolicy({RELAYER_DAILY_BUDGET_MON:"0.1",
  RELAYER_ANONYMOUS_BUDGET_MON:"1"}).ready).toBe(false);
```

- [ ] Run `pnpm --dir web test -- test/sponsorshipPolicy.test.ts test/sponsorshipFees.test.ts --maxWorkers=1 --testTimeout=30000`; verify missing behavior fails, not a setup issue.
- [ ] Define the shared contracts above and strict env variables: `RELAYER_USER_ACTIONS_PER_DAY`, `RELAYER_GUEST_ACTIONS_PER_DAY`, `RELAYER_ANONYMOUS_ACTIONS_PER_DAY`, `RELAYER_DAILY_BUDGET_MON`, `RELAYER_ANONYMOUS_BUDGET_MON`, `RELAYER_ACTION_BUDGET_MON`, `RELAYER_BALANCE_FLOOR_MON`, `RELAYER_MAX_FEE_GWEI`, `RELAYER_MAX_ACTION_STEPS`. Count defaults are 20/20/100 and step default 16; required budget/fee values have no unlimited fallback. Example floor is 0.1 MON.
- [ ] Implement exact liability and fee accounting. Reject nonzero value, unsupported transaction type/chain, invalid gas/fee bounds, wrong signer/to/data/nonce, and effective price above signed cap. Recover signer and parse signed bytes with viem; compare all frozen fields before permitting publication.

```ts
function maximumLiability(tx: FrozenTx): bigint {
  const price = tx.fee.type === 0 ? tx.fee.gasPrice : tx.fee.maxFeePerGas;
  return tx.gas * price;
}
function accountedFee(tx: FrozenTx, evidence: FeeEvidence): bigint {
  const chargedGas = tx.chainId === 31337 ? evidence.gasUsed : tx.gas;
  return chargedGas * evidence.effectiveGasPrice;
}
```

- [ ] Add tests: Monad gas limit 500,000 versus gas used 120,000; Hardhat difference; large integer exactness; real fixture-signed bytes with changed fee/destination/signature; reverted receipt still has a nonzero fee. Run both suites and scoped Biome/typecheck.
- [ ] Record RED/GREEN evidence. Commit only the Task 1 files with `feat: define sponsorship policy and native fee bounds` if execution includes local commits.

## Task 2: Authoritative Ledger and Atomic Reservations

**Files:** Create `ledgerModel.ts`, `ledger.repository.ts`, `ledger.service.ts`; migration `web/migrations/20261008200000-sponsorship-ledger.js`; tests `sponsorshipLedger.test.ts`, `sponsorshipRaces.test.ts`; helper `web/test/helpers/sponsorshipFixtures.ts`.

**Interfaces:** `SponsorLedger({db, policy:()=>PolicyState, clock?:SponsorClock})`; default clock is Mongo server time. Tests alone inject `SponsorClock.now():Promise<Date>`.

Expose `admit(ActionIntent):Promise<ActionTicket>`, `allocate(ActionTicket,childId,digest,FrozenTx):Promise<ChildTicket>`, `enterSigning(ChildTicket,walletFence):Promise<void>`, `pinSigned(ChildTicket,hash):Promise<void>`, `assertBroadcast(ChildTicket,hash):Promise<void>`, `settleChild(ChildTicket,FeeEvidence):Promise<void>`, `closeAction(ActionTicket):Promise<void>`, `releaseUnsigned(ChildTicket,retiredWalletFence):Promise<void>`, `cancelUnsigned(ActionTicket):Promise<void>`, `status(Principal):Promise<QuotaStatus>`. Baseline remains initializing until Task 7 completes it.

- [ ] Define stored `LedgerSnapshot`: chain `_id`, financial revision, server clock, UTC day, current-day global/anonymous used wei, principal used counters, active actions and bootstrap state/cursor. Each action stores immutable intent, envelope, consumed quota marker/day, fence, paused/closing state and bounded children. Children store frozen fee fields, max liability, digest, wallet fence, phase, hash, receipt accounting marker; never raw calldata/bytes. Export `emptyLedger(chainId,now,bootstrapState)` and `reduceSponsorCommand(state,command,policy,now)`.
- [ ] Add failing pure reducer tests for envelope allocation, zero available quota, exhausted anonymous/global sub-budget, reserve-to-used transition and cancellation after signed state. Build real isolated Mongo fixtures with `openIsolatedRequestDb`; seed `emptyLedger(...,"complete")` only in test setup.

```ts
const attempts = await Promise.allSettled([
  fixture.a.admit(fixture.intent("one")),
  fixture.b.admit(fixture.intent("two")),
]);
expect(attempts.filter(result=>result.status==="fulfilled")).toHaveLength(1);
```

- [ ] Run `pnpm --dir web test -- test/sponsorshipLedger.test.ts test/sponsorshipRaces.test.ts --maxWorkers=1 --testTimeout=30000`; establish last-slot/last-envelope RED.
- [ ] Implement server-time read and CAS mutation. Reducer recomputes global held wei from remaining parent envelopes; child allocations consume that envelope rather than adding another global reservation. Settlement subtracts accounted fee from parent remaining and increments its receipt-day used total; parent closure returns only safely unused remainder. At rollover reset used counters but retain all outstanding liability and uncharged quota reservations. A charged parent retains its marker when continuing on another day.

Persist derived `reservedWeiStr` and `anonymousReservedWeiStr` in the same CAS for safe operator reads. Recompute/validate them on every financial command. A child stores `keccak256(tx.data)` rather than `tx.data`; its frozen fee/signer/to/nonce fields are bounded. Runtime keeps the full `FrozenTx` for signing validation; canonical settlement obtains matching data from the immutable journal intent/transaction.

```ts
const updated = await collection.findOneAndUpdate(
  {_id: current._id, revision: current.revision},
  {$set: nextFinancialState, $inc:{revision:1}},
  {returnDocument:"after",includeResultMetadata:false},
);
if (updated === null) continue;
return reduced.result;
```

`nextFinancialState` omits `_id`, financial revision and server clock. Bound CAS attempts to 8 then return a retryable typed availability error. Rollovers never overwrite a newer day. Bounds include an 8 MiB serialized ledger preflight, 256 active actions, 16 children/action and 4,096 current-day principal counters.

- [ ] Implement restart-safe terminal archival: archive with immutable action/fence/receipt markers before removing its authoritative entry; unknown write outcomes retain it. Idempotent archived replays cannot re-admit quota. Add indexes for chain/action identity and projection repair, with no signed TTL index. Add race tests for guest+global atomicity, stale fence release, same-ID altered principal/digest, cancellation versus signing, archive failure, 4,096-counter capacity and UTC backward clock.
- [ ] Add rollover test with old unknown liability and delayed receipt, plus reverted-first-child quota consumption. Run both suites, migration idempotence and exact-capacity tests. Verify no test touches a shared app database.
- [ ] Record evidence and commit scoped changes with `feat: persist atomic sponsorship action ledger`.

## Task 3: Budget Enforcement at the Durable Signer

**Files:** Modify `durableRelayer.ts`, `relayJournal.ts`; create `senderBudget.ts`, `reconcile.ts`; tests `sponsorshipSender.test.ts`, `sponsorshipFeeSettlement.test.ts`, existing `durableRelayer.test.ts` and `relayJournal.test.ts`.

**Interfaces:** Add optional `sponsorship?:SponsorBinding` to `RelayIntent` for legacy decode; new sponsored sends must have a valid binding. Split `RelayPort.prepareAndSign` into `prepare(i,nonce):Promise<FrozenTx>` and `sign(tx):Promise<Hex>`. Keep existing `pendingNonce`, `blockNumber`, `receipt`, `broadcast`; add canonical `block(number)` and `balance(wallet)` ports. `SponsorBudgetPort` exposes the Task 2 child methods.

- [ ] Add RED tests: signer not called with denied allocation; modified signed gas/fee/to fails before journal publish; raw bytes remain identical after uncertainty; revert settles once; cancellation retires the wallet fence before releasing credit; stale sign completion cannot publish.

```ts
await ledger.cancelUnsigned(action);
await expect(sender.prepare(intent)).rejects.toMatchObject({reason:"budget"});
expect(port.sign).not.toHaveBeenCalled();
expect(port.broadcast).not.toHaveBeenCalled();
```

Also test the inverse race: signing wins, cancellation must refuse release, and the reservation remains held even beyond the unsigned lease time.

- [ ] Run `pnpm --dir web test -- test/sponsorshipSender.test.ts test/sponsorshipFeeSettlement.test.ts --maxWorkers=1 --testTimeout=30000`.
- [ ] Integrate: lookup existing journal first; claim nonce; prepare/freeze server fee fields with operator price cap; allocate child; enter signing with wallet fence; sign offline; validate bytes; pin hash in sponsorship; persist signed wallet record. Broadcast requires both wallet and sponsorship ownership. A pin/projection failure retains liability until repair verifies the fenced journal outcome. Never publish newly signed bytes from an old cancellation fence.

```ts
const tx = await port.prepare(intent, walletClaim.nonce);
const child = await budget.allocate(binding.action,binding.childId,digest,tx);
await budget.enterSigning(child,walletClaim.fence);
const bytes = await port.sign(tx);
await validateSignedTx(bytes,tx);
await budget.pinSigned(child,keccak256(bytes));
await journal.persistSigned({...walletClaim,serializedTransaction:bytes,
  txHash:keccak256(bytes)});
```

`binding` comes from the immutable server-owned action, and `digest` is the current existing transaction intent digest. Before budget release, unsigned cancellation must retire the matching wallet journal fence and prove no serialized transaction exists in active/history. If publication outcome is uncertain, keep pinned liability; repair performs the same ownership checks.

- [ ] Settlement reads receipt/transaction and canonical block before+after, verifies depth/hash/frozen bounds, records fee once, then allows existing wallet/spend cleanup. Settlement failure keeps budget markers repairable. Low-balance check subtracts outstanding wallet liabilities and preserves floor; conservative double-reservation during stale receipt indexing is acceptable, never optimistic credit.
- [ ] Migrate fake ports in existing tests to the two-phase API without changing their signed-byte/replay assertions. Run new suites plus durable sender/journal and ordinary relay regressions. Test malformed bytes, excessive effective price and unsupported chain rather than trusting RPC values.
- [ ] Record evidence and commit `feat: enforce sponsorship before relay signing and broadcast`.

## Task 4: Public Relay Identities, Principals and Cash-out Batches

**Files:** Create `principals.ts`, `ordinaryIdentity.ts`, `sponsorship.schema.ts`, `sponsorship.router.ts`; modify `relay.router.ts`, `relay.service.ts`, `relay.schema.ts`, `relayer.ts`, `server/root.ts`, `lib/withdraw.ts`, `privacyKeys/cashoutOperations.ts`; tests `sponsorshipPublicRelay.test.ts`, `sponsoredWithdrawBatch.test.ts`, existing relay router/ordinary/withdraw suites.

**Interfaces:** `principalFromContext(ctx,verifiedGuestPayer?):Principal`; `ordinaryBusinessIdentity(kind,validatedInput):{actionId:string,businessDigest:Hex,childId:string}`; `admitOrdinaryAction(ctx,kind,input):Promise<ActionTicket>`; `admitWithdrawBatch(ctx,{id,pool,recipient,nullifiers}):Promise<ActionTicket>`; `findOrdinaryReplay(actionId,principal,businessDigest)` returns the original result or no replay. The sponsorship router exposes public availability, protected `myQuota`, protected batch admission and fenced unsigned cancellation.

- [ ] RED tests: public deposit works without Privy; invalid payer signature cannot acquire payer quota; removing auth is still subject to guest/global caps; guest withdrawal destination changes do not become spender identity; duplicate public proof submissions cannot sign/pay twice. A batch exceeding 16 or native envelope sends zero children.

```ts
await expect(guestCaller.relay.deposit(validSignedDeposit)).resolves.toBeDefined();
expect(await accounting.anonymousSpent()).toBeGreaterThan(0n);
await expect(guestCaller.relay.withdraw(changedDestinationAttempt))
  .rejects.toBeDefined();
expect(await accounting.globalSpent()).toBeLessThanOrEqual(policy.globalWei);
```

Fixtures create `guestCaller`, inputs and `accounting` from the real router/service plus isolated ledger; stub only RPC/Privy boundaries. `accounting.anonymousSpent/globalSpent` read the actual authoritative ledger.

- [ ] Run `pnpm --dir web test -- test/sponsorshipPublicRelay.test.ts test/sponsoredWithdrawBatch.test.ts --maxWorkers=1 --testTimeout=30000`.
- [ ] Implement verified context/payer binding, common anonymous counter/sub-budget and stable identities. Identity rules: register/rotation ordinary paths bind owner+signed authorization; deposit binds pool+payer+commitment+authorization; withdraw binds pool+nullifier+recipient+amount; legacy transfer binds pool+nullifier+output commitments+ciphertext hashes. Proof randomness is not a new business action. Exact signed journal digest remains immutable; a replay returns its original result rather than replacing bytes. Faucet requires a client-generated UUID retained for that explicit click; update Add funds caller and reject missing marker before sponsoring.
- [ ] Pass server-owned bindings through every `relayWrite`; remove ordinary `randomUUID` regeneration on retries. Auth principal is read from verified context, never input. Validate ownership/business identity before returning replay or acquiring counters; do not expose another principal's quota or fees. Keep existing public procedures and short-window IP limits.
- [ ] Add cash-out-all batch pre-admission before first proof/withdraw: explicit batch UUID, one pool/destination, unique nullifier list <=16, child IDs from bound pool/nullifier. Persist the accepted membership so retries cannot add notes/destinations to an old envelope. Carry parent to existing cash-out record/relay call; `finishCashout` and completed withdrawal remain distinct from parent closing. Partial success keeps remainder recoverable and the same batch action ID; no blanket cancellation of signed children.

```ts
const parent = await api.sponsorship.admitWithdrawBatch.mutate(batchInput);
for (const note of claimableNotes(notes)) {
  await withdrawNote({...params,note,sponsorship:parent});
}
```

`batchInput` is computed from selected pool, destination and actual note nullifiers before the loop. `params` contains the existing signer/account/scan/destination fields. Individual public legacy calls without a batch remain individual actions; direct user-paid paths do not acquire sponsorship.

- [ ] Preserve `SponsorshipError` through `relay()` wrapping and tRPC mapping. Run new tests plus `relay.router`, `durableOrdinaryRelayer`, `withdraw`, `privacyCashoutOperations`, and historical-note withdrawal tests. Commit `feat: apply gasless budgets to public relay and withdrawals`.

## Task 5: One Parent Across App Send and Request Payments

**Files:** Create `web/src/server/modules/sponsorship/operationAdapters.ts`. Modify request/transfer `types.ts`, request/transfer schemas, `server/db/mongo.ts`, `requestOperations.ts`, `transfers.repository.ts`, `transfers.service.ts`, `transferOperations.ts`, `directTransferRunner.ts`, `useDirectTransfer.ts`, `useRequestPayment.ts`; tests `sponsorshipFunding.test.ts`, `sponsorshipOperationRecovery.test.ts` and existing operation/hook suites.

**Interfaces:** Persist `sponsorshipAction?:ActionTicket` and `sponsorshipPause?:QuotaStatus["reason"]` on operation DTO/doc types. Parent IDs are `send:${record.id}` and `request-pay:${attemptId}`; child IDs remain existing transaction step IDs. `operationAdapters.ts` exports `pauseOperationSponsorship(kind:"request"|"transfer",operationId:string,reason:NonNullable<QuotaStatus["reason"]>):Promise<void>` and `resumeOperationSponsorship(kind,operationId):Promise<void>` on existing authenticated operation resume/status flow. Browser runner consumes pause state and returns without inventing a failed/new action.

- [ ] RED service integration: a key-migration split, merge and final payment share one action unit; sum of actual accounted fees belongs to that envelope. Forced price increase pauses before signing the next child. Retry on another process and after UTC rollover uses the same parent. Cancellation before any raw bytes returns the unit; cancellation after paid preparation retains the consumed marker and actual cost.

```ts
const first = await caller.transfers.submitStep(migration);
await caller.transfers.submitStep(merge);
await caller.transfers.submitStep(payment);
expect(await accounting.usedActions(sender)).toBe(1);
expect(await accounting.parentChildren(first.sponsorshipAction)).toHaveLength(3);
```

Use existing real request/transfer fixtures and operation service entrypoints. `accounting.usedActions/parentChildren` read ledger state; submission payloads are built with the existing signer/crypto/proof seams.

- [ ] Run `pnpm --dir web test -- test/sponsorshipFunding.test.ts test/sponsorshipOperationRecovery.test.ts --maxWorkers=1 --testTimeout=30000`.
- [ ] Admit after semantic owner/record validation but before internal preparation. Persist parent as recoverable operation intent before returning acceptance; if linking admission/publication is uncertain, replay the same operation instead of creating a new quota claim. Completed legacy operation replay does not acquire a new parent. Existing captured generation, account ticket, source/target owner and pool bindings remain intact.
- [ ] Allocate every merge/split/payment child at runtime enforcement. Validate action kind/pool/method and monotonic step against parent. Change request/transfer catch logic so quota/cost/balance denial becomes a structured resumable pause, not `failAttempt`/terminal failure. Close parent only after business terminal projection and canonical child accounting; repairing lost terminal response is idempotent.
- [ ] Update runners/hooks to retain operation ID and recover prepared notes while paused. Server resume checks the same action and available envelope; no automatic fee ceiling increase or second quota. Frontend precheck is informative only; server remains authoritative.

```ts
if (isSponsorshipError(error)) {
  await pauseOperationSponsorship(operationKind,operationId,error.reason);
  throw error;
}
```

`operationKind` is the literal `"request"` or `"transfer"` set by its server entrypoint. `pauseOperationSponsorship` updates only the sponsorship pause field through the existing operation identity/revision guards; it preserves current submission, completed preparation, capture and transaction hash. It never clears uncertain signed step state. The typed error reaches the caller; existing authenticated status loading then returns the preserved operation with its pause reason.

- [ ] Run operation, funding, generation proof/recovery and stale-session hook regressions. Test concurrent legacy-operation resume, price spike after one confirmed child, and cancelled old ticket reuse. Commit `feat: share sponsorship quota across private payment steps`.

## Task 6: Registry Rotation and Authenticated Account Actions

**Files:** Modify `web/src/server/modules/privacyKeys/rotationOperations.ts`, `web/src/features/privacyKeys/types.ts`, `web/src/features/privacyKeys/rotationController.ts`, `web/src/features/privacyKeys/usePrivacyKeyRotation.ts`, `web/src/lib/chain.ts`, `web/src/components/dashboard/AddFundsDialog.tsx`, and `web/src/components/CreateAccountForm.tsx`. Tests `web/test/sponsorshipAccountActions.test.ts`, existing privacy rotation/controller/router/relayer suites. WalletProvider's registration/cache restoration paths continue using the same chain helpers; do not add a second account form.

**Interfaces:** Rotation operation persists optional `sponsorshipAction`/`sponsorshipPause` using Task 5 shared field names. Parent ID `rotation:${intent.id}`; signed relayer child uses the existing rotation operation key. Registration/mint ordinary callers use Task 4 identity/faucet rules. Wallet-paid rotation mode never acquires sponsorship.

- [ ] RED rotation tests for missing policy before broadcast, relayer budget pause after metadata authorization, accepted unknown registry signature recovery without new action, expired permit with signed raw wallet liability retained, and wallet mode without quota changes.

```ts
await controller.confirm();
expect(await accounting.usedActions(owner)).toBe(1);
await controller.check();
expect(await accounting.usedActions(owner)).toBe(1);
```

Add a separate fixture in which registry mode is wallet and assert used/reserved remain zero. Retain actual owner/key-history/nonce assertions from current rotation tests.

- [ ] Run `pnpm --dir web test -- test/sponsorshipAccountActions.test.ts test/privacyRotation.operations.test.ts test/privacyRotation.controller.test.ts --maxWorkers=1 --testTimeout=30000`.
- [ ] Integrate parent admission, structured pause/resume and terminal closure without deleting registry authorization or changing original signed bytes. Account metadata permit expiry alone is not evidence to release hot-wallet signed gas liability; cron continues fee/journal reconciliation even after the registry business operation closes.
- [ ] Route registration and faucet through the same policy, with stable replay IDs. Expired/invalid authorization rejected before signing consumes no used unit. Account switch/PIN lock while quoting/signing cannot apply another account's quota status or action capture.
- [ ] Run registration, mint, privacy-key recovery/PIN gate and relayer tests. Commit `feat: sponsor registry and account actions within gas limits`.

## Task 7: Rollout Baseline, Canonical Recovery and Operator Report

**Files:** Create `bootstrap.ts`; extend `reconcile.ts`, ledger archival; modify existing request-payments cron; create read-only `web/scripts/relayer-budget-status.mjs` and script `relayer:budget-status` in `web/package.json`; migration tests; tests `sponsorshipBootstrap.test.ts`, `sponsorshipCron.test.ts`, `sponsorshipProjection.test.ts`.

**Interfaces:** `reconcileSponsorship({limit:20})` returns examined/settled/unresolved counts; `advanceSponsorshipBaseline({limit:20})` returns initializing/complete and opaque cursor; `operatorBudgetSnapshot()` returns native used/held/available, configured caps, baseline status and unresolved counts. It does not expose signed bytes, RPC URLs, tokens or recovery material.

- [ ] RED seed a pre-feature signed journal transaction and a current-day completed transaction: no new admission until baseline has accounted both. Repeat after crash, projection error and midnight; same receipt never contributes twice. Another chain's journal record is not fetched/charged on the current RPC.

```ts
expect((await ledger.status(user)).reason).toBe("initializing");
await advanceSponsorshipBaseline({limit:20});
await advanceSponsorshipBaseline({limit:20});
expect(await accounting.receiptCharges(legacyHash)).toHaveLength(1);
```

- [ ] Run `pnpm --dir web test -- test/sponsorshipBootstrap.test.ts test/sponsorshipCron.test.ts test/sponsorshipProjection.test.ts --maxWorkers=1 --testTimeout=30000`.
- [ ] Implement deterministic bounded scans of chain-scoped active wallet journal and send history. Derive max liability from actual raw bytes, recover original signer, bind saved intent; seed current-day gross costs from canonical receipt block UTC time. Old reservations' local timestamps do not establish mining day. Import legacy obligations without retroactive user quota. Scan markers/cursor and deduplication are persisted; archive/import failures keep admission paused.
- [ ] Reconcile pinned signing publication gaps using wallet fence and active/history evidence. A matching raw transaction retains its allocation even if projection failed; a retired unsigned wallet fence and absence of persisted bytes allows fenced release. A live signing fence is not timed out as proof of no signature. Repair terminal archival before pruning bounded authoritative entries.
- [ ] Integrate baseline/fee recovery with cron before accepting new sends. Missing/invalid new policy still permits journal/receipt recovery. Avoid deleting unresolved actions at UTC rollover or when config limits shrink. Add the read-only operator script, fetching server config and DB on the trusted host, printing safe aggregate MON strings.

`relayer:budget-status` runs `node --env-file=.env.local scripts/relayer-budget-status.mjs` from `web`. The standalone MJS entry uses `MongoClient` directly and projects only chain, baseline state, aggregate decimal wei strings, captured policy caps and unresolved counts from `sponsorship_ledgers`. It does not import Next's `server-only` modules, perform financial recomputation, print principal maps, or invoke a migration. Validate chain as 143/10143/31337 and close the client in `finally`. `operatorBudgetSnapshot()` is the server-side view of the same projected safe fields.
- [ ] Run cron auth/rotation/request/transfer regressions; assert no unauthenticated cron trigger, no mutation from operator report, and no server secrets in logs/output. Commit `feat: recover sponsorship liability across rollout and restart`.

## Task 8: User Quota Status and Explicit Sponsorship Availability

**Files:** Create shared `useSponsorship.ts`, `SponsorshipNotice.tsx`; modify `SettingsDashboard.tsx`, `SendTransferDialog.tsx`, `PayRequestDialog.tsx`, `RotatePrivacyKeyDialog.tsx`, `WithdrawDashboard.tsx`, payer `PayForm.tsx`, `lib/chain.ts`, status schema/router. Tests `useSponsorship.test.tsx`, `SponsorshipNotice.test.tsx`, updated existing dialog/Settings/payer suites.

**Interfaces:** `useSponsorship():{status:QuotaStatus|null,loading:boolean,refresh():Promise<QuotaStatus|null>}` reads authenticated `myQuota` or public availability. `SponsorshipNotice({status,loading})` only renders user decisions; operator caps/balances are not exposed. Existing `gaslessEnabled()` describes configuration only; new per-action availability refresh is not cached forever.

- [ ] RED UI states: quota unavailable, pending reservation, exhausted quota/reset, low relayer balance, cost pause, missing config, RPC outage and account switch mid-response. No denial automatically invokes the wallet client. Internal preparation copy is included in the one-unit action review.

```tsx
render(<SponsorshipNotice status={{...quota,remaining:0,reason:"quota"}}
  loading={false}/>);
expect(screen.getByRole("status")).toHaveTextContent(/quota/i);
expect(screen.queryByText(/RPC|MongoDB|private key/i)).toBeNull();
```

`quota` is a complete safe `QuotaStatus` fixture; add `screen`/`render` imports from the existing Testing Library setup.

- [ ] Run `pnpm --dir web test -- test/useSponsorship.test.tsx test/SponsorshipNotice.test.tsx test/SettingsDashboard.test.tsx --maxWorkers=1 --testTimeout=30000`.
- [ ] Implement fresh status with identity/request epoch guards and pending-state refresh after a child/terminal result. Settings shows remaining/used/reserved and local reset. Public guest UI shows availability/common allowance without pretending to know a human's identity or revealing another wallet's exact usage.
- [ ] Map the typed reasons to plain English in existing dialog styles; preserve submitted transaction hashes and Resume/Check status during budget pause. No optimistic 'complete' label from a quota response. Add explicit user-paid option only where current chain helpers already support it; app Send/request offers wait/resume instead. On unknown availability, require an explicit choice rather than interpreting the error as permission to pay wallet gas.
- [ ] Inspect actual Settings and payer layouts before inserting notices. Use a controlled real-component fixture for desktop/mobile and keyboard checks, without signing or funded chain writes. Keep 6-digit PIN, recovery and private-history states unchanged. Save representative screenshots.
- [ ] Run dialog/hook/WalletProvider/public-checkout regressions and record visual evidence. Commit `feat: show gasless quota and resumable budget pauses`.

## Task 9: End-to-End Acceptance, Documentation and Handoff

**Files:** Create `docs/gasless-sponsorship-budget.md`; update README production roadmap and local setup; tests `web/test/sponsorshipAcceptance.test.ts`; preserve the approved spec/plan and execution ledger.

**Interfaces:** No new public API. Exercise the contracts from Tasks 1–8 using real isolated Mongo and in-process RPC/signing fixtures; existing real circuit/contract artifacts remain verification dependencies.

- [ ] Add acceptance fixture with two independent service instances, a fragmented retained-generation payment, anonymous deposit and an uncertain broadcast. Assert single parent quota, per-child native cost, safe reset/reload and canonical settlement. Include startup with active legacy bytes and safe smaller-policy refusal.

```ts
expect(await accounting.usedActions(user)).toBe(1);
expect(await accounting.globalSpent()).toBeLessThanOrEqual(policy.globalWei);
expect(await accounting.globalSpent()+await accounting.held())
  .toBeLessThanOrEqual(policy.globalWei);
expect(await recovery.serializedBytes(originalHash)).toBe(originalBytes);
```

For legacy import or lowered policy, preexisting held cost may exceed the new ceiling: explicitly assert zero new admission rather than incorrectly asserting that imported liabilities disappear. `recovery` reads journal bytes; accounting reads authoritative ledger, not copied in-memory estimates.

- [ ] Run the acceptance test RED→GREEN. Run `pnpm --dir web test -- --pool=forks --maxWorkers=2 --testTimeout=60000` on final source. Keep the current conditional DOM test setup; do not switch the prover suite to thread pools. Tests with explicit shorter per-case timeouts must pass under available memory, rather than changing their assertions.
- [ ] Run `pnpm contract:test`, `pnpm --dir web exec tsc --noEmit`, scoped Biome, `git diff --check`, and `pnpm build:local`. Serialize heavy build/typecheck after web tests if Windows memory is constrained. Record exit codes and exact counts; rerun only checks invalidated by subsequent fixes.
- [ ] Document policy fields/example values, no-policy paused behavior, bootstrap/migration sequence, native gross accounting, unknown liability, guest limits, action versus child quota, partial prepared balance recovery and operator read-only report. Update stale unlimited/rate-limit-only sponsorship descriptions.
- [ ] Perform native spec/plan coverage review. Executing-plans uses one final fresh whole-branch reviewer, including untracked files, then one prioritized fix pass with behavioral repros and fresh relevant verification. No per-task agent delegation is required for inline execution.
- [ ] Present completed behavior and remaining live rollout limits. Keep work local until the user authorizes remote delivery for this feature. A new funded configuration/deployment/mainnet operation is not implied by passing local tests.

## Coverage Map

| Spec requirement | Tasks |
| --- | --- |
| Hybrid action/child accounting and exact MON fees | 1, 2, 3, 5 |
| Guest identity/privacy and global cost enforcement | 2, 4 |
| Standalone atomicity, bounds, UTC carryover, policy changes | 2, 7 |
| Signature fencing, actual receipt/revert, no unknown TTL | 3, 7 |
| Stable ordinary retries and grouped cash-out-all | 4 |
| Mixed-generation funding pause/recovery | 5 |
| Registration, mint, wallet mode and privacy rotation | 4, 6 |
| Legacy bootstrap, archival repair and operator reporting | 7 |
| User status and no silent personal gas payment | 8 |
| Documentation, regression, visual evidence, final review | 9 |

## Execution Recommendation

Use native/inline execution in this checkout, preserving the user's prior preference.
The nine tasks share admission, nonce-fence and operation contracts; one implementer
reduces interface drift and duplicated context. Use one independent final review as
specified by executing-plans, with meaningful race/lost-response tests first.
