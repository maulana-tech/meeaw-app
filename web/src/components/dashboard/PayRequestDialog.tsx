"use client";
import {ArrowRight,Loader,LockKeyhole} from "lucide-react";
import {fromBaseUnits} from "../../lib/crypto";
import {useWallet} from "../WalletProvider";
import type {PaymentOperation} from "../../features/requests/types";
import type {RequestRow} from "../../features/requests/hooks/useRequests";
import {useMyNotes} from "./useMyNotes";
import {findPool} from "../../lib/pools";
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from "../ui/dialog";
import {Button} from "../ui/button";
import {ToastFeedback} from "../ui/toast-feedback";
export function PayRequestDialog({request,open,onOpenChange,operation,working,error,onPay}:{request:RequestRow|null;open:boolean;onOpenChange:(open:boolean)=>void;operation:PaymentOperation|null;working:boolean;error:string|null;onPay:()=>Promise<unknown>}){
  const {address,accountUnlocked,promptUnlock}=useWallet();
  const record=request?.record??null,amount=request?.amount??null;
  const pool=record?findPool(record.pool):null;
  const notes=useMyNotes(address&&accountUnlocked&&pool?.role==="active"?address:undefined,pool??undefined);
  const balance=notes.claimable;
  const balanceReady=accountUnlocked&&Boolean(pool?.requestCapable)&&!notes.loading&&!notes.refreshing&&!notes.stale&&!notes.error&&notes.indexedAt!==null;
  const status=request?.record.status;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent appearance="linen" size="sm"><DialogHeader><DialogTitle>{status==="paid"?"Payment confirmed":"Pay this request"}</DialogTitle><DialogDescription>Review the payment before you confirm.</DialogDescription></DialogHeader>
    {request&&record&&amount!==null?<div className="grid gap-4"><div className="py-2 text-center"><p className="text-sm text-muted-foreground">Requested by @{record.requester.username}</p><p className="mt-3 font-heading text-4xl font-medium tabular-nums">{fromBaseUnits(amount)} <span className="text-base">USDC</span></p><p className="mx-auto mt-2 max-w-sm break-words text-sm text-muted-foreground">{request.note||"Payment request"}</p></div>
      <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm"><span className="text-muted-foreground">Pay from</span><span className="font-medium">Private Mawee balance</span></div>
      <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Available in this pool</span><span>{balanceReady?`${fromBaseUnits(balance)} USDC`:notes.loading||notes.refreshing?"Checking private balance…":pool?.role==="legacy"?"Previous pool balance":"Balance unavailable"}</span></div>
      {balanceReady&&balance<amount?<p className="text-sm text-muted-foreground">Add or receive at least {fromBaseUnits(amount-balance)} USDC in this pool before paying.</p>:null}
      {operation?<div className="flex items-center justify-center gap-3 rounded-xl bg-foreground/5 p-3 text-sm" role="status" aria-live="polite"><Loader className="size-4 animate-spin" aria-hidden="true"/>{operation.phase==="preparing"?`Preparing payment · ${operation.completedMerges} balance merge${operation.completedMerges===1?"":"s"} complete`:operation.phase==="confirmed"?"Payment confirmed on Monad":operation.phase==="failed"?"This attempt failed; your funds remain available":"Sending private payment…"}</div>:null}
      {record.operationId&&!operation?<div className="flex items-center justify-center gap-3 rounded-xl bg-foreground/5 p-3 text-sm" role="status" aria-live="polite"><Loader className="size-4 animate-spin" aria-hidden="true"/>Checking the existing private payment before allowing another attempt.</div>:null}
      {error?<ToastFeedback message={error} variant="error" toastId="request-pay-error"/>:null}
      {!accountUnlocked?<Button className="min-h-11" onClick={promptUnlock}>Unlock before paying</Button>:null}
      {accountUnlocked&&record.status==="pending"&&!record.operationId&&operation?.phase!=="submitted"&&operation?.phase!=="needsReconciliation"&&operation?.phase!=="submitting"&&operation?.phase!=="confirmed"?<Button className="min-h-11" disabled={working||!balanceReady||balance<amount||notes.error!==null} onClick={()=>void onPay()}>{working||notes.refreshing?<Loader className="size-4 animate-spin" aria-hidden="true"/>:null}{operation?.completedMerges?"Continue payment":`Pay ${fromBaseUnits(amount)} USDC`}<ArrowRight className="size-4" aria-hidden="true"/></Button>:null}
      {record.status==="pending"&&!accountUnlocked?<p className="flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="size-3.5"/>The balance and note are encrypted to your unlocked account.</p>:null}
    </div>:<p className="py-4 text-sm text-muted-foreground">This request could not be opened on this device.</p>}
  </DialogContent></Dialog>;
}
