# Receipt Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export matching anchored PDF/JSON receipts and let anyone verify one disclosed note against the correct historical pool state without signing in or uploading private proof data.

**Architecture:** A browser-only parser/math verifier validates the disclosed note. A read-only public tRPC query returns allowlisted historical chain observations; a shared comparison function binds the local proof to those observations. Export and public verification use the same comparison rules and immutable bundle identity.

**Tech Stack:** Existing TypeScript, React/Next.js, Zod v4, viem, Poseidon/Merkle helpers, jsPDF, tRPC, Vitest/Testing Library, and Hardhat. No new package, contract, circuit, verifier, or database migration.

**Spec:** `docs/superpowers/specs/2026-10-06-receipt-verification-design.md` — approved in conversation on 2026-10-06 before writing this plan.

## Global Constraints

- Maximum UTF-8 input size: **64 KiB**. Current tree depth: **20**.
- Cryptographic decimal strings: at most **78 digits** and within the BN254 scalar field. Amount: at most **20 digits**, positive uint64.
- Bound username to **33 characters**, network to **32**, amountLabel to **80**, generation timestamp to **40**. Validate exact address/hash formats.
- Version 2 requires asset/precision and anchor `{blockNumber, blockHash, leafCount}`; preserve version-1 local verification without a chain-verified badge.
- Path directions equal leaf-index bits; decimal/hex aliases agree; display labels are recomputed. Known pools derive asset/precision from their descriptor.
- Process disclosure files in page memory only. No server upload, persistent storage, raw-payload logs/telemetry, or disclosure data in URLs/QRs.
- Only public pool/block coordinates enter the read-only query. No user-controlled RPC, arbitrary contract, event scan, wallet signing, or identity lookup.
- Check root/count/token at the same confirmed historical block, including canonical hash before/after state reads. Preserve legacy pool verification.
- A successful result proves disclosed note inclusion, not invoice settlement, payer identity, uploader ownership of a spending secret, legal identity, or unspent balance.
- Preserve Windows/PowerShell support and the existing local build runner. Consult Context7 for library-specific implementation details.
- Current checkout files match fetched `origin/monad-migration` at `c707af0`; new feature execution must recheck base/dirty files. Preserve spec/plan.
- Inline/native execution is the existing preference. Review this saved plan before implementing. No commit/push/PR/deployment/live activation authorized for this new feature yet.

## Review Focus

1. **Late file/account results:** switching JSON, payment, pool, account, or lock state must clear old data and prevent an old green result/download. Tests: Tasks 4 and 5.
2. **Index ambiguity:** a valid path with a false leaf index must fail, including identical indices/nominal amounts across pools. Tests: Tasks 1 and 3.
3. **Misleading metadata:** changed username, printed amount, asset, PDF fingerprint, or generation date must never become authenticated identity or chain payment time. Tests: Tasks 1 and 4.
4. **Unavailable chain evidence:** old roots, pruned RPC data, reorg during reads, and low confirmation depth must not turn unavailable evidence into green or an accusation of fabrication. Tests: Tasks 2, 3, and 6.
5. **Privacy through integration boundaries:** a malicious file must not forward private fields, leak through error logs/storage, or select an arbitrary endpoint. Tests: Tasks 2 and 5.

## File map and responsibilities

| Unit | Files | Responsibility |
| --- | --- | --- |
| Local wire/proof | `web/src/features/receipts/receiptTypes.ts`, `receiptSchema.ts`, `receiptProof.ts`, `receiptIdentity.ts` | Bounded versions, local math, canonical fingerprint |
| Shared chain contract | `web/src/features/receipts/receiptChainTypes.ts`, `receiptVerification.ts` | Public observation types and local comparison/orchestration |
| Public RPC | `web/src/server/modules/receipts/receipts.schema.ts`, `receipts.rpc.ts`, `receipts.service.ts`, `receipts.router.ts`; `web/src/server/root.ts` | Allowlist, bounded reads, canonical historical snapshot |
| Export | `web/src/lib/notes.ts`, `disclosure.ts`, `disclosurePdf.ts`; `web/src/features/receipts/prepareReceipt.ts`, `downloadReceiptJson.ts`; `web/src/components/dashboard/DiscloseDialog.tsx` | Preserve watermark, prepare anchored receipt, matching downloads |
| Public UI | `web/src/app/verify/page.tsx`; `web/src/components/receipts/VerifyReceipt.tsx`; `web/src/features/receipts/useReceiptVerification.ts`; `web/src/components/AppShell.tsx` only if route presentation needs it | Anonymous upload/result/retry/clear flow |
| Fixtures/tests | `web/test/helpers/receiptFixtures.ts`, `receiptRpcFixture.ts`; exact tests below; `contracts/test/receiptAnchors.test.ts` | Real cryptography, controlled failures, actual historical contract reads |
| Docs | `docs/receipt-verification.md`, `docs/features.md`, `docs/reference.md`, `docs/practical-privacy.md`, `docs/local-setup.md`, `README.md` | User journey, meaning of result, archive prerequisite, evidence |

