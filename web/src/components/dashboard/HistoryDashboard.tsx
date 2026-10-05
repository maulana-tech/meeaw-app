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

export function HistoryDashboard() {
  const { address, accountUnlocked, promptUnlock, recoveryMethod } =
    useWallet();
  const { notes, loading, error, refresh } = useMyNotes(
    accountUnlocked ? address : undefined,
  );
  const ready = accountUnlocked && !loading;
  const received = notes.reduce((sum, note) => sum + note.amount, 0n);
  const cashedOut = notes
    .filter((note) => note.spent)
    .reduce((sum, note) => sum + note.amount, 0n);

  return (
    <>
      <DashboardPageHeader
        title="History"
        description="Private payments you received and everything you cashed out."
      />

      <dl
        className={`${dashLedger} mb-5 sm:grid-cols-3`}
        aria-label="History summary"
      >
        <Stat
          label="Total received"
          value={ready ? `+${fromBaseUnits(received)} USDC` : null}
          positive
        />
        <Stat
          label="Total cashed out"
          value={ready ? `−${fromBaseUnits(cashedOut)} USDC` : null}
        />
        <Stat
          label="Payments received"
          value={ready ? String(notes.length) : null}
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
      ) : error ? (
        <ToastFeedback
          title="Could not load history"
          message={error}
          variant="error"
          toastId="history-load-error"
          action={{ label: "Try again", onClick: refresh }}
        />
      ) : (
        <ActivityFeed
          notes={notes}
          loading={loading}
          title="All activity"
          showExport
        />
      )}
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
