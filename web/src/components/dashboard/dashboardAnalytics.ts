import type { ActivityRow } from "../../features/payments/activityTypes";

export type WeeklyActivity = {
  buckets: number[];
  received: number;
  cashedOut: number;
  /** USDC base units received / cashed out over the same seven days. */
  receivedAmount: bigint;
  cashedOutAmount: bigint;
  sent: number;
  sentAmount: bigint;
};

function validDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function weeklyActivity(
  rows: readonly ActivityRow[],
  now = new Date(),
): WeeklyActivity {
  const firstDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - 6,
  );
  const buckets = Array.from({ length: 7 }, () => 0);
  let received = 0;
  let cashedOut = 0;
  let receivedAmount = 0n;
  let cashedOutAmount = 0n;
  let sent=0,sentAmount=0n;

  function add(
    value: string | undefined,
    kind: "received" | "cashedOut" | "sent",
    amount: bigint,
  ) {
    const date = validDate(value);
    if (!date || date < firstDay || date > now) return;
    const localDay = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );
    const index = Math.round(
      (localDay.getTime() - firstDay.getTime()) / 86_400_000,
    );
    if (index < 0 || index > 6) return;
    buckets[index] += 1;
    if (kind === "received") {
      received += 1;
      receivedAmount += amount;
    } else if(kind==="cashedOut") {
      cashedOut += 1;
      cashedOutAmount += amount;
    } else {sent+=1;sentAmount+=amount;}
  }

  for(const row of rows)if(row.status==="confirmed"&&row.amount!==null&&(row.kind==="received"||row.kind==="cashedOut"||row.kind==="sent"))add(row.at,row.kind,row.amount);

  return {
    buckets,
    received,
    cashedOut,
    receivedAmount,
    cashedOutAmount,
    sent,
    sentAmount,
  };
}