Keep existing modules in place; no unrelated provider, payment, indexer, or auth refactor.

## Shared types (introduced in Task 1)

Place wire types in `receiptTypes.ts`; import existing `AssetSymbol` and `PoolDescriptor`/`PoolScope` types. `ReceiptV1` mirrors the present `DisclosureBundle` exactly, including optional asset/decimals; `ReceiptV2` removes optionality for those metadata fields and adds its anchor. Public observations live separately in `receiptChainTypes.ts`.

```ts
type ReceiptAnchor = { blockNumber: number; blockHash: `0x${string}`; leafCount: number };
type ReceiptV2 = Omit<ReceiptV1, 'version' | 'asset' | 'tokenDecimals'> & {
  version: 2; asset: AssetSymbol; tokenDecimals: number; anchor: ReceiptAnchor;
};
type ReceiptBundle = ReceiptV1 | ReceiptV2;
type ReceiptIdentity = { reference: string; fingerprint: string };
type ReceiptParseResult =
  | { status: 'parsed'; bundle: ReceiptBundle; pool: PoolDescriptor }
  | { status: 'invalid'; reason: string }
  | { status: 'unsupported'; reason: string };
type ReceiptChainInput = { pool: PoolScope; blockNumber: number; blockHash?: `0x${string}` };
type ReceiptChainSnapshot = {
  pool: PoolScope; chainId: number; blockNumber: number; blockHash: `0x${string}`;
  root: `0x${string}`; leafCount: number; token: `0x${string}`;
  tokenDecimals: number; headBlock: number; confirmed: boolean;
};
type ReceiptChainOutcome =
  | { status: 'available'; snapshot: ReceiptChainSnapshot }
  | { status: 'unavailable'; reason: string }
  | { status: 'mismatch'; reason: string };
type ReceiptVerificationResult =
  | { status: 'verified'; local: 'passed'; chain: 'passed'; identity: ReceiptIdentity }
  | { status: 'invalid'; local: 'passed' | 'failed'; chain: 'failed' | 'not-run'; reason: string }
  | { status: 'unavailable'; local: 'passed' | 'not-run'; chain: 'unavailable'; reason: string; identity?: ReceiptIdentity };
type LoadReceiptSnapshot = (input: ReceiptChainInput) => Promise<ReceiptChainOutcome>;
```

The optional input blockHash enables export to obtain the canonical hash for its known watermark. Verification supplies the bundle's expected hash. Both paths require stable before/after canonical hashes; the browser comparison also checks the returned hash. These public input fields are the entire wire allowlist.

### Task 1: Bounded versions, local proof validation, and stable identity

**Files:** Create the four local wire/proof files and `receiptChainTypes.ts` from the map. Modify `web/src/lib/disclosure.ts` to reuse math/types without breaking version-1 construction. Create `web/test/helpers/receiptFixtures.ts`, `web/test/receiptSchema.test.ts`, `receiptProof.test.ts`, `receiptIdentity.test.ts`; retain `web/test/disclosure.test.ts`.

**Interfaces:**
- Produces `parseReceiptJson(text: string, resolve?: (scope: string) => PoolDescriptor | null): ReceiptParseResult`, defaulting to `findPool`.
- Produces `verifyReceiptMath(bundle: ReceiptBundle, depth?: number): Promise<{commitmentOk:boolean;rootOk:boolean;valid:boolean}>`, default depth 20. Invalid numeric/shape inputs return false rather than leaking raw errors.
- Produces `canonicalReceiptJson(bundle: ReceiptBundle): string` and `receiptIdentity(bundle: ReceiptBundle): Promise<ReceiptIdentity>`.
- Retains `buildDisclosure(params)` as the version-1 builder and `verifyDisclosure(bundle)` as a compatible math-only wrapper. Introduce `ReceiptBundle` for v2 callers instead of making legacy export APIs claim chain verification.

- [ ] Write fixtures with real Poseidon commitments/paths, not mocked success booleans. Define `makeReceiptFixture(asset: AssetSymbol = 'AUSD')` returning `{v1,v2,pool,account,scan,snapshot}`. Use existing `assetPool`, `testAccount`, `commitment`, `ownerPk`, `merkleProof`, and `toBE32/bytesToHex`.

