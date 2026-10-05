import type {MyNote} from "../../lib/notes";
import type {PoolScope} from "./types";
const MAX64=(1n<<64n)-1n;
export function selectFunding(notes:readonly MyNote[],amount:bigint,scope:PoolScope):readonly MyNote[]{
  if(amount<=0n||amount>MAX64)throw new Error("Invalid payment amount.");
  const eligible=notes.filter(n=>n.scope===scope&&!n.spent&&n.amount>0n);
  const covering=eligible.filter(n=>n.amount>=amount).sort((a,b)=>a.amount===b.amount?a.leafIndex-b.leafIndex:a.amount<b.amount?-1:1);
  if(covering[0])return [covering[0]];
  const ordered=[...eligible].sort((a,b)=>a.amount===b.amount?a.leafIndex-b.leafIndex:a.amount>b.amount?-1:1);
  const result:MyNote[]=[];let total=0n;
  for(const n of ordered){result.push(n);total+=n.amount;if(total>=amount)return result;}
  throw new Error("Your private balance is too low.");
}
export type FundingAction={kind:"payment";inputIndex:number}|{kind:"merge";inputIndices:readonly [number,number]}|{kind:"split";inputIndex:number;amount:bigint};
export function nextFundingAction(notes:readonly MyNote[],amount:bigint,scope:PoolScope):FundingAction{
  const chosen=selectFunding(notes,amount,scope);
  if(chosen.length===1)return {kind:"payment",inputIndex:chosen[0].leafIndex};
  const [a,b]=chosen;
  if(a.amount+b.amount>MAX64)return {kind:"split",inputIndex:b.leafIndex,amount:amount-a.amount};
  return {kind:"merge",inputIndices:[a.leafIndex,b.leafIndex]};
}
