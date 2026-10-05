import {beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({events:[] as string[],result:"confirmed",simulateFail:false}));
const HASH=`0x${"11".repeat(32)}` as const;
vi.mock("../src/server/lib/durableRelayer",()=>({runtimeSender:async()=>({sender:{
  prepare:async()=>{state.events.push("persist");return {txHash:`0x${"11".repeat(32)}`};},
  broadcast:async()=>{state.events.push("raw-broadcast");},
  reconcile:async()=>{state.events.push("reconcile");return {state:state.result,txHash:`0x${"11".repeat(32)}`,receipt:{status:state.result==="confirmed"?"success":"reverted"}};},
}})}));
vi.mock("viem",async(original)=>{
  const actual=await original<typeof import("viem")>();
  return {...actual,createPublicClient:()=>({
    simulateContract:async()=>{state.events.push("simulate");if(state.simulateFail)throw Error("InvalidProof");return {request:{}};},
    waitForTransactionReceipt:async()=>{state.events.push("receipt");return {status:"success",transactionHash:`0x${"11".repeat(32)}`};},
  }),createWalletClient:()=>({writeContract:async()=>{throw Error("Unsigned broadcast bypassed the durable journal");}})};
});
import {maweePoolAbi} from "../src/lib/abi";
import {relayWrite} from "../src/server/lib/relayer";
const request={address:"0x2222222222222222222222222222222222222222" as const,abi:maweePoolAbi,functionName:"withdraw" as const,args:["0x3333333333333333333333333333333333333333",1n,HASH,HASH,{a:[1n,2n],b:[[3n,4n],[5n,6n]],c:[7n,8n]}] as const};
beforeEach(()=>{state.events=[];state.result="confirmed";state.simulateFail=false;vi.stubEnv("RELAYER_PRIVATE_KEY",`0x${"11".repeat(32)}`);});
describe("ordinary relay shared durability",()=>{
  it("persists ordinary withdrawal sends before broadcasting",async()=>{
    expect((await relayWrite(request)).hash).toBe(HASH);
    expect(state.events).toEqual(["simulate","persist","raw-broadcast","receipt","reconcile"]);
  });
  it("does not reserve or send a reverting proof",async()=>{
    state.simulateFail=true;await expect(relayWrite(request)).rejects.toThrow("InvalidProof");
    expect(state.events).toEqual(["simulate"]);
  });
  it("does not report a reverted receipt as success",async()=>{
    state.result="reverted";await expect(relayWrite(request)).rejects.toThrow("reverted");
  });
});
