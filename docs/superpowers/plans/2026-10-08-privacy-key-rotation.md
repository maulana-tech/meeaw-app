# Routine Privacy-Key Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rotate the incoming privacy key pair from Settings without spending notes, while retaining cross-device access to historical notes, records and payments.

**Architecture:** Keep the existing recovery root and derive bounded key generations locally. Authenticated public metadata and a durable registry-rotation intent bind generation/revision to confirmed chain state; an account gate excludes rotation/recovery changes from app spending. Scanning selects each note/record's account, and confirmed payments prepare cross-generation funds using existing Transfer/Merge circuits.

**Tech Stack:** Existing TypeScript, React/Next.js, tRPC, MongoDB, Noble HKDF/Argon2/AES-GCM, Mera PRF, viem, Vitest/Testing Library and Hardhat. No new dependencies, contracts, circuits or proving artifacts.

**Spec:** `docs/superpowers/specs/2026-10-08-privacy-key-rotation-design.md`, approved in conversation before this plan.

## Global Constraints

- Routine rotation only: **no private note spending, transfer, consolidation or withdrawal during rotation**.
- Keep the recovery root, PIN/passkey and recovery method unchanged. PIN re-wrap preserves that same root.
- Preserve generation **0** derivation byte for byte. Support **64 total generations**, numbered **0–63**; retain all confirmed history and block further rotation at the limit.
- Historical private material is derived locally, held only while unlocked, and cleared for all generations on lock/sign-out/account change. No plaintext root/key vault or decrypted note data on server/disk/logs.
- The metadata API stores public pairs, authenticated revisions/authorizations and chain evidence only. Validate against actual owner/registry/pair, not cached flags.
- Existing signed v1 requests/transfers, accepted steps, fixed recipient commitments, nonce journal bytes, receipt formats and legacy scopes remain valid. Never relabel old signed packets.
- Merge only notes with the same owner secret in the same pool. Internal preparation runs only inside a user-confirmed payment; legacy pools remain withdrawal-only.
- No silent generation-0 republishing, recovery-method/root replacement, compromise-revocation claim, or reconstruction of already-lost roots.
- Registry intent is durable before broadcast. Unknown/reorg/lost-response outcomes reconcile exact intent/bytes, not another rotation or fresh payment.
- Recheck/fetch default before execution, preserve untracked approved documents, and create `feature/privacy-key-rotation` from the verified default. Existing preference is inline execution in the current checkout.
- No commit/push/PR, application database migration, live registry change, funding or deployment is authorized for this new work yet. Keep local test artifacts out of production code and normal CI prerequisites.

## Review Focus

1. **Multiple devices/recovery edits:** rotation and PIN re-wrap must not race into a confirmed key with unusable recovery. Tests: Tasks 2–4.
2. **Late inputs to old keys:** a request/payment created before rotation can arrive afterward; the owner must still decode/use it. Tests: Tasks 5–7.
3. **Mixed ownership masquerading as mixed balance:** same asset/wallet does not make Merge across generations valid. Tests: Tasks 5–7 and 9.
4. **Accepted migration followed by failed payment:** funds and encrypted history must recover without counting internal value as new income or paying twice. Tests: Tasks 6–7.
5. **Unmanaged registry changes/tampered metadata:** fail closed, retain known historical keys, and never reset the registry from a stale recovery path. Tests: Tasks 2–4 and 8.

## File map

| Unit | Create/modify | Responsibility |
| --- | --- | --- |
| Generations/session | `web/src/features/privacyKeys/{types,keyDerivation,keyRing,session}.ts`; `web/src/lib/{keys,notes}.ts` | Bounded derivation, verified ring, legacy adapter/clearing |
| Public account state | `web/src/server/modules/privacyKeys/{privacyKeys.schema,privacyKeys.repository,privacyKeys.service,privacyKeys.router,registryEvidence}.ts`; `web/src/server/root.ts`; new migration | Protected bootstrap/history, signed intent, CAS/gate |
| Rotation authorization/send | `web/src/features/privacyKeys/rotationTypedData.ts`, `registryRotation.ts`; `web/src/server/modules/privacyKeys/rotationOperations.ts`; existing durable journal and cron route | Exact registry update, receipt/state confirmation, replay |
| Recovery integration | `WalletProvider.tsx`, `useChangeRecoveryPin.ts`, wallet escrow/passkey service; `features/privacyKeys/reauthenticate.ts` | Same root/recovery, re-auth and PIN fence |
| Owned-data selection | notes scanner, `useMyNotes`, request/transfer crypto/recovery/hooks, withdraw, receipt preparation/dialog | Select account by generation/pair rather than active-only |
| Funding | `features/privacyKeys/generationFunding.ts`; existing request/transfer proofs and operation hooks | Same-owner Merge, private self-output preparation |
| Persistence/classification | request/transfer operations/repositories, spend/relay boundaries, recovery frames, activity/evidence | Captured generations, immutable steps, no duplicate income |
| Settings | `features/privacyKeys/usePrivacyKeyRotation.ts`; `components/dashboard/RotatePrivacyKeyDialog.tsx`, SettingsDashboard | Re-auth/review/status/resume |
| Evidence/docs | explicit tests below; `contracts/test/privacyKeyGenerations.test.ts`; `docs/privacy-key-rotation.md`, features/reference/security/operations | Actual proof evidence and accurate scope |

