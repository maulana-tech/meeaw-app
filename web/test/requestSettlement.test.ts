import {describe,expect,it} from "vitest";
import {encodeEventTopics,encodeAbiParameters,encodeFunctionData,type Hex,type TransactionReceipt} from "viem";
import {maweePoolAbi} from "../src/lib/abi";
import {verifyRequestReceipt,encodeSubmission} from "../src/server/modules/requests/requestSettlement";
import type {SignedSubmission} from "../src/features/requests/types";
import {testPool,wireRequestFixture} from "./helpers/requestFixtures";
const b32=(v:number)=>`0x${v.toString(16).padStart(64,"0")}` as Hex;
const record=wireRequestFixture();
const submission:SignedSubmission={version:1,requestId:record.id,operationId:record.id,step:0,pool:testPool.scope,kind:"payment",root:b32(1),nullifiers:[b32(2)],proof:{a:["1","2"],b:[["3","4"],["5","6"]],c:["7","8"]},outputs:[{commitment:record.recipientCommitment,ephemeralPk:b32(7),ciphertext:"0x1234"},{commitment:b32(5),ephemeralPk:b32(8),ciphertext:"0x5678"}],signature:record.signature};
function fixture(){
  const deposits=submission.outputs.map((o,i)=>({address:testPool.address,topics:encodeEventTopics({abi:maweePoolAbi,eventName:"Deposit",args:{leafIndex:i}}),data:encodeAbiParameters([{type:"bytes32"},{type:"bytes32"},{type:"bytes"}],[o.commitment,o.ephemeralPk,o.ciphertext]),removed:false}));
  const spend={address:testPool.address,topics:encodeEventTopics({abi:maweePoolAbi,eventName:"Spend",args:{nullifier:submission.nullifiers[0]}}),data:"0x",removed:false};
  const receipt={status:"success",transactionHash:b32(10),blockNumber:1n,to:testPool.address,logs:[...deposits,spend]} as TransactionReceipt;
  const transaction={hash:b32(10),to:testPool.address,input:encodeSubmission(submission)};
  return {pool:testPool,submission,transaction,receipt,confirmations:1,requestCommitment:record.recipientCommitment};
}
describe("exact request receipt verification",()=>{
  it("accepts only the tracked full transfer with matching Spend and encrypted output",()=>{
    expect(verifyRequestReceipt(fixture())).toMatchObject({valid:true,leafIndex:0});
  });
  it("rejects a direct deposit, a wrong pool, pending confirmations and missing Spend",()=>{
    const f=fixture();
    expect(verifyRequestReceipt({...f,transaction:{...f.transaction,input:encodeFunctionData({abi:maweePoolAbi,functionName:"deposit",args:[record.recipientCommitment,20n,{a:[1n,2n],b:[[3n,4n],[5n,6n]],c:[7n,8n]},b32(7),"0x1234"]})}}).valid).toBe(false);
    expect(verifyRequestReceipt({...f,transaction:{...f.transaction,to:b32(12).slice(0,42) as Hex}}).valid).toBe(false);
    expect(verifyRequestReceipt({...f,confirmations:0}).valid).toBe(false);
    expect(verifyRequestReceipt({...f,receipt:{...f.receipt,logs:f.receipt.logs.slice(0,2)}}).valid).toBe(false);
    expect(verifyRequestReceipt({...f,requestCommitment:b32(99)}).valid).toBe(false);
  });
  it("rejects reverted receipts and substituted pool outputs",()=>{
    const f=fixture();
    expect(verifyRequestReceipt({...f,receipt:{...f.receipt,status:"reverted"}}).valid).toBe(false);
    expect(verifyRequestReceipt({...f,receipt:{...f.receipt,to:b32(99).slice(0,42) as Hex}}).valid).toBe(false);
    const logs=[...f.receipt.logs];
    logs[0]={...logs[0],data:encodeAbiParameters([{type:"bytes32"},{type:"bytes32"},{type:"bytes"}],[f.submission.outputs[0].commitment,b32(99),"0xdead"])};
    expect(verifyRequestReceipt({...f,receipt:{...f.receipt,logs}}).valid).toBe(false);
  });
});
