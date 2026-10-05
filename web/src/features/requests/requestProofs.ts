import {fromBE,commitment,encryptNote,merkleProof,nullifier,ownerPk,randomFieldElement,toBE32,viewPubkey,hexToBytes} from "../../lib/crypto";
import {toHex} from "viem";
import type {Signer} from "../../lib/chain";
import type {LocalAccount,MyNote,ScanResult} from "../../lib/notes";
import {resolvePool} from "../../lib/pools";
import {proveMerge,proveTransfer,type EvmProof} from "../../lib/prover";
import {localParticipantKeys,openRequest} from "./requestCrypto";
import {submissionTypedData} from "./requestTypedData";
import type {Hex,NoteOutput,PaymentOperation,PoolDescriptor,RequestPayload,SignedRequest,SignedSubmission,SubmissionBody} from "./types";

export function signedRecordOf(r:SignedRequest):SignedRequest{return {version:r.version,id:r.id,pool:r.pool,requester:r.requester,addressee:r.addressee,createdAt:r.createdAt,recipientCommitment:r.recipientCommitment,requesterEnvelope:r.requesterEnvelope,addresseeEnvelope:r.addresseeEnvelope,signature:r.signature};}
type Context={record:SignedRequest;operation:PaymentOperation;account:LocalAccount;scan:ScanResult;signer:Signer;artifactRoot?:string;pool?:PoolDescriptor};
async function assertContext(c:Context){
  const keys=await localParticipantKeys(c.account);
  if(c.scan.scope!==c.record.pool||c.operation.pool!==c.record.pool||c.operation.requestId!==c.record.id||c.signer.address.toLowerCase()!==c.record.addressee.wallet.toLowerCase()||keys.notePubkey.toLowerCase()!==c.record.addressee.notePubkey.toLowerCase()||keys.viewPubkey.toLowerCase()!==c.record.addressee.viewPubkey.toLowerCase())throw new Error("Unlock the account this request was sent to.");
}
function owned(c:Context,index:number){
  const n=c.scan.notes.find(n=>n.scope===c.record.pool&&n.leafIndex===index&&!n.spent&&n.amount>0n);if(!n)throw new Error("This payment balance changed. Refresh and try again.");return n;
}
function proofWire(p:EvmProof){return {a:p.a.map(String) as [string,string],b:p.b.map(row=>row.map(String)) as [[string,string],[string,string]],c:p.c.map(String) as [string,string]};}
async function output(amount:bigint,pk:bigint,view:Uint8Array,salt:bigint):Promise<NoteOutput>{
  const encrypted=encryptNote(view,amount,salt);
  return {commitment:toHex(toBE32(await commitment(amount,pk,salt))),ephemeralPk:toHex(encrypted.ephemeralPk),ciphertext:toHex(encrypted.ciphertext)};
}
async function sign(c:Context,body:SubmissionBody):Promise<SignedSubmission>{
  return {...body,signature:await c.signer.walletClient.signTypedData({account:c.signer.walletClient.account??c.signer.address,...submissionTypedData(body)})};
}
function bodyBase(c:Context){return {version:1 as const,requestId:c.record.id,operationId:c.operation.id,step:c.operation.nextStep,pool:c.record.pool};}
export async function buildMergeSubmission(c:Context & {inputIndices:readonly [number,number]}):Promise<SignedSubmission>{
  await assertContext(c);if(c.inputIndices[0]===c.inputIndices[1])throw new Error("Choose distinct notes.");
  const a=owned(c,c.inputIndices[0]),b=owned(c,c.inputIndices[1]),sum=a.amount+b.amount;
  if(sum>(1n<<64n)-1n)throw new Error("Split this balance before combining it.");
  const pk=await ownerPk(c.account.ownerSecret),salt=randomFieldElement();
  const paths=await Promise.all([merkleProof(c.scan.leaves,a.leafIndex,20),merkleProof(c.scan.leaves,b.leafIndex,20)]);
  const nfs=await Promise.all([nullifier(c.account.ownerSecret,a.leafIndex),nullifier(c.account.ownerSecret,b.leafIndex)]);
  const o=await output(sum,pk,viewPubkey(c.account.viewSk),salt);
  const p=await proveMerge({root:String(paths[0].root),nullifierA:String(nfs[0]),nullifierB:String(nfs[1]),outCommitment:String(fromBE(hexToBytes(o.commitment))),ownerSecret:String(c.account.ownerSecret),amounts:[String(a.amount),String(b.amount)],salts:[String(a.salt),String(b.salt)],pathElements:[paths[0].pathElements.map(String),paths[1].pathElements.map(String)],pathIndices:[paths[0].pathIndices,paths[1].pathIndices],outSalt:String(salt)},c.artifactRoot);
  return sign(c,{...bodyBase(c),kind:"merge",root:toHex(toBE32(paths[0].root)),nullifiers:nfs.map(n=>toHex(toBE32(n))),proof:proofWire(p.proof),outputs:[o]});
}
async function transfer(c:Context,inputIndex:number,amount:bigint,recipientPk:bigint,recipientView:Uint8Array,recipientSalt:bigint,kind:"split"|"payment"){
  await assertContext(c);const n=owned(c,inputIndex);
  if(amount<=0n||amount>n.amount)throw new Error("Your private balance is too low.");
  const pk=await ownerPk(c.account.ownerSecret),changeSalt=randomFieldElement(),mp=await merkleProof(c.scan.leaves,n.leafIndex,20),nf=await nullifier(c.account.ownerSecret,n.leafIndex);
  const recipient=await output(amount,recipientPk,recipientView,recipientSalt),change=await output(n.amount-amount,pk,viewPubkey(c.account.viewSk),changeSalt);
  const p=await proveTransfer({root:String(mp.root),nullifier:String(nf),outCommitmentRecipient:String(fromBE(hexToBytes(recipient.commitment))),outCommitmentChange:String(fromBE(hexToBytes(change.commitment))),inAmount:String(n.amount),ownerSecret:String(c.account.ownerSecret),inSalt:String(n.salt),pathElements:mp.pathElements.map(String),pathIndices:mp.pathIndices,recipientPk:String(recipientPk),recipientAmount:String(amount),recipientSalt:String(recipientSalt),changeAmount:String(n.amount-amount),changeSalt:String(changeSalt)},c.artifactRoot);
  return sign(c,{...bodyBase(c),kind,root:toHex(toBE32(mp.root)),nullifiers:[toHex(toBE32(nf))],proof:proofWire(p.proof),outputs:[recipient,change]});
}
export async function buildPaymentSubmission(c:Context & {payload:RequestPayload;inputIndex:number}):Promise<SignedSubmission>{
  await assertContext(c);
  // Verify the payload against the signed record again before selecting its amount.
  const pool=c.pool??resolvePool(c.record.pool);
  const verified=await openRequest(signedRecordOf(c.record),c.account,pool);
  if(verified.amount!==c.payload.amount||verified.salt!==c.payload.salt||verified.metadata.id!==c.payload.metadata.id)throw new Error("This payment request changed.");
  return transfer(c,c.inputIndex,BigInt(verified.amount),fromBE(hexToBytes(c.record.requester.notePubkey)),hexToBytes(c.record.requester.viewPubkey),BigInt(verified.salt),"payment");
}
export async function buildSplitSubmission(c:Context & {inputIndex:number;splitAmount:bigint}){
  return transfer(c,c.inputIndex,c.splitAmount,await ownerPk(c.account.ownerSecret),viewPubkey(c.account.viewSk),randomFieldElement(),"split");
}