Keep existing payment products/providers in place. Narrow optional context fields and focused helpers are preferable to rewriting large modules.

## Shared interfaces and fixture contract

Introduce these in Task 1 (`types.ts`), retaining existing `LocalAccount`, `MyNote`, `Signer`, `Hex`, `PoolScope`, and `Participant` imports:

```ts
type RegistryScope = `${number}:${string}`;
type KeyGenerationId = number; // validated integer 0..63 at every boundary
type PublicKeyPair = { notePubkey: Hex; viewPubkey: Hex };
type GenerationEvidence = { block: number; blockHash: Hex; txHash: Hex | null };
type KeyGeneration = PublicKeyPair & { id: KeyGenerationId; evidence: GenerationEvidence };
type RotationPhase = 'prepared' | 'submitted' | 'confirming' | 'confirmed'
  | 'failed' | 'needsReconciliation' | 'conflict';
type RotationIntent = {
  version:1; id:string; owner:Hex; registry:RegistryScope; username:string;
  expectedRevision:number; from:KeyGenerationId; to:KeyGenerationId;
  oldKeys:PublicKeyPair; newKeys:PublicKeyPair; deadline:string;
  signature:Hex;
};
type RotationOperation = {
  intent:RotationIntent; phase:RotationPhase; txHash:Hex|null;
  updatedAt:string; registryAuthorization?:{nonce:string;deadline:string;signature:Hex};
};
type PrivacyKeyState = {
  version:1; owner:Hex; registry:RegistryScope; username:string; revision:number;
  activeGeneration:KeyGenerationId; generations:readonly KeyGeneration[];
  pending:RotationOperation|null;
};
type LocalPrivacyKeyring = {
  owner:Hex; registry:RegistryScope; revision:number; activeGeneration:KeyGenerationId;
  accounts:ReadonlyMap<KeyGenerationId,LocalAccount>;
};
type AccountTicket = {
  id:string; operationId:string; owner:Hex; registry:RegistryScope;
  revision:number; fundingGeneration:KeyGenerationId; kind:'spend'|'recovery-change';
};
```

`makePrivacyFixture()` (create `web/test/helpers/privacyKeyFixtures.ts` in Task 1) returns `{root, signer, owner, registry, username, accounts, keys, state, approval}`. Root is test-only `new Uint8Array(32).fill(7)`; signer is existing `testSigner(1)`, registry is `31337:0x` plus forty `4` digits, username `alice`; accounts 0/1 derive from that root. State has revision 1, active 0, generation-0 evidence block 10/hash `0x` plus sixty-four `1` digits/txHash null, no pending operation. Approval has UUID `00000000-0000-4000-8000-000000000001`, from 0/to 1, that exact owner/registry/pair/revision, deadline `4102444800`, and a real wallet signature from `rotationTypedData` (Task 2). Task-1 fixture may return its unsigned approval fields until that signer helper exists; do not fake a successful signature.

Real Mongo tests use existing `openIsolatedRequestDb` from `web/test/helpers/requestDb.ts`; close its disposable database in afterAll. Record/public ports are controlled, while key math, signatures and persisted CAS/gate behavior are real.

### Task 1: Stable generation derivation and session selection

**Files:** Create privacyKeys types/keyDerivation/keyRing/session and fixture above; modify notes session adapter; tests `privacyKeyDerivation.test.ts`, `privacyKeySession.test.ts`, existing keys/notesSession/notesPrivacy tests.

**Interfaces:** `derivePrivacyAccount(root:Uint8Array,generation:KeyGenerationId):LocalAccount`; `derivePrivacyKeyring(root,state):Promise<LocalPrivacyKeyring>`; `accountForGeneration(ring,id):LocalAccount`; `accountForParticipant(ring,participant):Promise<LocalAccount>`; `accountForNote(ring,note):LocalAccount`; session `installPrivacyKeyring(ring)`, `getPrivacyKeyring():LocalPrivacyKeyring|null`, `clearPrivacyKeyring():void`. `getAccount` returns installed active account; missing note generation is legacy 0 only, never a fallback for an unknown explicit ID.

- [ ] RED fixed legacy vector and version separation. These literals were independently computed before source modification:

```ts
const root = new Uint8Array(32).fill(7);
const old = derivePrivacyAccount(root,0);
expect(old.ownerSecret.toString()).toBe('4586413771004748177385579691527351924154609703805426817508166825644553166116');
expect(bytesToHex(old.viewSk)).toBe('c095a46f969e4a46ff23b8d7290c6d8f7023508f351de0b564b41709b5cc8dff');
expect(derivePrivacyAccount(root,1)).not.toEqual(old);
for (const id of [-1,0.5,64,NaN]) expect(()=>derivePrivacyAccount(root,id)).toThrow();
```

