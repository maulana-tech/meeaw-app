import {describe,expect,it} from "vitest";
import {selectFunding,nextFundingAction} from "../src/features/requests/selectFunding";
import {testPool} from "./helpers/requestFixtures";
import type {MyNote} from "../src/lib/notes";
const note=(amount:bigint,index:number,scope=testPool.scope):MyNote=>({amount,leafIndex:index,scope,salt:BigInt(index+1),spent:false});
describe("private request funding",()=>{
  it("selects one covering note and otherwise uses multiple positive notes",()=>{
    expect(selectFunding([note(10n,0),note(25n,1)],20n,testPool.scope).map(n=>n.leafIndex)).toEqual([1]);
    expect(selectFunding([note(10n,0),note(15n,1)],20n,testPool.scope).map(n=>n.amount)).toEqual([15n,10n]);
    expect(()=>selectFunding([note(0n,0),{...note(100n,1),spent:true}],20n,testPool.scope)).toThrow();
  });
  it("keeps identical leaf indices in different pools separate",()=>{
    expect(()=>selectFunding([note(100n,0,"31337:0x2222222222222222222222222222222222222222")],20n,testPool.scope)).toThrow();
  });
  it("self-splits only the needed contribution when a merge would overflow",()=>{
    const action=nextFundingAction([note(12_000_000_000_000_000_000n,0),note(12_000_000_000_000_000_000n,1)],15_000_000_000_000_000_000n,testPool.scope);
    expect(action).toMatchObject({kind:"split",inputIndex:1,amount:3_000_000_000_000_000_000n});
  });
});
