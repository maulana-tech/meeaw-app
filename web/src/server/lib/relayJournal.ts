import "server-only";
import { type Db, MongoServerError } from "mongodb";
import type { Hex } from "viem";
import type { RelayIntent } from "./durableRelayer";

export class RelayBusyError extends Error {
  constructor(){super("The relayer is resolving another transaction. Try again shortly.");this.name="RelayBusyError";}
}
export class RelayConflictError extends Error {
  constructor(){super("This transaction attempt has changed.");this.name="RelayConflictError";}
}
export type RelaySend = {
  walletKey:string; operationKey:string; digest:Hex; fence:number; nonce:number;
  phase:"reserved"|"signed"|"unknown"|"confirmed"|"reverted";
  expiresAt:Date; serializedTransaction:Hex|null; txHash:Hex|null;
  intent:RelayIntent|null;
};
type WalletDoc={_id:string;fence:number;nextNonce:number;active:RelaySend|null};
type SendDoc=RelaySend & {_id:string};
const LEASE_MS=60_000;

/** Single-document fenced nonce coordinator. No replica-set transaction needed. */
export class RelayJournal {
  readonly wallets; readonly sends;
  constructor(db:Db){this.wallets=db.collection<WalletDoc>("relay_wallets");this.sends=db.collection<SendDoc>("relay_sends");}
  async active(walletKey:string){return (await this.wallets.findOne({_id:walletKey}))?.active??null;}
  async read(walletKey:string,operationKey:string):Promise<RelaySend|null>{
    const active=await this.active(walletKey);
    if(active?.operationKey===operationKey)return active;
    return this.sends.findOne({_id:`${walletKey}:${operationKey}`});
  }
  async claim(walletKey:string,operationKey:string,digest:Hex,nonce:number,now=new Date(),intent:RelayIntent|null=null):Promise<RelaySend>{
    try {await this.wallets.updateOne({_id:walletKey},{$setOnInsert:{fence:0,nextNonce:0,active:null}},{upsert:true});}
    catch(e){if(!(e instanceof MongoServerError && e.code===11000))throw e;}
    const wallet=await this.wallets.findOne({_id:walletKey});
    if(!wallet)throw new RelayBusyError();
    if(wallet.active && !(wallet.active.phase==="reserved" && wallet.active.expiresAt<=now))throw new RelayBusyError();
    const reservation:RelaySend={walletKey,operationKey,digest,fence:wallet.fence+1,nonce:Math.max(nonce,wallet.nextNonce??0),phase:"reserved",expiresAt:new Date(now.getTime()+LEASE_MS),serializedTransaction:null,txHash:null,intent};
    const claimed=await this.wallets.findOneAndUpdate({_id:walletKey,fence:wallet.fence},{$set:{active:reservation},$inc:{fence:1}},{returnDocument:"after",includeResultMetadata:false});
    if(!claimed?.active)throw new RelayBusyError();
    return claimed.active;
  }
  async persistSigned(send:RelaySend & {serializedTransaction:Hex;txHash:Hex}):Promise<RelaySend>{
    const signed={...send,phase:"signed" as const};
    const wallet=await this.wallets.findOneAndUpdate({_id:send.walletKey,fence:send.fence,"active.operationKey":send.operationKey,"active.phase":"reserved"},{$set:{active:signed}},{returnDocument:"after",includeResultMetadata:false});
    if(!wallet)throw new RelayBusyError();
    // The atomic active document is authoritative even if this projection fails.
    await this.sends.updateOne({_id:`${send.walletKey}:${send.operationKey}`},{$setOnInsert:signed},{upsert:true});
    return signed;
  }
  async uncertain(send:RelaySend){
    await this.wallets.updateOne({_id:send.walletKey,fence:send.fence,"active.operationKey":send.operationKey,"active.txHash":send.txHash},{$set:{"active.phase":"unknown"}});
  }
  async abandonUnsigned(send:RelaySend){
    await this.wallets.updateOne({_id:send.walletKey,fence:send.fence,"active.operationKey":send.operationKey,"active.phase":"reserved"},{$set:{active:null}});
  }
  async finish(send:RelaySend,phase:"confirmed"|"reverted"){
    // Save recoverable history before releasing the wallet for another nonce.
    await this.sends.updateOne({_id:`${send.walletKey}:${send.operationKey}`},{$set:{...send,phase}},{upsert:true});
    await this.wallets.updateOne({_id:send.walletKey,fence:send.fence,"active.operationKey":send.operationKey,"active.txHash":send.txHash},{$set:{active:null},$max:{nextNonce:send.nonce+1}});
  }
}
