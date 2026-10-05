"use client";
import {type FormEvent,useState} from "react";
import {Loader} from "lucide-react";
import {useRouter} from "next/navigation";
import {useWallet} from "../WalletProvider";
import {Button} from "../ui/button";
import {Input} from "../ui/input";
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from "../ui/dialog";
import {useCreateRequest} from "../../features/requests/hooks/useCreateRequest";
import {requestPool} from "../../lib/pools";
import {parseRequestAmount,validateRequestNote} from "../../features/requests/validation";
import {REQUESTS_PATH} from "../../lib/auth-routes";
function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

export function CreateRequestDialog({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}){
  const [username,setUsername]=useState(""),[amount,setAmount]=useState(""),[note,setNote]=useState(""),[localError,setLocalError]=useState<string|null>(null);
  const {create,isCreating,error,clearError}=useCreateRequest(),router=useOptionalRouter(),wallet=useWallet();
  const poolEnabled=(()=>{try{return Boolean(requestPool());}catch{return false;}})();
  function reset(){setUsername("");setAmount("");setNote("");setLocalError(null);clearError();}
  function close(){if(isCreating)return;reset();onOpenChange(false);}
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setLocalError(null);clearError();
    try{
      validateRequestNote(note);
      if(!amount.trim())throw new Error("Enter an amount greater than zero.");
      const pool=requestPool();if(!pool)throw new Error("Private requests are not available for this pool yet.");parseRequestAmount(amount,pool.tokenDecimals);
      await create({username,amount,note});reset();onOpenChange(false);router?.push(REQUESTS_PATH);
    }catch(e){setLocalError(e instanceof Error?e.message:"Your request could not be created. Try again.");}
  }
  const message=localError??(error instanceof Error?error.message:null);
  return <Dialog open={open} onOpenChange={next=>next?onOpenChange(true):close()}><DialogContent appearance="linen" size="sm" showCloseButton={!isCreating}>
    <DialogHeader><DialogTitle>Request a payment</DialogTitle><DialogDescription>Ask another Mawee user to pay you privately.</DialogDescription></DialogHeader>
    {!poolEnabled?<p className="text-sm text-muted-foreground">Private requests are not enabled for this pool yet.</p>:!wallet.accountUnlocked?<div className="grid gap-4"><p>Unlock your account to create a private request.</p><Button onClick={wallet.promptUnlock}>Unlock Mawee</Button></div>:<form className="grid gap-3" onSubmit={submit}>
      <label className="grid gap-2 text-sm font-medium" htmlFor="request-username">Request from<Input appearance="linen" id="request-username" name="username" placeholder="@username" autoComplete="off" autoCapitalize="none" required maxLength={33} value={username} onChange={e=>setUsername(e.target.value)}/></label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="request-amount">Amount · USDC<Input appearance="linen" id="request-amount" name="amount" type="text" inputMode="decimal" placeholder="0.00" autoComplete="off" required value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <label className="grid gap-2 text-sm font-medium" htmlFor="request-note">Note <span className="font-normal text-muted-foreground">(optional)</span><textarea id="request-note" name="note" maxLength={400} rows={3} placeholder="What is this payment for?" value={note} onChange={e=>setNote(e.target.value)} className="min-h-20 w-full resize-y rounded-lg border border-input bg-card/70 px-3 py-2 text-base text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/45"/><span className="text-xs text-muted-foreground">{Array.from(note).length}/200 characters</span></label>
      {message&&<p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" aria-live="polite">{message}</p>}
      <p className="text-xs text-muted-foreground">Your amount and note are encrypted for you and the person you request from.</p>
      <Button type="submit" variant="default" className="mt-2 min-h-11" disabled={isCreating}>{isCreating?<><Loader className="size-4 animate-spin" aria-hidden="true"/>Creating request…</>:"Send request"}</Button>
    </form>}
  </DialogContent></Dialog>;
}
