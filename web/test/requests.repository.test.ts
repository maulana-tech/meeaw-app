import { afterAll,beforeAll,beforeEach,describe,expect,it } from "vitest";
import { openIsolatedRequestDb } from "./helpers/requestDb";
import { wireRequestFixture } from "./helpers/requestFixtures";
import { requestDigest } from "../src/features/requests/requestTypedData";
import { countPendingReceived,decodeCursor,findForParticipant,insertRequest,listForWallet,terminateRequest,toRequestDoc } from "../src/server/modules/requests/requests.repository";
describe("request repository with standalone MongoDB",()=>{
  let testDb:Awaited<ReturnType<typeof openIsolatedRequestDb>>;
  const record=wireRequestFixture();
  beforeAll(async()=>{testDb=await openIsolatedRequestDb();},15000);
  afterAll(async()=>{await testDb?.close();});
  beforeEach(async()=>{await testDb.requests.deleteMany({});});
  it("paginates equal timestamps without skipping records and counts outside the page",async()=>{
    for(let i=0;i<23;i++) {
      const r={...record,id:`00000000-0000-4000-8000-${i.toString(16).padStart(12,"0")}`,recipientCommitment:`0x${(i+1).toString(16).padStart(64,"0")}` as const};
      await insertRequest(testDb.requests,toRequestDoc(r,requestDigest(r),new Date()));
    }
    const first=await listForWallet(testDb.requests,"received",record.addressee.wallet,null);
    const second=await listForWallet(testDb.requests,"received",record.addressee.wallet,first.nextCursor);
    expect(first.items).toHaveLength(20);expect(second.items).toHaveLength(3);
    expect(new Set([...first.items,...second.items].map(r=>r.id)).size).toBe(23);
    expect(await countPendingReceived(testDb.requests,record.addressee.wallet)).toBe(23);
    expect(await listForWallet(testDb.requests,"received",record.requester.wallet,null)).toEqual({items:[],nextCursor:null});
  });
  it("authorizes participant reads and permits only one terminal CAS",async()=>{
    await insertRequest(testDb.requests,toRequestDoc(record,requestDigest(record),new Date()));
    expect(await findForParticipant(testDb.requests,record.id,"0x4444444444444444444444444444444444444444")).toBeNull();
    const results=await Promise.all([
      terminateRequest(testDb.requests,{id:record.id,revision:0,wallet:record.requester.wallet,to:"cancelled",now:new Date()}),
      terminateRequest(testDb.requests,{id:record.id,revision:0,wallet:record.addressee.wallet,to:"declined",now:new Date()}),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await testDb.requests.findOne({_id:record.id}))?.revision).toBe(1);
  });
  it("does not terminate a reserved request or persist plaintext fields",async()=>{
    const doc=toRequestDoc(record,requestDigest(record),new Date());doc.operationId=record.id;
    await insertRequest(testDb.requests,doc);
    expect(await terminateRequest(testDb.requests,{id:record.id,revision:0,wallet:record.requester.wallet,to:"cancelled",now:new Date()})).toBeNull();
    const stored=await testDb.requests.findOne({_id:record.id});
    for(const key of ["amount","note","salt","payload"]) expect(stored).not.toHaveProperty(key);
    expect(decodeCursor("a".repeat(201))).toBeNull();
  });
});
