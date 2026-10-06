"use client";
import type { TransferRecord } from "../../features/transfers/types";
import { DashboardNotice } from "./DashboardNotice";
import { dashButtonSecondary } from "./styles";
export function PendingTransfersNotice({
  record,
  onOpen,
}: {
  record: TransferRecord | null;
  onOpen: (record: TransferRecord) => void;
}) {
  if (!record) return null;
  return (
    <DashboardNotice
      label="In progress"
      title="Your private transfer is still in progress"
      action={
        <button
          type="button"
          className={dashButtonSecondary}
          onClick={() => onOpen(record)}
        >
          View transfer
        </button>
      }
    >
      Reopen it to continue preparation or check confirmation.
    </DashboardNotice>
  );
}
