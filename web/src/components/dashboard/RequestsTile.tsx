"use client";
import {Inbox,ArrowUpRight} from "lucide-react";
import Link from "next/link";
import {useQuery} from "@tanstack/react-query";
import {REQUESTS_PATH} from "../../lib/auth-routes";
import {api} from "../../trpc/client";
import {useWallet} from "../WalletProvider";
import {DashboardTile} from "./DashboardTile";
export function RequestsTile(){
  const {address}=useWallet();const query=useQuery({queryKey:["requests-dashboard-count",address.toLowerCase()],enabled:Boolean(address),refetchInterval:30_000,queryFn:()=>api.requests.pendingCount.query()});
  const count=query.data??0;
  return <Link href={REQUESTS_PATH} aria-label="Open payment requests" className="group block min-h-full rounded-[2.25rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-obsidian focus-visible:ring-offset-4 focus-visible:ring-offset-brand-linen">
    <DashboardTile appearance="linen" className="dashboard-nav-card min-h-[10rem]" header={<div className="flex items-start justify-between gap-4"><h2 className="dashboard-tile-title">Requests</h2><span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-foreground/8" aria-hidden="true"><Inbox className="size-5"/></span></div>} content={<div className="mt-4 flex items-center gap-2"><span className="font-heading text-4xl font-medium tabular-nums">{query.isLoading?"—":count}</span><span className="text-sm text-muted-foreground">waiting for you</span></div>} footer={<span className="flex items-center gap-2 text-sm font-medium">View payment requests<ArrowUpRight className="size-4" aria-hidden="true"/></span>}/>
  </Link>;
}
