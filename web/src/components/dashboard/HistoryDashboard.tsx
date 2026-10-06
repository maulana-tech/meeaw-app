"use client";

import { fromBaseUnits } from "../../lib/crypto";
import { unlockLabel } from "../../lib/passkey";
import { ToastFeedback } from "../ui/toast-feedback";
import { useWallet } from "../WalletProvider";
import { ActivityFeed } from "./ActivityFeed";
import { DashboardNotice } from "./DashboardNotice";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { dashButtonPrimary, dashCell, dashLedger } from "./styles";
import { useMyNotes } from "./useMyNotes";
import { useEffect,useState } from "react";
import { usePaymentActivity } from "../../features/payments/usePaymentActivity";
import { useTransfers } from "../../features/transfers/hooks/useTransfers";
import type { TransferRecord } from "../../features/transfers/types";
import { PendingTransfersNotice } from "./PendingTransfersNotice";
import { TransferProgress } from "./TransferProgress";
import { TransferDetailsDialog } from "./TransferDetailsDialog";
import { assetLabel, useSelectedPool } from "./useSelectedPool";

export function HistoryDashboard() {
  const { address, accountUnlocked, promptUnlock, recoveryMethod } =
    useWallet();
  const pool = useSelectedPool();
  const asset = assetLabel(pool);
  const { notes, loading, error, refresh } = useMyNotes(
    accountUnlocked ? address : undefined,
    pool,
  );
  const activity=usePaymentActivity(notes),transfers=useTransfers(),[selected,setSelected]=useState<TransferRecord|null>(null);
  const ready=accountUnlocked&&!loading&&!activity.loading&&!activity.incomplete&&!activity.error;
  useEffect(()=>setSelected(null),[address]);
  // Activity spans every pool; show only the selected asset's so amounts in
  // different stablecoins are never added together.
  const rows=activity.rows.filter(r=>r.scope===pool.scope);
  const total=(kind:"received"|"sent"|"cashedOut")=>rows.filter(r=>r.kind===kind&&r.status==="confirmed").reduce((sum,r)=>sum+(r.amount??0n),0n);
  const received=total("received"),cashedOut=total("cashedOut"),sent=total("sent");

  return (
    <>
      <DashboardPageHeader
        title="History"
        description="Your private received payments, transfers and cash-outs."
      />
      <PendingTransfersNotice record={transfers.pending} onOpen={setSelected}/>
      {accountUnlocked&&activity.incomplete&&<p role="status" className="mb-4 text-sm text-(--dash-ash)">Some transaction details are still being checked. Totals will appear once the history is complete.</p>}

      <dl
        className={`${dashLedger} mb-5 sm:grid-cols-3`}
        aria-label="History summary"
      >
        <Stat
          label="Total received"
          value={ready ? `+${fromBaseUnits(received)} ${asset}` : null}
          positive
        />
        <Stat
          label="Total cashed out"
          value={ready ? `−${fromBaseUnits(cashedOut)} ${asset}` : null}
        />
        <Stat
          label="Total sent"
          value={ready ? `−${fromBaseUnits(sent)} ${asset}` : null}
        />
      </dl>

      {!accountUnlocked ? (
        <DashboardNotice
          label="Locked"
          title="Unlock to view history"
          action={
            <button
              type="button"
              onClick={promptUnlock}
              className={dashButtonPrimary}
            >
              {unlockLabel(recoveryMethod)}
            </button>
          }
        >
          Your payment records are encrypted on this device. Only you can read
          them.
        </DashboardNotice>
      ) : error||activity.error ? (
        <ToastFeedback
          title="Could not load history"
          message={error??"Transaction details could not be loaded. Try again shortly."}
          variant="error"
          toastId="history-load-error"
          action={{ label: "Try again", onClick: refresh }}
        />
      ) : (
        <ActivityFeed
          notes={notes}
          rows={rows}
          loading={loading||activity.loading}
          title="All activity"
          showExport
          onTransferOpen={id=>setSelected(activity.records.find(r=>r.id===id)??null)}
        />
      )}
      {selected&&(selected.status==="pending"&&selected.sender.wallet.toLowerCase()===address.toLowerCase()?<TransferProgress record={selected} open onClose={()=>setSelected(null)}/>:<TransferDetailsDialog record={selected} open onOpenChange={next=>{if(!next)setSelected(null);}}/>)}
    </>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | null;
  positive?: boolean;
}) {
  return (
    <div className={`${dashCell} p-5`}>
      <dt className="dashboard-tile-title">{label}</dt>
      <dd className="mt-3 text-2xl font-normal tracking-tight tabular-nums">
        {value ?? "—"}
      </dd>
    </div>
  );
}