```ts
const pool = assetPool(asset), account = testAccount(1);
const amount = 20_000_000n, salt = 7n, leafIndex = 0;
const pk = await ownerPk(account.ownerSecret);
const leaf = await commitment(amount, pk, salt);
const path = await merkleProof([leaf], leafIndex, pool.depth);
const v1:ReceiptV1 = {version:1,pool:pool.address,network:'eip155:31337',leafIndex,
  commitment:leaf.toString(),commitmentHex:bytesToHex(toBE32(leaf)),
  root:path.root.toString(),rootHex:bytesToHex(toBE32(path.root)),
  amount:amount.toString(),amountLabel:'20',ownerPk:pk.toString(),salt:salt.toString(),
  pathElements:path.pathElements.map(String),pathIndices:path.pathIndices,
  username:'alice',disclosedAt:'2026-10-06T00:00:00.000Z',asset,tokenDecimals:6};
const v2:ReceiptV2 = {...v1,version:2,asset,tokenDecimals:6,
  anchor:{blockNumber:100,blockHash:`0x${'11'.repeat(32)}`,leafCount:1}};
const scan:ScanResult = {scope:pool.scope,notes:[{scope:pool.scope,leafIndex,amount,salt,spent:false}],
  leaves:[leaf],claimable:amount,mirrorAvailable:true,indexedAt:v1.disclosedAt,
  health:'healthy',snapshot:{blockNumber:100,leafCount:1}};
const snapshot:ReceiptChainSnapshot = {pool:pool.scope,chainId:31337,blockNumber:100,
  blockHash:v2.anchor.blockHash,root:`0x${v2.rootHex}`,leafCount:1,token:pool.token,
  tokenDecimals:6,headBlock:105,confirmed:true};
return {v1,v2,pool,account,scan,snapshot};
```

Build every existing field explicitly: `network: 'eip155:31337'`, lowercase pool address, both root/commitment aliases, amount/ownerPk/salt decimal strings, `amountLabel:'20'`, path arrays, `username:'alice'`, `disclosedAt:'2026-10-06T00:00:00.000Z'`. The helper resolver used in tests returns that descriptor only for its exact scope.

- [ ] RED tests reject a changed leaf index with an unchanged mathematically valid path, out-of-field siblings, wrong hex alias, oversized UTF-8, unknown object keys, huge decimal strings, excessive precision, mismatched asset, and fabricated labels.

```ts
const f = await makeReceiptFixture();
const resolve = (scope: string) => scope === f.pool.scope ? f.pool : null;
expect(parseReceiptJson(JSON.stringify({...f.v2, leafIndex:1}), resolve).status).toBe('invalid');
expect(parseReceiptJson(JSON.stringify({...f.v2, amountLabel:'200'}), resolve).status).toBe('invalid');
expect(parseReceiptJson(' '.repeat(65_537), resolve).status).toBe('invalid');
expect((await verifyReceiptMath({...f.v2, salt:'8'})).valid).toBe(false);
```

- [ ] Run `pnpm test -- test/receiptSchema.test.ts test/receiptProof.test.ts test/receiptIdentity.test.ts test/disclosure.test.ts --maxWorkers=2` in `web/`; confirm actual RED cause.
- [ ] Implement strict version schemas with `z.strictObject`, bounded decimal strings before BigInt refinement, and a discriminated version union. The parser reports unknown version/pool/network as unsupported; malformed supported shapes are invalid. Validate alias equality, path bits/count/depth, scalar range, uint64, configured asset/precision, and recomputed label before RPC.

```ts
const decimal = z.string().regex(/^\d+$/).max(78);
const scalar = decimal.refine(v => v.length <= 78 && /^\d+$/.test(v) && BigInt(v) < SNARK_FIELD);
const amount = z.string().regex(/^\d+$/).max(20)
  .refine(v => v.length <= 20 && /^\d+$/.test(v) && BigInt(v) > 0n && BigInt(v) <= MAX_REQUEST_AMOUNT);
// After bounded shape parsing, check each path bit against leafIndex, alias
// equality, and version-specific anchor/index bounds. Return only reason codes.
```

Normalize decimals with `BigInt(value).toString()`, hex aliases to lowercase, pool/hash case, and known missing v1 USDC metadata to its descriptor. Stable serialization writes explicitly ordered existing fields, adding anchor only for v2. Do not pass an arbitrary input object directly to the serializer.
- [ ] Compute SHA-256 using Web Crypto over canonical UTF-8 JSON. Return `fingerprint:'sha256:'+hex` and `reference:'MAWEE-'+hex.slice(0,16).toUpperCase()`. Identity covers issuer metadata too; do not pretend it authenticates it. Test that whitespace/key order/leading-zero normalization preserve identity and changed username/anchor/amount changes identity. Display username as issuer-provided later.
- [ ] GREEN the command above. Preserve existing math return shape and version-1 builder callers; do not import WalletProvider, tRPC, or browser storage into the verifier modules. Record verification locally; commits await separate authorization.

