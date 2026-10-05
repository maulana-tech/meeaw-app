import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
const deps=vi.hoisted(()=>({requests:null as unknown,wallets:new Map<string,string>(),registry:new Map<string,unknown>(),pool:null as unknown}));
vi.mock("../src/server/db/mongo",()=>({getPaymentRequests:async()=>deps.requests}));
vi.mock("../src/server/modules/wallets/wallets.service",()=>({currentWallet:async(id:string)=>deps.wallets.has(id)?{address:deps.wallets.get(id)}:null}));
vi.mock("../src/server/modules/usernames/usernames.service",()=>({resolveUsername:async(name:string)=>deps.registry.get(name)??null}));
vi.mock("../src/lib/pools",()=>({requestPool:()=>deps.pool}));
import {openIsolatedRequestDb} from "./helpers/requestDb";
import {makeRequestFixture} from "./helpers/requestFixtures";
import {__resetRateLimit} from "../src/server/lib/rateLimit";
import {createRequest,getRequest,cancelRequest,declineRequest,enforceRequestLimit} from "../src/server/modules/requests/requests.service";
describe("participant-only request service",()=>{
  let db:Awaited<ReturnType<typeof openIsolatedRequestDb>>, fixture:Awaited<ReturnType<typeof makeRequestFixture>>;
  beforeAll(async()=>{db=await openIsolatedRequestDb();fixture=await makeRequestFixture();deps.requests=db.requests;},15000);
  afterAll(async()=>{await db?.close();});
  beforeEach(async()=>{
    await db.requests.deleteMany({});__resetRateLimit();deps.pool=fixture.pool;deps.wallets.clear();deps.registry.clear();
    for(const [id,p] of [["requester",fixture.record.requester],["payer",fixture.record.addressee]] as const){
      deps.wallets.set(id,p.wallet);deps.registry.set(p.username,{owner:p.wallet,notePubkeyHex:p.notePubkey,viewPubkeyHex:p.viewPubkey});
    }
  });
  it("stores a real wallet-signed request once and rejects changed retries",async()=>{
    const now=new Date(fixture.record.createdAt);
    const first=await createRequest("requester",fixture.record,now);
    expect(await createRequest("requester",fixture.record,now)).toEqual(first);
    expect(await db.requests.countDocuments()).toBe(1);
    await expect(createRequest("requester",{...fixture.record,createdAt:"2026-10-06T00:00:00.000Z"},now)).rejects.toThrow();
    await expect(createRequest("payer",fixture.record,now)).rejects.toThrow();
  });
  it("rejects key substitution and invalid signatures before storing",async()=>{
    const now=new Date(fixture.record.createdAt);
    await expect(createRequest("requester",{...fixture.record,signature:`0x${"11".repeat(65)}`},now)).rejects.toThrow();
    deps.registry.set("bob",{owner:fixture.record.requester.wallet,notePubkeyHex:fixture.record.requester.notePubkey,viewPubkeyHex:fixture.record.requester.viewPubkey});
    await expect(createRequest("requester",fixture.record,now)).rejects.toThrow();
    expect(await db.requests.countDocuments()).toBe(0);
  });
  it("restricts reading and terminal actions by actual wallet role",async()=>{
    await createRequest("requester",fixture.record,new Date(fixture.record.createdAt));
    await expect(getRequest("outsider",{id:fixture.record.id})).rejects.toThrow("Request not found");
    await expect(cancelRequest("payer",{id:fixture.record.id,revision:0})).rejects.toThrow();
    expect((await declineRequest("payer",{id:fixture.record.id,revision:0})).status).toBe("declined");
    await expect(cancelRequest("requester",{id:fixture.record.id,revision:1})).rejects.toThrow();
  });
  it("keeps bounded status polling separate from ordinary query limits",()=>{
    for(let i=0;i<120;i++)enforceRequestLimit("budget","query");
    expect(()=>enforceRequestLimit("budget","query")).toThrow();
    for(let i=0;i<480;i++)enforceRequestLimit("budget","paymentStatus");
    expect(()=>enforceRequestLimit("budget","paymentStatus")).toThrow();
  });

});