- [ ] Run `pnpm test -- test/privacyKeyDerivation.test.ts test/privacyKeySession.test.ts --maxWorkers=1 --testTimeout=30000` in web and observe RED.
- [ ] Implement canonical domains: generation 0 calls unchanged `deriveNoteSecrets`. Later generations use `mawee.privacy.owner.v1/generation/${id}` and `mawee.privacy.view.v1/generation/${id}`, SHA-512 HKDF with the same root/undefined salt, owner 64 bytes reduced modulo existing `R`, view 32 bytes. Validate 32-byte root and bounded integer first.

```ts
if (id === 0) return deriveNoteSecrets(root);
const ownerBytes = hkdf(sha512,root,undefined,utf8(`mawee.privacy.owner.v1/generation/${id}`),64);
try { return {ownerSecret:fromBE(ownerBytes)%R,
  viewSk:hkdf(sha512,root,undefined,utf8(`mawee.privacy.view.v1/generation/${id}`),32)}; }
finally { ownerBytes.fill(0); }
```

- [ ] Ring construction requires a complete contiguous 0..active history, at most 64, no duplicate pairs/IDs, and compares each locally derived public pair with its entry. Wrong root/history throws; no active install before verification. Root bytes are not retained in the ring or context. Clear viewing buffers where possible and drop all references/zero mutable secret fields; do not claim JavaScript guarantees wiping every BigInt temporary.
- [ ] Test participant selection by BOTH captured public keys, wrong pair rejection, note ID 0 fallback and unknown ID refusal, active `getAccount`, lock clearing all entries and no root/private keys in persistence/logs. Legacy `deriveAndStoreAccount` must not overwrite an established rotated ring with generation 0; recovery callers are migrated in Task 4.
- [ ] GREEN new and existing keys/session/privacy tests. Record evidence; no commit until authorized.

### Task 2: Protected metadata, signed approval and account gate

**Files:** Create privacyKeys schema/repository/service/router, initial `registryEvidence.ts` reader and rotationTypedData; register router. Create `web/migrations/20261008160000-privacy-key-generations.js`; tests `privacyKeys.repository.test.ts`, `privacyKeys.router.test.ts`, `privacyKeyGate.test.ts`, `privacyKeyMetadata.test.ts`.

**Interfaces:** `rotationTypedData(unsigned:Omit<RotationIntent,'signature'>)`; class `PrivacyKeysRepository(db)` with `bootstrap(state)`, `get(owner,registry)`, `prepare(intent)`, `acquireTicket({owner,registry,revision,operationId,kind,fundingGeneration}):Promise<AccountTicket>`, `assertTicket(ticket)`, `releaseTicket(ticket,evidence:'terminal'|'unsigned-abandoned')`. Service functions `getPrivacyKeyState(user)`, `bootstrapPrivacyKeyState(user,input:{keys:PublicKeyPair})`, `preparePrivacyRotation(user,intent)`; protected queries/mutations `privacyKeys.state`, `bootstrap`, `prepare`. Validation derives owner from currentWallet/user binding and configured registry, not caller-supplied identity.
Introduce the reader port here: `readRegistry(owner,username):Promise<{scope:RegistryScope;owner:Hex;keys:PublicKeyPair;nonce:string;block:number;blockHash:Hex;head:number}>`. Bootstrap/prepare consume it now; Task 3 extends its receipt/transaction evidence support. Tests inject that same port, and production pins public reads to the confirmed block/canonical hash.

- [ ] RED two repositories race spend admission against rotation admission; only one mode wins. Concurrent spending in different existing pool operations remains allowed while rotation is absent.

```ts
const f = await makePrivacyFixture(), a = new PrivacyKeysRepository(db), b = new PrivacyKeysRepository(db);
await a.bootstrap(f.state);
const attempts = await Promise.allSettled([
 a.prepare(f.approval),
 b.acquireTicket({owner:f.owner,registry:f.registry,revision:1,operationId:'send-a',kind:'spend',fundingGeneration:0}),
]);
expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);
expect(await a.get(f.owner,f.registry)).toBeTruthy();
```

- [ ] RED unauthorized reads/writes, non-0 bootstrap, duplicate/oversized history, old revision, changed signed pair/ID/registry/owner, and metadata attempt containing root/viewSk/ownerSecret. Run the four suites above to RED.
- [ ] Sign custom EIP-712 domain `{name:'Mawee Privacy Key Rotation',version:'1',chainId,verifyingContract:registryAddress}` and primary type `PrivacyKeyRotation`, with fields id/string, owner/address, username/string, expectedRevision/uint64, from/to uint32, old/new note/view bytes32, deadline/uint256. Normalize prefixed 32-byte keys and registry addresses. Verify actual owner signature and current confirmed public pair; no server assertion that it knows the recovery root.
- [ ] Store a single authoritative account document containing active metadata/history, pending intent and gate. CAS `revision`, `activeGeneration`, `pending:null`, no admitted spend/recovery tickets when preparing. Embedded pending intent contains enough public authorization to repair a separate rotation projection after partial writes; no replica-set transaction requirement. Idempotent same ID+digest returns the same intent; differing content conflicts. History append is never deletion.
- [ ] Gate supports concurrent bounded spend tickets (max 128) and one exclusive recovery change or rotation, rather than degrading multi-pool payments into one global spend at a time. Ticket acquisition is one-document CAS; ticket revision is frozen. Release only with safe operation evidence; no TTL auto-release of signed/unknown work. Anonymous external proofs are not falsely represented as attributable to an account.
- [ ] Add idempotent indexes on account owner/registry and rotation ID/owner/registry; boolean `pending:true` partial uniqueness for one pending rotation. Migration creates indexes only and preserves escrow/passkey/history. Do not migrate application DB during development.
- [ ] Bootstrap generation 0 from confirmed owner/pair evidence only, matching re-authenticated local public keys. Missing legacy secrets cannot be fabricated. If registry pair does not match, return conflict/recovery guidance, not an empty new state.
- [ ] GREEN with real isolated Mongo CAS, append-only history and idempotent indexes; existing wallets/escrow/PIN APIs remain compatible.

