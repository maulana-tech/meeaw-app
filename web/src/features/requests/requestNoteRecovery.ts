import {isSpent} from "../../lib/chain";
import {commitment,fromBE,hexToBytes,nullifier,ownerPk,toBE32} from "../../lib/crypto";
import type {LocalAccount,MyNote,ScanResult} from "../../lib/notes";
import {resolvePool} from "../../lib/pools";
import type {PaymentRequest,PoolDescriptor,RequestPayload,SignedRequest} from "./types";
import {api} from "../../trpc/client";
import {openRequest} from "./requestCrypto";
export async function recoverRequestNote(input:{record:SignedRequest;payload:RequestPayload;scan:ScanResult;account:LocalAccount;isSpent?:(nullifier:Uint8Array)=>Promise<boolean>}):Promise<MyNote|null>{
  const {record,payload,scan,account}=input;
  if(scan.scope!==record.pool||payload.metadata.id!==record.id)return null;
  const pk=await ownerPk(account.ownerSecret);if(pk!==fromBE(hexToBytes(record.requester.notePubkey)))return null;
  const amount=BigInt(payload.amount),salt=BigInt(payload.salt),comm=await commitment(amount,pk,salt);
  if(comm!==fromBE(hexToBytes(record.recipientCommitment)))return null;
  const index=scan.leaves.findIndex(c=>c===comm);if(index<0)return null;
  const nf=toBE32(await nullifier(account.ownerSecret,index));
  const spent=input.isSpent?await input.isSpent(nf):await isSpent(nf,resolvePool(record.pool));
  return {scope:scan.scope,leafIndex:index,amount,salt,spent,receivedAt:record.createdAt};
}

/** Restore paid request notes whose public Deposit event lost its ciphertext. */
export async function recoverPaidRequestOutputs(account:LocalAccount,pool:PoolDescriptor,scan:ScanResult,loadPage:(cursor:string|undefined)=>Promise<{items:PaymentRequest[];nextCursor:string|null}>=async cursor=>await api.requests.listSent.query(cursor?{cursor}:{}) as unknown as Promise<{items:PaymentRequest[];nextCursor:string|null}>,spent?: (nullifier:Uint8Array)=>Promise<boolean>):Promise<ScanResult>{
  if(scan.scope!==pool.scope)return scan;
  const recovered=new Map<number,MyNote>();let cursor:string|undefined,pages=0;
  do{
    const page=await loadPage(cursor);pages++;
    for(const row of page.items){
      const receipt=row.receipt;if(row.status!=="paid"||!receipt||row.pool!==pool.scope||scan.notes.some(n=>n.leafIndex===receipt.leafIndex))continue;
      const record:SignedRequest={version:row.version,id:row.id,pool:row.pool,requester:row.requester,addressee:row.addressee,createdAt:row.createdAt,recipientCommitment:row.recipientCommitment as `0x${string}`,requesterEnvelope:row.requesterEnvelope,addresseeEnvelope:row.addresseeEnvelope,signature:row.signature as `0x${string}`};
      try{const payload=await openRequest(record,account,pool);const note=await recoverRequestNote({record,payload,scan,account,isSpent:spent});if(note?.leafIndex===receipt.leafIndex)recovered.set(note.leafIndex,note);}catch{/* A note becomes spendable only after decryption and commitment checks. */}
    }
    cursor=page.nextCursor??undefined;if(cursor&&pages>=120)throw new Error("Payment history is still restoring. Try again shortly.");
  }while(cursor);
  if(!recovered.size)return scan;
  const notes=[...scan.notes,...recovered.values()].sort((a,b)=>a.leafIndex-b.leafIndex);
  return {...scan,notes,claimable:notes.filter(n=>!n.spent).reduce((sum,n)=>sum+n.amount,0n)};
}