### Task 2: Allowlisted historical chain observations

**Files:** Create the four `server/modules/receipts` files; register `receipts` in `server/root.ts`. Create `web/test/helpers/receiptRpcFixture.ts`, `web/test/receiptChain.service.test.ts`, `web/test/receipts.router.test.ts`.

**Interfaces:**
- Consumes Task 1 chain input/output types.
- Produces `getReceiptChainSnapshot(input: ReceiptChainInput): Promise<ReceiptChainOutcome>` and `api.receipts.chainSnapshot.query(input)`.
- Define injectable reader port in `receipts.service.ts`: `ReceiptRpcReader` with `chainId():Promise<number>`, `head():Promise<number>`, `block(number):Promise<{number:number;hash:Hex}>`, `root(pool,number):Promise<Hex>`, `leafCount(pool,number):Promise<number>`, `token(pool,number):Promise<Hex>`, and `decimals(token,number):Promise<number>`. Here `Hex` is viem's existing type.
- Define `readReceiptChainSnapshot(input, deps):Promise<ReceiptChainOutcome>` where `deps` has `{reader:ReceiptRpcReader,resolve:(scope:string)=>PoolDescriptor|null,chainId:number}`. The production wrapper supplies configured dependencies; tests inject controlled readers.

- [ ] RED service test models a canonical hash changing during reads and expects unavailable rather than available. The helper `makeReceiptRpcFixture(fixture)` returns `{reader,calls,setHash,setHead,fail}` with named methods as `vi.fn`; it defaults to Task 1's snapshot, records every pool/block argument, and lets `block` return hashes in sequence.

```ts
const f = await makeReceiptFixture(), rpc = makeReceiptRpcFixture(f);
rpc.reader.block.mockResolvedValueOnce({number:100,hash:f.v2.anchor.blockHash})
  .mockResolvedValueOnce({number:100,hash:`0x${'22'.repeat(32)}`});
const result = await readReceiptChainSnapshot({pool:f.pool.scope,blockNumber:100}, {
  reader:rpc.reader,resolve:s => s === f.pool.scope ? f.pool : null,chainId:31337,
});
expect(result).toEqual({status:'unavailable',reason:'reorg-during-read'});
```

- [ ] RED router test creates a caller using existing context fixtures with no Privy user and invokes `receipts.chainSnapshot` successfully. Input containing `salt`, `ownerPk`, `amount`, `pathElements`, `rpcUrl`, or a filename must reject before the reader. Unknown scopes/networks return unavailable without any RPC call.
- [ ] Run `pnpm test -- test/receiptChain.service.test.ts test/receipts.router.test.ts --maxWorkers=2` and confirm RED.
- [ ] Implement the strict public input/output schemas. Rates: 20 queries/minute per `ctx.ip ?? 'unknown'`; at most 8 concurrent receipt snapshot operations/process. Busy/rate-limited requests return unavailable with retry guidance. Release slots in `finally`; do not call a spending/relayer method.
- [ ] Implement a dedicated read-only viem adapter using the existing configured public chain RPC. Use `http(rpcUrl,{timeout:3000,retryCount:0})`. Never expose its URL/errors. Read `getChainId`, head, and first block in one wave; then `currentRoot`, `nextIndex`, and `token` at `blockNumber:BigInt(input.blockNumber)`; then token `decimals` and the second block hash. No fallback to latest state. Bound the operation to 12 seconds; if the deadline wins, retain the concurrency slot until the underlying timed reads finish. Store no disclosure metadata.

```ts
const before = await reader.block(input.blockNumber);
const [root, leafCount, token] = await Promise.all([
  reader.root(pool, input.blockNumber), reader.leafCount(pool, input.blockNumber),
  reader.token(pool, input.blockNumber),
]);
const [tokenDecimals, after] = await Promise.all([
  reader.decimals(token, input.blockNumber), reader.block(input.blockNumber),
]);
if (before.hash !== after.hash) return {status:'unavailable',reason:'reorg-during-read'};
```

Before contract reads reject out-of-range/future/pre-deployment blocks; compare actual RPC chain id. Confirmation rule: `headBlock - blockNumber + 1 >= pool.confirmations`. A stable canonical hash differing from requested hash returns mismatch; wrong token/precision/chain returns mismatch. Pruned calls/contract-RPC failures return unavailable with sanitized reason. A stale head can delay verification, never authorize a future anchor.
- [ ] Add tests for all three read waves pinned to the same block, legacy role allowed, token/precision/chain mismatch, requested hash mismatch, predeployment/future block, low confirmations, RPC error, deadline/slot release, and no arbitrary address/URL execution. Ensure warnings/errors never include RPC credentials or file fields.
- [ ] GREEN service/router tests and existing `deposits.service.test.ts`/`privyAuth.test.ts` regressions. Record exact results.