### Task 3: Durable registry rotation and confirmed activation

**Files:** Extend `registryEvidence.ts`; create `rotationOperations.ts`, client `registryRotation.ts`; extend privacyKeys service/router with `submit/status/markSubmitted/reconcile`; integrate request-payments cron; retain current chain/relay helpers for unrelated setup. Tests `privacyRotation.operations.test.ts`, `privacyRotation.registry.test.ts`, `privacyRotation.direct.test.ts`.

**Interfaces:** reader port `readRegistry(owner,username):Promise<{scope:RegistryScope;owner:Hex;keys:PublicKeyPair;nonce:string;block:number;blockHash:Hex;head:number}>`, `verifyRegistryTransaction(hash,intent):Promise<{state:'confirmed'|'reverted'|'unknown';evidence?:GenerationEvidence}>`. Functions `submitPrivacyRotation(user,{id,authorization:{nonce,deadline,signature}})`, `markPrivacyRotationSubmitted(user,{id,txHash})`, `reconcilePrivacyRotation(user,id)`, `reconcilePendingPrivacyRotations({limit:number})`. Client `submitRegistryRotationWallet(signer,operation,authorization,onSubmitted:(hash:Hex)=>Promise<void>):Promise<Hex>`.

- [ ] RED durable sender returns unknown after broadcast: state remains pending, active generation remains 0, and retry prepares the identical operation key/bytes. Confirm exact candidate later and activate only once.

```ts
const f = await makeRotationOperationFixture();
f.sender.reconcile.mockResolvedValue({state:'unknown',txHash:f.hash,receipt:null});
await f.submit(); expect((await f.state()).activeGeneration).toBe(0);
await f.submit(); expect(f.preparedKeys()).toEqual(['privacy-rotation:'+f.id,'privacy-rotation:'+f.id]);
f.confirmCandidate(); await f.reconcile(); await f.reconcile();
expect((await f.state()).activeGeneration).toBe(1);
expect((await f.state()).generations).toHaveLength(2);
```

Define `makeRotationOperationFixture` in this task using Task 2's real repository/state and injected reader/sender whose named methods record RelayIntent. It exposes real protected service calls, not a duplicate state machine; `confirmCandidate` returns owner/new pair at block 11/hash 0x plus sixty-four `2` digits/head 12 and a matching receipt. `preparedKeys` reads captured `RelayIntent.operationKey` calls.
- [ ] Run the three rotation suites to RED. Implement allowlisted registry read/receipt validation, actual chain/owner/key pair, confirmation depth/canonical hash, exact calldata/authorized sender and `PubkeysRotated` event. Cached username data/DB phase alone is insufficient.
- [ ] Use existing registry `SetPubkeys` EIP-712 authorization with actual nonce/deadline. Both relay and browser-wallet paths call `setPubkeysFor` so the registry consumes its nonce; plain `setPubkeys` does not consume that inherited permit nonce. No routine fallback to register or plain key setter. UI discloses metadata approval, registry authorization and (when direct) transaction prompts.
- [ ] Relay intent key `privacy-rotation:${id}` targets configured registry and reuses `runtimeSender`/RelayJournal nonce digest/serialized-byte persistence. Existing spend decoder returns no pool claim for non-pool registry calldata; explicitly test no pool spend/mint/transfer. Keep operation intent durable before any journal signing; simulation does not replace journal evidence.
- [ ] Direct wallet persists intent before prompt, calls onSubmitted before waiting receipt, and reconciles exact transaction hash when known. A lost hash may reconcile confirmed pair plus owned registry evidence for the authorized candidate. Unexpected pair/owner/nonce is conflict, not permission for fresh nonce. Never infer success from submitted flag or an unconfirmed state.
- [ ] Finalization appends evidence and advances account revision/active generation once; public username cache must refresh from verified chain state before success is exposed as usable. Projection failure remains pending synchronization; repair it without new transaction. Keep all previous generations. Reorg, revert, expired authorization, no gas and closing/reloading preserve truthful statuses and gate safety.
The authoritative account document appends confirmed generation 1 before a separate cache projection can fail. `privacyKeys.state` may therefore return active 1 plus a pending synchronization operation, allowing recovery/read-only scans to derive both 0 and 1 for payments arriving during that interval. The write gate remains held and the dialog does not report fully synchronized success until cache projection completes. Never withhold the only derivable key for an already-confirmed receiving pair.
- [ ] Extend cron bounded work (limit 20 rotations alongside existing bounded jobs), sanitized counts/status logs only. Test existing cron authentication and fairness. GREEN; no live registry update during testing.

