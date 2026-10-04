import {afterAll,beforeAll,beforeEach,describe,expect,it} from "vitest";
import {openIsolatedRequestDb} from "./helpers/requestDb";
import {RelayJournal,RelayBusyError} from "../src/server/lib/relayJournal";
describe("durable relay nonce journal",()=>{
  let db:Awaited<ReturnType<typeof openIsolatedRequestDb>>,journal:RelayJournal;
  const wallet="31337:0x1111111111111111111111111111111111111111";
  const digest=`0x${"22".repeat(32)}` as const;
  beforeAll(async()=>{db=await openIsolatedRequestDb();journal=new RelayJournal(db.db);},15000);
  beforeEach(async()=>{await db.db.collection("relay_wallets").deleteMany({});await db.db.collection("relay_sends").deleteMany({});});
  afterAll(async()=>{await db?.close();});
  it("allows one process to claim a wallet nonce and fences stale signers",async()=>{
    const a=new RelayJournal(db.db),b=new RelayJournal(db.db);
    const results=await Promise.allSettled([a.claim(wallet,"a",digest,0),b.claim(wallet,"b",digest,0)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const claimed=results.find(r=>r.status==="fulfilled");if(claimed?.status!=="fulfilled")throw Error("No reservation");
    await expect(journal.persistSigned({...claimed.value,fence:claimed.value.fence+1,serializedTransaction:"0x1234",txHash:digest})).rejects.toBeInstanceOf(RelayBusyError);
  });
  it("cannot age a signed transaction out into a different send",async()=>{
    const now=new Date(0),claim=await journal.claim(wallet,"a",digest,0,now);
    await journal.persistSigned({...claim,serializedTransaction:"0x1234",txHash:digest});
    await expect(journal.claim(wallet,"b",digest,0,new Date(1_000_000))).rejects.toBeInstanceOf(RelayBusyError);
    const recovered=await new RelayJournal(db.db).read(wallet,"a");
    expect(recovered?.serializedTransaction).toBe("0x1234");
  });
});
