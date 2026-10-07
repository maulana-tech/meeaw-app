import {describe,it,expect,vi} from "vitest";
import type {PoolDescriptor} from "../src/lib/pools";
const mock=vi.hoisted(()=>({pool:null as PoolDescriptor|null}));
vi.mock("../src/lib/pools",async original=>({...await original<typeof import("../src/lib/pools")>(),resolvePool:()=>mock.pool}));
import {makeReceiptFixture} from "./helpers/receiptFixtures";
import {prepareReceipt} from "../src/features/receipts/prepareReceipt";
import {renderDisclosurePdf} from "../src/lib/disclosurePdf";
import {receiptIdentity,canonicalReceiptJson} from "../src/features/receipts/receiptIdentity";
import {writeFile,mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
describe("anchored receipt export",()=>{
 it("prints the same full fingerprint as JSON without an identity claim",async()=>{const f=await makeReceiptFixture(),identity=await receiptIdentity(f.v2),pdf=await renderDisclosurePdf(f.v2,{verifyUrl:"http://127.0.0.1:4332/verify",verifiedAtExport:true});const raw=pdf.output();expect(raw).toContain(identity.fingerprint);expect(raw).toContain(identity.reference);expect(raw).toContain("20 AUSD");expect(raw).not.toContain("Verified by Mawee");expect(raw).not.toContain("verified ledger root");expect(raw).toContain("confirmed at export");expect(JSON.parse(canonicalReceiptJson(f.v2))).toEqual(f.v2);if(process.env.RECEIPT_WRITE_EVIDENCE==="1"){const dir=new URL("../../.superpowers/sdd/2026-10-06-receipt-verification/",import.meta.url);await mkdir(fileURLToPath(dir),{recursive:true});await writeFile(fileURLToPath(new URL("receipt.pdf",dir)),new Uint8Array(pdf.output("arraybuffer")));}});
 it("prepares a matched receipt at the exact mirrored block",async()=>{const f=await makeReceiptFixture();mock.pool=f.pool;const load=vi.fn().mockResolvedValue({status:"available",snapshot:f.snapshot});const b=await prepareReceipt({acct:f.account,scan:f.scan,note:f.scan.notes[0],username:"alice",load});expect(b.version).toBe(2);expect(b.anchor).toEqual(f.v2.anchor);expect(load).toHaveBeenCalledTimes(1);expect(load).toHaveBeenCalledWith({pool:f.pool.scope,blockNumber:100});});
 it("refuses unchecked leaves, incomplete watermarks, stale scans, and changed sessions",async()=>{const f=await makeReceiptFixture();mock.pool=f.pool;const load=vi.fn().mockResolvedValue({status:"available",snapshot:f.snapshot});for(const scan of [{...f.scan,leaves:[123n]},{...f.scan,snapshot:undefined},{...f.scan,health:"stale" as const},{...f.scan,snapshot:{blockNumber:100,leafCount:2}}])await expect(prepareReceipt({acct:f.account,scan,note:f.scan.notes[0],load})).rejects.toThrow(/receipt/i);await expect(prepareReceipt({acct:f.account,scan:f.scan,note:f.scan.notes[0],load,isCurrent:()=>false})).rejects.toThrow(/receipt/i);});
});