### Task 4: PIN/passkey re-auth and cross-device ring restoration

**Files:** Create `features/privacyKeys/reauthenticate.ts`; modify WalletProvider, notes/session adapter, useChangeRecoveryPin and wallet escrow service/gate admission. Tests `privacyKeyRecovery.test.ts`, `privacyKeyPinChange.test.ts`, existing WalletProvider/escrow/passkey/useChangeRecoveryPin suites.

**Interfaces:** browser-only `reauthenticatePrivacyRoot(method:'pin'|'passkey',pin?:string):Promise<Uint8Array>`; `unlockPrivacyKeyring(root,state):Promise<LocalPrivacyKeyring>` (derive, verify metadata authorization/evidence, install); Wallet context adds public `privacyGeneration`, `privacyRevision`, `privacyStateStatus` and controlled refresh/re-auth actions, not private ring/root fields. PIN-change ticket uses Task 2 recovery-change mode and is held through exact replacement verification.

- [ ] RED fresh device recovers generations 0/1 from same PIN escrow/passkey and public history; changed PIN preserves both accounts. An established generation-1 account must not invoke old generation-0 registry repair.

```ts
const f = await makePrivacyFixture(), encrypted = serializeEscrow(encryptMaster(f.root,'123456'));
const unwrapped = decryptMaster(deserializeEscrow(encrypted),'123456');
try { const ring = await unlockPrivacyKeyring(unwrapped,f.confirmedState1);
 expect(accountForGeneration(ring,0)).toEqual(f.accounts.get(0));
 expect(accountForGeneration(ring,1)).toEqual(f.accounts.get(1)); } finally {unwrapped.fill(0);}
expect(registrySetter).not.toHaveBeenCalled();
```

`confirmedState1` fixture extension is revision 2/active 1, unchanged gen0 and gen1 evidence from Task 3; authorization metadata includes its real approval. `registrySetter` is the test spy on the existing chain `setUsernamePubkeys`, which must not be used for an established ring.
- [ ] Run new/relevant recovery suites to RED. Implement PIN root unwrap or existing passkey unlock (never create a new credential/root for routine rotation); verify original root via derived historical public pairs before install. Keep stored passkey recovery view key as root/generation-0 recovery identity; it is not the mutable active privacy view key.
- [ ] Replace account setup/unlock paths with generation-aware restore, retaining legacy generation-0 bootstrap. SavePasskey/secure-PIN repair cannot bypass established history or silently republish keys. Wrong PIN/passkey, missing metadata, changed owner, truncated history or an unmanaged registry pair yields stable conflict/recovery guidance and no registry write.
- [ ] Acquire recovery ticket before PIN mutation; reconcile lost escrow response exactly as existing rotateEscrow does, then release. Pending rotation blocks recovery re-wrap; active recovery ticket blocks rotation. Root/private data stays local; private buffers cleared in finally, session clearing drops all generations. Test storage/log spies with distinct root markers and wallet/lock async changes.
- [ ] GREEN recovery/PIN/passkey tests. Public `/pay` and `/verify` route bootstrap exemptions remain unchanged.

### Task 5: Generation-aware notes, old records, cash-out and receipts

**Files:** Modify notes scanner, `useMyNotes.ts`, withdraw functions/dialog, DiscloseDialog/prepareReceipt, request/transfer crypto selectors and recovery hooks (`useRequests`, `useTransfers`, `useDirectTransfer`, `useRequestPayment`, requestNoteRecovery/transferNoteRecovery). Tests `privacyKeyScanning.test.ts`, `privacyKeyRecordRecovery.test.ts`, `privacyKeyWithdrawReceipt.test.ts`, existing note/recovery/disclosure/receipt/withdraw suites.

**Interfaces:** MyNote adds optional `keyGeneration?:KeyGenerationId` and internal preparation origin where needed. `scanKeyringNotes(ring,pool,options):Promise<ScanResult>` reuses one complete public mirror; existing scanMyNotes(singleAccount,options) remains supported. `accountForNote` and `accountForParticipant` from Task 1 are used at proof/envelope boundaries. Cache identity includes owner/registry/revision, generation and pool; watermark metadata is preserved.

- [ ] RED decrypt old/current notes at equal nominal amounts with correct nullifiers, no duplicate counting, and choose old account for a receipt/withdrawal. Fixture `makeGenerationNotes` in this task creates real encrypted note outputs from existing `createNoteOutput`, builds a contiguous mirror, and maps source generation for each index.

```ts
const f = await makeGenerationNotes([{generation:0,amount:15_000_000n},{generation:1,amount:5_000_000n}]);
const scan = await scanKeyringNotes(f.ring,f.pool,f.scanPorts);
expect(scan.claimable).toBe(20_000_000n);
expect(scan.notes.map(n=>n.keyGeneration)).toEqual([0,1]);
expect(accountForNote(f.ring,scan.notes[0])).toBe(f.ring.accounts.get(0));
expect(f.nullifierCalls[0].secret).toBe(f.ring.accounts.get(0)?.ownerSecret);
```