### Task 3: Bind local proof to public chain state

**Files:** Create `web/src/features/receipts/receiptVerification.ts` and `web/test/receiptVerification.test.ts`.

**Interfaces:**
- Consumes `ReceiptBundle`, `PoolDescriptor`, `ReceiptChainOutcome`, `LoadReceiptSnapshot`, math and identity helpers.
- Produces `compareReceiptSnapshot(bundle:ReceiptV2,pool:PoolDescriptor,outcome:ReceiptChainOutcome,identity:ReceiptIdentity):ReceiptVerificationResult`.
- Produces `verifyReceipt(bundle:ReceiptBundle,pool:PoolDescriptor,load:LoadReceiptSnapshot,isCurrent?:()=>boolean):Promise<ReceiptVerificationResult>`.

The orchestration computes identity before comparison; every consumer passes that same identity as the fourth argument.
Default `isCurrent` to `() => true` inside verifyReceipt; callers that supply a generation guard use the same guard through math, query, and result publication.

- [ ] RED with a genuine locally valid receipt and a different real/public root. It must be invalid with `local:'passed',chain:'failed'`, never green merely because the supplied root matches its supplied path.

```ts
const f = await makeReceiptFixture();
const load = vi.fn().mockResolvedValue({status:'available',snapshot:{...f.snapshot,root:`0x${'33'.repeat(32)}`}});
const result = await verifyReceipt(f.v2,f.pool,load);
expect(result).toMatchObject({status:'invalid',local:'passed',chain:'failed'});
expect(load).toHaveBeenCalledWith({pool:f.pool.scope,blockNumber:100,blockHash:f.v2.anchor.blockHash});
```

- [ ] Run `pnpm test -- test/receiptVerification.test.ts --maxWorkers=2` and confirm RED.
- [ ] Implement math first, identity second, then public query only if still current. Bad math returns invalid without RPC. V1 returns unavailable/anchor-missing after valid local math without RPC. Compare scope/chain/block/hash, confirmed flag, root, count, target-index bound, token and precision against the known descriptor.

```ts
if (!(await verifyReceiptMath(bundle,pool.depth)).valid)
  return {status:'invalid',local:'failed',chain:'not-run',reason:'proof-mismatch'};
const identity = await receiptIdentity(bundle);
if (bundle.version === 1)
  return {status:'unavailable',local:'passed',chain:'unavailable',reason:'anchor-missing',identity};
if (!isCurrent()) return {status:'unavailable',local:'passed',chain:'unavailable',reason:'cancelled'};
const outcome = await load({pool:pool.scope,blockNumber:bundle.anchor.blockNumber,blockHash:bundle.anchor.blockHash});
if (!isCurrent()) return {status:'unavailable',local:'passed',chain:'unavailable',reason:'cancelled'};
return compareReceiptSnapshot(bundle,pool,outcome,identity);
```

- [ ] Add tests for valid v2, altered count/hash/token, cross-pool proof with identical leaf index/amount, backend unavailable, thrown transport error sanitized to unavailable, unconfirmed observation, valid v1 with and without legacy metadata, and cancellation before/after query. A spent/legacy note remains verifiable; no nullifier/spent lookup is performed.
- [ ] GREEN and record result. Keep this module browser-safe; it imports no server-only/WalletProvider/session/storage implementation.

### Task 4: Anchored preparation and matching PDF/JSON exports

**Files:** Modify `web/src/lib/notes.ts`, `disclosurePdf.ts`, `web/src/components/dashboard/DiscloseDialog.tsx`; create `features/receipts/prepareReceipt.ts`, `downloadReceiptJson.ts`. Extend `web/test/helpers/receiptFixtures.ts`; create `receiptExport.test.ts`, `DiscloseDialog.test.tsx`; extend `poolMirror.test.ts`, `requestNoteRecovery.test.ts`, `transferNoteRecovery.test.ts`, `disclosurePdf.test.ts`, `multiAssetReceipts.test.ts`.

