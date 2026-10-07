import {describe,it,expect} from "vitest";
import {makeReceiptFixture} from "./helpers/receiptFixtures";
import {parseReceiptJson} from "../src/features/receipts/receiptSchema";
import {verifyReceiptMath} from "../src/features/receipts/receiptProof";
import {receiptIdentity,canonicalReceiptJson} from "../src/features/receipts/receiptIdentity";
import {SNARK_FIELD} from "../src/features/requests/validation";
import {verifyDisclosure} from "../src/lib/disclosure";
describe("receipt local validation",()=>{
 it("validates genuine crypto and refuses misleading shape and metadata",async()=>{
  const f=await makeReceiptFixture(),parse=(changes:object={})=>parseReceiptJson(JSON.stringify({...f.v2,...changes}),s=>s===f.pool.scope?f.pool:null);
  expect(parse().status).toBe("parsed");expect((await verifyReceiptMath(f.v2)).valid).toBe(true);
  for(const change of [{leafIndex:1},{amountLabel:"200"},{asset:"USDC"},{commitmentHex:"00".repeat(32)},{rootHex:"00".repeat(32)},{pathIndices:[2,...f.v2.pathIndices.slice(1)]},{pathElements:[SNARK_FIELD.toString(),...f.v2.pathElements.slice(1)]},{amount:"18446744073709551616"},{ownerPk:"9".repeat(79)},{rpcUrl:"https://evil.test"}])expect(parse(change).status).toBe("invalid");
  expect(parseReceiptJson(" ".repeat(65_537)).status).toBe("invalid");
  expect(parse({version:3}).status).toBe("unsupported");expect(parseReceiptJson(JSON.stringify(f.v2),()=>null).status).toBe("unsupported");
  expect((await verifyReceiptMath({...f.v2,salt:"8"})).valid).toBe(false);
  expect((await verifyReceiptMath({...f.v2,leafIndex:1})).valid).toBe(false);
  expect((await verifyDisclosure({...f.v1,leafIndex:1})).valid).toBe(false);
 });
 it("normalizes serialized identity but covers issuer and anchor metadata",async()=>{
  const f=await makeReceiptFixture(),resolve=()=>f.pool;
  const parsed=parseReceiptJson(JSON.stringify({...f.v2,amount:"020000000",salt:"007"}),resolve);
  expect(parsed.status).toBe("parsed");if(parsed.status!=="parsed")throw Error("parse");
  expect(await receiptIdentity(parsed.bundle)).toEqual(await receiptIdentity(f.v2));
  expect(await receiptIdentity({...f.v2,username:"bob"})).not.toEqual(await receiptIdentity(f.v2));
  expect(JSON.parse(canonicalReceiptJson(f.v2))).toEqual(f.v2);
 });
 it("imports old USDC metadata and detects mathematical tampering",async()=>{
  const f=await makeReceiptFixture("USDC"),{asset,tokenDecimals,...old}=f.v1;
  const parsed=parseReceiptJson(JSON.stringify(old),()=>f.pool);expect(parsed.status).toBe("parsed");
  expect((await verifyReceiptMath({...f.v1,pathElements:["1",...f.v1.pathElements.slice(1)]})).valid).toBe(false);
 });
});