`scanPorts` is an optional test dependency object with mirror loader and spent reader; production uses existing mirror/isSpent. Do not replace note decryption or commitment checks with mocked success.
- [ ] Run these three suites to RED. Precompute derived public keys per generation; decrypt each event against bounded keys and verify owning commitment. A supplied note tag alone is not authority: account selection at spending/export recomputes against the actual stored leaf. Dedup scope/index/commitment and calculate spent status with the matching secret. Keep active and legacy asset totals separate; stale scans do not become ready balances.
- [ ] Select record account by BOTH immutable note/view pubkeys for requester/addressee and sender/recipient. Keep signed envelope metadata and versions unchanged; try legacy/private recovery-frame decoders as applicable. A late old-key payment is discovered, old received/sent rows decrypt, and confirmed preparation outputs use their actual owning generation.
- [ ] Cash-out and receipt preparation choose note owner account even when active generation differs. Enforce scope/leaf/commitment before proving. Single-note and all-notes withdrawals operate per owning generation; existing partial failure/reconcile behavior remains. Anchored receipt schema/fingerprint does not need private generation identifiers.
- [ ] Test generation/pool index collisions, zero/internal notes, wallet switch clearing caches, old receive after a fully rotated current balance, invalid tags and unknown keys. GREEN old and new scan/cash-out/receipt/record suites.

### Task 6: Cross-generation funding and ownership-separated proofs

**Files:** Create `generationFunding.ts`; modify selectFunding/funding exports, requestProofs/transferProofs and corresponding operation contexts/hooks. Tests `generationFunding.test.ts`, `generationProofs.test.ts`, existing selectFunding/requestProofs/transferProofs tests.

**Interfaces:**

```ts
type GenerationFundingAction = FundingAction | {
 kind:'key-migrate';inputIndex:number;amount:bigint;
 fromGeneration:KeyGenerationId;toGeneration:KeyGenerationId;
};
function nextGenerationFundingAction(notes:readonly MyNote[],amount:bigint,scope:PoolScope,
 fundingGeneration:KeyGenerationId):GenerationFundingAction;
// Existing c.account remains recordAccount for envelope identity checks.
type GenerationProofContext = {keyring:LocalPrivacyKeyring;fundingGeneration:KeyGenerationId};
```

Add optional generation context to existing Request/Transfer proof contexts for legacy callers. Established multi-generation operations require captured context; missing IDs may only use the legacy-0 singleton. Produce `buildRequestKeyMigrationSubmission(context,action)` and `buildTransferKeyMigrationSubmission(context,action)` returning the respective existing signed submission types with wire kind `split`.

- [ ] RED two owner generations must not be selected for Merge:

```ts
const notes = [{...a,keyGeneration:0,amount:15_000_000n},{...b,keyGeneration:1,amount:5_000_000n}];
expect(nextGenerationFundingAction(notes,20_000_000n,pool.scope,1)).toMatchObject({kind:'key-migrate',fromGeneration:0,toGeneration:1,amount:15_000_000n});
expect(nextGenerationFundingAction(notes,5_000_000n,pool.scope,1)).toEqual({kind:'payment',inputIndex:b.leafIndex});
```

Here a/b are real owned fixture notes from Task 5, sharing one pool and differing leaf index/key generation. Run funding/proof suites to RED.
- [ ] Prefer sufficient target-generation funding first. If short, choose old eligible notes deterministically, transfer only the target deficit (bounded by selected note amount) to captured funding generation, and keep change under source generation. Rescan after confirmation; merge only notes of one owner generation. Filter every choice by exact pool and capabilities; max64 arithmetic stays checked.
- [ ] Separate record account (decrypt/participant validation) from note source account (Merkle opening/nullifier/proof) and funding target account (self-output). For old requests beginning after rotation, decrypt via old addressee pair while capturing current payer funding generation; preserve requester recipient commitment/view key from the immutable request. Direct Send begins with current sender pair; accepted operations retain their captured pair/generation.
- [ ] Build migration with existing Transfer circuit and two outputs, encoded as signed preparation kind `split`. Do not relax circuit checks or sign unsupported `key-migrate` public kind. Local output creation binds target pair and source change exactly; user signature binds opaque commitments/envelopes, while server verifies signature/conservation/receipt and does not learn private amount/salt/generation secrets.
- [ ] Version encrypted sender recovery payloads privately to identify each owned output's generation; keep ciphertext padding/outer signed v1 packet compatibility. Decoder supports legacy array payload and new `{version:2,outputs:[...generation...]}` within existing frame. Request change discovery uses ring decryption/commitment checks, preserving old fixed request envelopes.
- [ ] Validate known source/target entries and actual input leaf before proof, guard session/revision before signing/submission, and test no cross-pool migration, mislabeled notes, recipient substitution, and merge sum overflow. GREEN real proving-artifact tests plus existing protocol regressions.

### Task 7: Fenced app operations, recovery and internal history

**Files:** Modify request/transfer repositories/operations, authenticated app spend/cash-out admission, PIN gate boundaries, generation funding hooks, recovery frames and payment activity/evidence classification. Tests `generationOperationGate.test.ts`, `generationPaymentRecovery.test.ts`, `generationActivity.test.ts`, existing spendReservations/durableRelayer/requestOperations/transferOperations/activityRows suites.

