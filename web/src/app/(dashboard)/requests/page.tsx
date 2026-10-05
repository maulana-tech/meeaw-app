"use client";
import {useState} from "react";
import {useWallet} from "@/components/WalletProvider";
import {RequestsDashboard} from "@/components/dashboard/RequestsDashboard";
import {CreateRequestDialog} from "@/components/dashboard/CreateRequestDialog";
export default function RequestsPage(){
  const [createOpen,setCreateOpen]=useState(false);const {address,sessionReady}=useWallet();
  if(!sessionReady||!address)return <div className="min-h-64" role="status" aria-label="Loading requests"/>;
  return <><RequestsDashboard onCreate={()=>setCreateOpen(true)}/><CreateRequestDialog open={createOpen} onOpenChange={setCreateOpen}/></>;
}
