import {describe,expect,it,vi} from "vitest";
const mirror=vi.hoisted(()=>({value:null as unknown}));
vi.mock("../src/lib/poolMirror",()=>({loadPoolMirror:async()=>mirror.value,refreshPoolMirror:async()=>mirror.value}));
vi.mock("../src/lib/chain",()=>({isSpent:async()=>false}));
import {scanMyNotes} from "../src/lib/notes";
import {commitment,ownerPk,encryptNote,toBE32,viewPubkey} from "../src/lib/crypto";
import {testAccount,testPool} from "./helpers/requestFixtures";
describe("private note logging",()=>{
  it("never prints decrypted payment amounts during development scanning",async()=>{
    const account=testAccount(2),amount=20_000_000n,salt=42n;
    const encrypted=encryptNote(viewPubkey(account.viewSk),amount,salt);
    mirror.value={deposits:[{leafIndex:0,commitment:toBE32(await commitment(amount,await ownerPk(account.ownerSecret),salt)),...encrypted}],spentNullifiers:[],spentAtByNullifier:{},hydrated:true,indexedAt:new Date().toISOString(),health:"healthy"};
    const log=vi.spyOn(console,"info").mockImplementation(()=>{});
    try{expect((await scanMyNotes(account,{pool:testPool})).claimable).toBe(amount);expect(log.mock.calls.flat().join(" ")).not.toContain("20000000");}finally{log.mockRestore();}
  });
});