**Interfaces:** store additive captured `{fundingGeneration,keyRevision,accountTicketId}` on app payment operations, with legacy fallback only to validated generation 0. New server begin/admission uses Task 2 ticket; read/status responses expose captured context to the owner. Already accepted submissions/journal hashes remain immutable. Add recovery-owned output `generation?:number` only inside encrypted recovery data, with legacy decoder resolving the captured record pair.

- [ ] RED rotation wins admission and delayed payment cannot create/sign/accept a new step; opposite order leaves rotation blocked while the payment owns a ticket. Same operation/ticket retry is idempotent; two pool operations can coexist.

```ts
const f = await makeAccountGateFixture();
const ticket = await f.beginPayment({pool:f.ausd.scope});
await expect(f.prepareRotation()).rejects.toMatchObject({code:'CONFLICT'});
await f.confirmPayment(ticket);
expect((await f.prepareRotation()).intent.to).toBe(1);
```

Define fixture using Task 2 real DB and actual operation service calls with authenticated bound wallet, existing request/transfer fixtures and injected confirmed/unknown receipt ports. Do not implement a fake admission service in the fixture.
- [ ] Run gate/recovery/activity suites to RED. Atomically acquire ticket before publishing active preparation; persist captured generation before accepting proof. If operation persistence fails after gate admission, repair from ticket/intent or release only when it is proven unsigned/unaccepted. Do not auto-expire signed/unknown operation tickets. Finish/revert or safe abandoned unsigned work releases admission only after existing journal/spend checks.
- [ ] App cash-out admission is authenticated when invoked by logged-in app, without making existing anonymous proof endpoints private. Optional authenticated tickets guard known app spending; external anonymous valid proofs remain immutable and are not claimed to be blockable by rotation. Rotation checks tracked active outgoing operations across ALL configured pools and repairs legacy operations missing tickets before allowing it.
- [ ] Accepted migration steps use current durable relayer/spend claims, scoped nullifiers, exact step digests and evidence. Recovery reopens after lock/reload with owning generations. Recipient/sender view pairs captured in signed record select decryption; internal note generation is encrypted, not a plaintext historical-key exposure in new public APIs.
- [ ] Test migration confirmed/final failed => private new-generation note survives, no duplicate spend; unknown broadcast => original claims/bytes retained; final payment => exact one recipient amount/change; rotated recipient old request still settled to its original commitment. BuildActivityRows marks migration/split/merge/change internal, including different-key self-output, and preserves truthful missing-evidence/locked states.
- [ ] GREEN gate, durable coordinator, operation, recovery and activity suites. No automatic migration runs on rotate/unlock/refresh.

### Task 8: Settings rotation/re-auth/reconciliation flow

**Files:** Create `usePrivacyKeyRotation.ts`, `RotatePrivacyKeyDialog.tsx`; modify SettingsDashboard/WalletProvider context integration. Tests `RotatePrivacyKeyDialog.test.tsx`, `privacyKeyRotation.hook.test.tsx`, existing SettingsDashboard/WalletProvider/recovery modal suites.

**Interfaces:** hook returns `{state,operation,isWorking,error,prepare:(pin?:string)=>Promise<void>,confirm:()=>Promise<void>,check:()=>Promise<void>,clear:()=>void}`. Re-auth root is used to derive/verify candidate, then cleared; review retains public candidate and necessary session-owned account context only. Private root/key data is not exposed as hook result or wallet context.

- [ ] RED actual dialog rotation review does not invoke any pool spender:

```tsx
render(<RotatePrivacyKeyDialog open onOpenChange={close}/>);
await user.type(screen.getByLabelText('Current recovery PIN'),'123456');
await user.click(screen.getByRole('button',{name:'Review rotation'}));
await screen.findByText(/No private funds are moved/);
expect(poolSpend).not.toHaveBeenCalled();
```

`user` is userEvent.setup; actual component uses controlled wallet/re-auth/registry ports. `poolSpend` spies existing transfer/Merge/withdraw transports; it is not a mocked rotation implementation. Run UI/hook suites to RED.
- [ ] Build Privacy keys row (active generation/last confirmed change/pending action). Enforce claimed username, verified root/history/recovery, count limit and no admitted conflicts. PIN input uses established dialog patterns; passkey prompts use existing credential. Display short public fingerprint, source/target generation and the routine/non-revocation meaning, not private keys.
- [ ] Review then sign metadata/registry authorization; relayed update or wallet transaction may need additional approval as shown. Progress covers submitted/confirming/synchronizing/success/error/unknown. On known success, refresh verified metadata/public cache, install candidate ring and invalidate owned-data caches. Closing pending dialog preserves operation; reopening/checking does not prepare a duplicate.
- [ ] Wallet/lock/revision/selection changes clear unaccepted root/review and prevent stale signatures/downloads/state updates. Pending accepted operation continues reconcile only under its captured authenticated owner. Test fresh-device recovery, conflict, network response lost, metadata projection failure, wrong PIN/passkey, generation limit, and no bootstrap reset.
- [ ] Desktop/mobile actual UI visual checks, keyboard/focus/input labels, inline readable state and error actions; existing product style with no unrelated redesign. GREEN UI and full affected provider/recovery tests.