**Interfaces:**
- Add optional `snapshot?:{blockNumber:number;leafCount:number}` to `ScanResult` so old mocks/callers retain compatibility. Real scans always carry mirror `publishedBlock` and `publishedLeafIndex+1`; existing recovery helpers preserve it via spreading the scan.
- Produces `prepareReceipt(params:{acct:LocalAccount;scan:ScanResult;note:MyNote;username?:string|null;load:LoadReceiptSnapshot;isCurrent?:()=>boolean}):Promise<ReceiptV2>`.
- Produces `downloadReceiptJson(bundle:ReceiptV2):Promise<void>`.
- Extend existing `renderDisclosurePdf(bundle:ReceiptBundle,options?:{verifyUrl?:string}):Promise<jsPDF>` and `downloadDisclosurePdf` with matching optional options; old v1 call shape remains supported. V2 UI passes an absolute URL from `new URL('/verify',window.location.origin)`.

- [ ] RED preparation test takes a healthy real-crypto fixture and changes its stored target leaf while leaving note amount/salt intact. Export must reject before downloads. Also reject sparse prefixes, missing watermark, leaf-count mismatch, degraded/stale health, changed scope, unavailable snapshot, and canonical root mismatch.

```ts
const f = await makeReceiptFixture();
await expect(prepareReceipt({acct:f.account,scan:{...f.scan,leaves:[123n]},note:f.scan.notes[0],
  load:vi.fn().mockResolvedValue({status:'available',snapshot:f.snapshot})})).rejects.toThrow(/receipt/i);
```

- [ ] RED real dialog test delays snapshot preparation, locks/switches the account or changes leaf/pool, then resolves the first response. Neither download button may expose the old receipt. Define dialog fixture with actual DiscloseDialog plus controlled `useWallet`, `getAccount`, `scanMyNotes`, and public transport; the source component does not get a fixture-only prop.
- [ ] Run `pnpm test -- test/receiptExport.test.ts test/DiscloseDialog.test.tsx test/disclosurePdf.test.ts test/poolMirror.test.ts test/requestNoteRecovery.test.ts test/transferNoteRecovery.test.ts --maxWorkers=2` to RED.
- [ ] Carry snapshot through `scanMirrorForAccount`; validate healthy contiguous prefix and `leaves.length===snapshot.leafCount`, note scope/index, and `scan.leaves[note.leafIndex]===commitment(amount,ownerPk,salt)`. Use version-1 builder for the path, query `{pool:scan.scope,blockNumber:scan.snapshot.blockNumber}`, construct v2 with returned canonical hash/count, and pass it through `verifyReceipt` using the already-read outcome callback. Never perform a second differently timed snapshot lookup for the same export.

```ts
const outcome = await params.load({pool:pool.scope,blockNumber:snapshot.blockNumber});
if (outcome.status !== 'available') throw new Error('Receipt chain data is unavailable. Retry.');
const bundle:ReceiptV2 = {...legacy,version:2,asset:pool.asset,tokenDecimals:pool.tokenDecimals,
  anchor:{blockNumber:snapshot.blockNumber,blockHash:outcome.snapshot.blockHash,leafCount:snapshot.leafCount}};
const checked = await verifyReceipt(bundle,pool,async()=>outcome,params.isCurrent);
if (checked.status !== 'verified') throw new Error('Receipt could not be verified. Refresh and retry.');
return bundle;
```

- [ ] Dialog captures generation id, wallet address, account object, leaf index, pool scope, open/unlocked state. Clear bundle on any change and check current identity after every asynchronous stage and immediately before download. Retry refreshes the scan/watermark and rebuilds; no stale root/block substitution.
- [ ] Add PDF/JSON buttons using one frozen prepared bundle. JSON Blob contains canonical receipt serialization only; derive filename from receipt identity, create an object URL for download, and revoke it. Never store it. PDF computes the identical identity and prints its full fingerprint, reference, generation time, issuer-provided username, configured asset name, export-time anchored inclusion statement, public `/verify` link, and raw appendix.
- [ ] Remove PDF wording that claims verified username, knowledge of a spending secret, available funds, or generation time as payment time. V1 PDF formatting remains supported but clearly lacks anchored verification. UI includes a plain statement that sharing JSON reveals the selected note only; no extra signing step.
- [ ] Test PDF text/reference/fingerprint against downloaded JSON, AUSD and legacy USDC amounts, mobile action layout, exact-byte canonical serialization, URL without proof fields, and object-URL revocation. Existing PDF fixtures must have coherent scalar/alias/path data when they exercise validation; do not weaken validators to retain malformed illustrative fixtures.
- [ ] GREEN affected regressions; run TypeScript. Record source/state races and precise evidence.

### Task 5: Public Verify page with local file processing

**Files:** Create `app/verify/page.tsx`, `components/receipts/VerifyReceipt.tsx`, `features/receipts/useReceiptVerification.ts`; modify AppShell only to reuse a public payment-style shell if needed. Create `web/test/VerifyReceipt.test.tsx`, `receiptPrivacy.test.ts`, `authRoutes.test.ts`; extend existing `AppShell.test.tsx`.

