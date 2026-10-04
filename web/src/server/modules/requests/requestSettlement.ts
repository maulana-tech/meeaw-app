import "server-only";
import {encodeFunctionData,parseEventLogs,type Hex,type TransactionReceipt} from "viem";
import {maweePoolAbi} from "../../../lib/abi";
import type {PoolDescriptor,SignedSubmission} from "../../../features/requests/types";

function proof(s:SignedSubmission){return {a:[BigInt(s.proof.a[0]),BigInt(s.proof.a[1])] as [bigint,bigint],b:[[BigInt(s.proof.b[0][0]),BigInt(s.proof.b[0][1])],[BigInt(s.proof.b[1][0]),BigInt(s.proof.b[1][1])]] as [[bigint,bigint],[bigint,bigint]],c:[BigInt(s.proof.c[0]),BigInt(s.proof.c[1])] as [bigint,bigint]};}
export function encodeSubmission(s:SignedSubmission):Hex{
  if(s.kind==="merge"){
    if(s.nullifiers.length!==2||s.outputs.length!==1)throw new Error("Invalid merge shape.");
    return encodeFunctionData({abi:maweePoolAbi,functionName:"merge",args:[s.root,s.nullifiers[0],s.nullifiers[1],proof(s),s.outputs[0]]});
  }
  if(s.nullifiers.length!==1||s.outputs.length!==2)throw new Error("Invalid transfer shape.");
  return encodeFunctionData({abi:maweePoolAbi,functionName:"transfer",args:[s.root,s.nullifiers[0],proof(s),s.outputs[0],s.outputs[1]]});
}
const same=(a:string|null|undefined,b:string)=>a?.toLowerCase()===b.toLowerCase();
export function verifyRequestReceipt(input:{pool:PoolDescriptor;submission:SignedSubmission;transaction:{hash:Hex;to:Hex|null;input:Hex};receipt:TransactionReceipt;confirmations:number;requestCommitment:Hex}):{valid:boolean;leafIndex:number|null;reason:string|null}{
  const {pool,submission:s,transaction:tx,receipt:r}=input;
  const bad=()=>({valid:false,leafIndex:null,reason:"Payment evidence does not match this operation."});
  try{
    if(s.pool!==pool.scope||!same(tx.to,pool.address)||!same(r.to,pool.address)||r.status!=="success"||!same(r.transactionHash,tx.hash)||input.confirmations<pool.confirmations||!same(tx.input,encodeSubmission(s)))return bad();
    if(s.kind==="payment"&&!same(s.outputs[0].commitment,input.requestCommitment))return bad();
    const logs=r.logs.filter(l=>same(l.address,pool.address)&&!l.removed);
    const deposits=parseEventLogs({abi:maweePoolAbi,eventName:"Deposit",logs});
    const spends=parseEventLogs({abi:maweePoolAbi,eventName:"Spend",logs});
    if(deposits.length!==s.outputs.length||spends.length!==s.nullifiers.length)return bad();
    for(let i=0;i<s.outputs.length;i++){
      const e=deposits[i].args,o=s.outputs[i];
      if(!same(e.commitment,o.commitment)||!same(e.ephemeralPk,o.ephemeralPk)||!same(e.ciphertext,o.ciphertext))return bad();
    }
    for(let i=0;i<s.nullifiers.length;i++)if(!same(spends[i].args.nullifier,s.nullifiers[i]))return bad();
    return {valid:true,leafIndex:Number(deposits[0].args.leafIndex),reason:null};
  }catch{return bad();}
}