### Task 9: Real proof/registry evidence, full regression and docs

**Files:** Create `contracts/test/privacyKeyGenerations.test.ts`, `docs/privacy-key-rotation.md`; update features/security/reference/PIN/direct-transfer/request/receipt operations docs; any test artifacts require explicit local flag and a created directory, never ignored-directory CI dependencies.

- [ ] Real local circuit evidence uses existing deployPoolFixture/depositOwnedNote/makeTransferProof/makeMergeProof/output/rememberOwned: old-secret note 15 AUSD and new-secret note 5 AUSD; merge under one secret must reject mixed inputs. Transfer old 15 into current public key (zero source change), discover current-owned note, merge 15+5, pay exact 20 and preserve independent USDC inputs.

```ts
const f = await deployPoolFixture({name:'Agora USD',symbol:'AUSD'});
await depositOwnedNote(f,{amount:15_000_000n,ownerSecret:1001n,salt:11n});
await depositOwnedNote(f,{amount:5_000_000n,ownerSecret:1002n,salt:12n});
const move = await makeTransferProof(f,{index:0,ownerSecret:1001n,
 recipientPk:await H([1002n]),recipientAmount:15_000_000n,recipientSalt:13n,changeSalt:14n});
await f.pool.write.transfer([move.root,move.nullifier,move.proof,output(move.recipientCommitment),output(move.changeCommitment)]);
const migrated = await rememberOwned(f,BigInt(move.recipientCommitment),{amount:15_000_000n,ownerSecret:1002n,salt:13n});
const merge = await makeMergeProof(f,{indices:[1,migrated],ownerSecret:1002n,outSalt:15n});
await f.pool.write.merge([merge.root,...merge.nullifiers,merge.proof,output(merge.outputCommitment)]);
expect(merge.outputAmount).to.equal(20_000_000n);
```

- [ ] Registry fixture records pool leaves/nullifiers/token balances, performs actual authorized public-key rotation, and asserts those pool values unchanged. Test wrong-owner/expired/replayed registry permit, direct/relayed identical key result, canonical confirmation and 0/1 key restoration. This evidence can already pass for existing circuit primitives; distinguish evidence from new RED→GREEN feature tests.
- [ ] Run targeted contract test then complete contract suite. Run relevant crypto/recovery/scan/spend/coordinator/record/history/receipt/UI suites; then complete web `pnpm test -- --maxWorkers=1 --testTimeout=30000` (known Windows startup overhead), TypeScript and scoped Biome. Assert behavior unchanged by timeout tuning; report skips/environment limits.
- [ ] Root `pnpm build:local`, supported production-server smoke and desktop/mobile Settings actual components. Anonymous Verify/payer routes and protected APIs retain behavior. Real authenticated/live registry/payment action is separate evidence; never perform it merely to hide a limitation or infer it from local tests.
- [ ] One fresh read-only whole-feature review per inline execution skill, focused on false activation, root storage, old-note ownership, operation races and internal classification. Reproduce/fix critical/important findings with one justified RED→GREEN fix pass; record minor/deferred items and reviewer availability honestly.
- [ ] Update operational docs with generation limits/domains, same-root recovery, late old-key receives, pending reconciliation, PIN coordination, legacy withdrawal behavior, partial preparation recovery, immutable records and non-compromise scope. Explain migrations as additive/index-only and no destructive rollback. Inspect staged/unstaged/untracked scope and whitespace; retain local branch without remote/live actions until separately requested.

## Preflight, coverage and self-review

| Spec requirement | Tasks |
| --- | --- |
| Generation-0 compatibility, deterministic bounded history and memory privacy | 1, 4 |
| Verified public metadata, signed CAS and one pending rotation | 2, 3 |
| Account gate across spending and recovery changes | 2, 4, 7 |
| Exact registry intent/nonce/bytes and loss/reorg/projection recovery | 3, 8 |
| Old/new note/record selection, cash-out and receipt ownership | 5 |
| No cross-owner Merge; later user-confirmed internal preparation only | 6, 7, 9 |
| Legacy signed packets/encrypted-frame compatibility and no duplicate income | 5–7 |
| Actual Settings interaction, limits, unknown/mismatch and cross-device restore | 4, 8 |
| Real circuits/registry, full regressions, reviewer and truthful docs | 9 |

Implementation rulings already resolved: gate admits multiple spend tickets but
excludes rotation/recovery writes; registry updates consume SetPubkeys permit nonce
in both modes; c.account remains record identity while source/funding ownership is
explicit; internal action key-migrate encodes existing split wire kind; new recovery
payload versions remain encrypted and legacy decoding stays intact. Root/generation
metadata is never silently reset or derived from a previous generation secret.

Plan self-review: all spec sections have owners/tests, shared functions and fixtures
are defined before their consumers, state/evidence boundaries have actual CAS/crypto
tests, and no private-key vault, automatic background transfer, new circuit/artifact,
root replacement or unauthorized remote/live delivery is included. Review this
saved plan before product implementation; preserve inline execution preference.