**Interfaces:**
- Hook `useReceiptVerification(load:LoadReceiptSnapshot = api.receipts.chainSnapshot.query)` returns `{busy:boolean,bundle:ReceiptBundle|null,result:ReceiptVerificationResult|null,loadFile:(file:File)=>Promise<void>,retry:()=>Promise<void>,clear:()=>void}`.
- Component owns accessible file input, status/result/details, Retry, and Remove. It consumes the hook and imports no account/unlock/signing logic.

- [ ] RED actual component test uploads a real fixture file and sees the matching public query and green result. Repeat with a second file while the first query remains pending; resolving the first query cannot replace the second result.

```tsx
const f = await makeReceiptFixture();
const user = userEvent.setup();
render(<VerifyReceipt />);
await user.upload(screen.getByLabelText('Receipt JSON'),new File([JSON.stringify(f.v2)],'receipt.json',{type:'application/json'}));
await screen.findByText('Verified on chain');
expect(publicQuery).toHaveBeenCalledWith({pool:f.pool.scope,blockNumber:100,blockHash:f.v2.anchor.blockHash});
```

`publicQuery` is the test's mock of `api.receipts.chainSnapshot.query`; it returns Task 1's available snapshot. Helpers render the actual component with controlled transport, not a duplicate verifier UI.
- [ ] Run `pnpm test -- test/VerifyReceipt.test.tsx test/receiptPrivacy.test.ts test/AppShell.test.tsx --maxWorkers=2` to RED.
- [ ] Implement size check before `file.text()`, parser before math/RPC, and generation-id guards before/after each awaited stage. Retry increments generation id; Remove invalidates and clears file input, bundle, result, and filename. Busy verification permits selecting a replacement or canceling. Do not auto-query unsupported files or display untrusted HTML.

```ts
const at = ++generation.current;
if (file.size > 65_536) { setInvalid('File is too large. Use a receipt JSON under 64 KiB.'); return; }
const text = await file.text();
if (generation.current !== at) return;
const parsed = parseReceiptJson(text);
if (parsed.status !== 'parsed') {
  setBundle(null);
  setResult(parsed.status === 'invalid'
    ? {status:'invalid',local:'failed',chain:'not-run',reason:parsed.reason}
    : {status:'unavailable',local:'not-run',chain:'unavailable',reason:parsed.reason});
  setBusy(false); return;
}
setBundle(parsed.bundle);
const result = await verifyReceipt(parsed.bundle,parsed.pool,load,()=>generation.current===at);
if (generation.current !== at) return;
setResult(result); setBusy(false);
```

The `setInvalid` branch is a hook-local setter that writes `{status:'invalid',local:'failed',chain:'not-run',reason}` and clears old bundle/results; it is not an undefined external helper. Never print raw parsing/transport exceptions or include payloads in toasts.
- [ ] Use existing product typography/components and visible inline statuses, `aria-live`, associated input label, keyboard navigation, responsive fingerprint wrapping, and expand/collapse technical details. Include testnet badge and "Provided by receipt issuer" next to username; call disclosedAt "Receipt generated".
- [ ] Keep `/verify` outside protected/auth-only path lists. Root auth providers may exist, but the page must render/file-check when Privy is unready or signed out, and neither require nor open login/unlock. Do not restructure root providers solely for this page.
- [ ] Privacy tests spy on query arguments, console/error logging, local/session storage and IndexedDB writes involving file fields. Deliberately include sensitive marker text in malformed input and ensure it appears nowhere in requests/logs/errors/storage. Test unknown scope/RPC URL keys, invalid math no-query, v1 no-query/unavailable, retry after RPC error, and Remove clearing displayed private values.
- [ ] GREEN UI/privacy/shell/auth tests and TypeScript. Browser inspection must use actual page/components; describe controlled transport honestly.

### Task 6: Real historical roots, regression, build, and documentation

**Files:** Create `contracts/test/receiptAnchors.test.ts`; reuse `contracts/test/helpers/poolFixture.ts` unchanged unless a narrowly tested helper is required. Create `docs/receipt-verification.md`; update docs listed in the map. Complete ignored inline ledger and a public-only verification report in `docs/receipt-verification.md`.

**Interfaces:** Consumes deployed fixture `pool.read.currentRoot`, `nextIndex`, `token`, `isKnownRoot`, `depositOwnedNote`, `makeTransferProof`, `output`, and `H` from existing contract helpers. No new production interface.

- [ ] Write a local real-proof test with two pools: deposit a genuine note in AUSD, record its block/hash/root/count, advance the AUSD root more than 30 times through unique valid deposits, and read the original root/count at the historical block. Use existing browser wasm/zkeys, not bypass verifiers or storage mutations.

```ts
const f = await deployPoolFixture({name:'Agora USD',symbol:'AUSD'});
const first = await depositOwnedNote(f,{amount:20_000_000n,ownerSecret:1001n,salt:1n});
const anchoredBlock = (await f.publicClient.getBlock({blockTag:'latest'})).number;
const oldRoot = await f.pool.read.currentRoot();
const abi = (await hre.artifacts.readArtifact('MaweePool')).abi;
for (let i=0;i<31;i++) await depositOwnedNote(f,{amount:1_000_000n,ownerSecret:1001n,salt:BigInt(i+2)});
expect(await f.pool.read.isKnownRoot([oldRoot])).to.equal(false);
expect(await f.publicClient.readContract({address:f.pool.address,abi,functionName:'currentRoot',blockNumber:anchoredBlock})).to.equal(oldRoot);
expect(await f.publicClient.readContract({address:f.pool.address,abi,functionName:'nextIndex',blockNumber:anchoredBlock})).to.equal(1);
expect(await f.pool.read.isCommitmentInserted([b32(first.commitment)])).to.equal(true);
```

Use explicit `publicClient.readContract` for historical calls to avoid confusing contract ABI arguments with read options. Add pool-B root mismatch and a later real transfer spending the first note; the historical inclusion still matches after spending. `makeTransferProof`/`output` are existing helpers, and historical root for inclusion need not remain a spendable recent root.
- [ ] Run `pnpm exec hardhat test test/receiptAnchors.test.ts` in `contracts/`, then the full contract suite. Confirm initial RED/meaningful assertion failure if a production behavior under test changes; this evidence test may already pass because historical contract reads already exist. Record that distinction instead of inventing a RED claim.
- [ ] Run focused receipt suites plus disclosure/PDF/multiasset/recovery/auth regressions, then full `pnpm test -- --maxWorkers=2` in `web/`. Run `pnpm exec tsc --noEmit` and scoped `pnpm exec biome check` on all changed source/test files. Address real errors; distinguish existing warnings from new ones.
- [ ] Run root `pnpm build:local`; smoke root/public `/verify` and public chainSnapshot without auth. Protected request APIs remain 401. Run the normal local production server on a free localhost port using the existing runner. Record build exit and HTTP results; do not claim standalone Windows packaging from this build.
- [ ] Browser desktop 1280×900 and mobile 390×844: actual `/verify` upload, result, technical details, long fingerprint wrapping, replacement while pending, retry, remove, v1 unavailable, and unauthenticated behavior. Export dialog with controlled account/transport is separate evidence unless a real auth session is supplied. Any fixture is ignored scratch code, never a production bypass.
- [ ] Record actual chain-provider historical compatibility via read-only known-scope query where configured; never deploy/fund/change live flags to satisfy a test. Failure to read archive data remains an explicit prerequisite/limitation.
- [ ] Self-review spec coverage and the five Review Focus tests. Request one fresh read-only whole-feature review per inline execution skill; if unavailable, disclose that and do not claim independent review. Apply justified fixes with regression evidence.
- [ ] Inspect staged/unstaged/untracked files and diff whitespace; update docs with how to export/upload, meaning of statuses/fingerprint, v1 reissue, public-only API fields, RPC archive requirements, legacy/multiasset behavior, and exact verification boundaries. Retain local source; do not commit/push/PR without a fresh delivery request.

## Shared-interface preflight and coverage

| Requirement | Owning tasks |
| --- | --- |
| Strict v1/v2 schema, scalar/index/aliases, deterministic identity | 1 |
| Public historical root/count/token/canonical hash and limits | 2 |
| No false chain badge, unsupported/offline distinctions | 3, 5 |
| Watermark preservation, note leaf check, export races | 4 |
| Same PDF/JSON identity and truthful issuer/time/asset copy | 1, 4 |
| Anonymous browser flow and proof privacy | 2, 5 |
| Legacy, spent notes, root-ring expiry, cross-pool proof | 3, 6 |
| Regression, Windows build, browser evidence and docs | 6 |

Before execution resolve all imports/signatures against the installed code. Notable
shared constraints: compareReceiptSnapshot takes identity as a fourth argument;
chain input hash is optional for preparation and provided for verification;
real scans carry optional-typed snapshot metadata, and recovery must preserve it;
v1 builder/math wrappers do not become chain-certification APIs.

Plan self-review: every approved spec requirement maps to a task, fixture builders
and reader ports are defined before their consumers, five Review Focus cases have
explicit tests, and chain/file failure semantics share one comparison layer. No
new dependencies, hidden server proof upload, event-history scan, identity claim,
or live/remote delivery action is included. The execution preference remains inline;
review this written plan before implementation.
