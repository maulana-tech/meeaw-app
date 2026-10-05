"use client";

import { Check, ChevronRight, Copy, ExternalLink, QrCode } from "lucide-react";
import Link from "next/link";
import {
  type ForwardedRef,
  forwardRef,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LINKS_PATH, WITHDRAW_PATH } from "../../lib/auth-routes";
import { fromBaseUnits } from "../../lib/crypto";
import { unlockLabel } from "../../lib/passkey";
import { useWallet } from "../WalletProvider";
import { ActivityFeed } from "./ActivityFeed";
import { AddFundsDialog } from "./AddFundsDialog";
import { BalanceCard } from "./BalanceCard";
import { DashboardPageHeader } from "./DashboardPageHeader";
import { weeklyActivity } from "./dashboardAnalytics";
import { PaymentQrDialog } from "./PaymentQrDialog";
import { ReceiveDialog } from "./ReceiveDialog";
import {
  dashButtonPrimary,
  dashButtonSecondary,
  dashCell,
  dashFocus,
  dashLedger,
} from "./styles";
import { useMyNotes } from "./useMyNotes";

import { CreateRequestDialog } from "./CreateRequestDialog";
import { RequestsTile } from "./RequestsTile";
export function Dashboard() {
  const {
    address,
    username,
    usernameResolved,
    openUsernameModal,
    accountUnlocked,
    promptUnlock,
    recoveryMethod,
  } = useWallet();
  const [origin, setOrigin] = useState("");
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [addFundsOpen, setAddFundsOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const { notes, claimable, loading, refreshing, stale, refresh } = useMyNotes(
    accountUnlocked ? address : undefined,
  );
  const insight = useMemo(() => weeklyActivity(notes), [notes]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const payLink = username && origin ? `${origin}/pay/${username}` : "";
  const locked = Boolean(address) && !accountUnlocked;
  const needsUsername = usernameResolved && !username;

  return (
    <>
      <DashboardPageHeader
        title={username ? `Hi, @${username}` : "Welcome to Mawee"}
        description="Your private balance, payment link and recent activity."
      />

      {needsUsername ? (
        <div className="mb-4 flex flex-col gap-4 rounded-(--dash-radius) border border-(--dash-line-solid) bg-(--dash-surface) p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="mt-2 size-1.5 shrink-0 rounded-full bg-(--dash-accent)"
              aria-hidden="true"
            />
            <div>
              <h2 className="font-medium">
                Claim your username to start getting paid
              </h2>
              <p className="mt-1 text-sm text-(--dash-ash)">
                It becomes your payment link, so clients can pay you without
                seeing your wallet history.
              </p>
            </div>
          </div>
          <button
            type="button"
            className={dashButtonPrimary}
            onClick={openUsernameModal}
          >
            Claim username
          </button>
        </div>
      ) : null}

      <div className={`${dashLedger} lg:grid-cols-3`}>
        <section aria-label="Balance" className={`${dashCell} lg:col-span-2`}>
          <BalanceCard
            claimable={claimable}
            loading={loading}
            locked={locked}
            unlockLabel={unlockLabel(recoveryMethod)}
            onUnlock={promptUnlock}
            onReceive={username ? () => setReceiveOpen(true) : undefined}
            onAddFunds={() => setAddFundsOpen(true)}
            cashOutHref={WITHDRAW_PATH}
            onRefresh={refresh}
            refreshing={refreshing}
            stale={stale}
          />
        </section>

        <section aria-label="Payment link" className={dashCell}>
          <PayLinkCard
            payLink={payLink}
            username={username}
            resolved={usernameResolved}
          />
        </section>

        <div className={`${dashCell} lg:col-span-2`}>
          {locked ? (
            <LockedActivity />
          ) : (
            <ActivityFeed
              notes={notes}
              loading={loading}
              limit={5}
              showSeeAll
              showFilters={false}
              title="Recent activity"
            />
          )}
        </div>

        <section aria-label="Last 7 days" className={dashCell}>
          <WeekCard
            buckets={insight.buckets}
            received={insight.receivedAmount}
            cashedOut={insight.cashedOutAmount}
            hidden={locked || loading}
          />
        </section>
      </div>

      <section aria-label="Requests" className="mt-4">
        <RequestsTile />
      </section>
      <CreateRequestDialog open={requestOpen} onOpenChange={setRequestOpen} />
      <ReceiveDialog
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        username={username ?? ""}
        origin={origin}
        onRequest={() => {
          setReceiveOpen(false);
          setRequestOpen(true);
        }}
      />
      <AddFundsDialog
        open={addFundsOpen}
        onOpenChange={setAddFundsOpen}
        onComplete={refresh}
      />
    </>
  );
}

/** Cell heading in the landing's style: mono label left, index right. */
function CellHeading({
  title,
  index,
  action,
}: {
  title: string;
  index: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="dashboard-tile-title">{title}</h2>
      {action ?? (
        <span className="text-xs text-(--dash-ash) tabular-nums">{index}</span>
      )}
    </div>
  );
}

function PayLinkCard({
  payLink,
  username,
  resolved,
}: {
  payLink: string;
  username: string | null;
  resolved: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const qrTriggerRef = useRef<HTMLButtonElement>(null);
  const displayLink = payLink.replace(/^https?:\/\//, "");

  async function copyLink() {
    if (!payLink) return;
    await navigator.clipboard?.writeText(payLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex h-full flex-col p-6">
      <CellHeading
        title="Payment link"
        index="02"
        action={
          username ? (
            <Link
              href={LINKS_PATH}
              className={`inline-flex items-center gap-0.5 rounded-(--dash-radius-sm) text-sm text-(--dash-ash) transition-colors hover:text-(--dash-fg) ${dashFocus}`}
            >
              Manage
              <ChevronRight className="size-4" aria-hidden="true" />
            </Link>
          ) : undefined
        }
      />

      {username ? (
        <>
          <p className="mt-4 text-sm leading-6 text-(--dash-ash)">
            Anyone can pay you in USDC from any wallet. Payments land in your
            private balance.
          </p>
          <div className="mt-5 truncate border-y border-(--dash-line) py-3 font-mono text-sm">
            {displayLink || "Loading link…"}
          </div>
          <div className="mt-auto flex flex-wrap gap-2 pt-6">
            <PayLinkAction
              label={copied ? "Copied" : "Copy"}
              ariaLabel={copied ? "Link copied" : "Copy link"}
              onClick={copyLink}
              disabled={!payLink}
              primary
            >
              {copied ? <Check /> : <Copy />}
            </PayLinkAction>
            <PayLinkAction
              ref={qrTriggerRef}
              label="QR"
              ariaLabel="Show QR code"
              onClick={() => setQrOpen(true)}
              disabled={!payLink}
            >
              <QrCode />
            </PayLinkAction>
            <a
              href={payLink || undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!payLink}
              aria-label="Open link"
              className={dashButtonSecondary}
            >
              <ExternalLink aria-hidden="true" />
              Open
            </a>
          </div>
          {payLink ? (
            <PaymentQrDialog
              open={qrOpen}
              onOpenChange={setQrOpen}
              url={payLink}
              triggerRef={qrTriggerRef}
            />
          ) : null}
        </>
      ) : resolved ? (
        <p className="mt-4 text-sm leading-6 text-(--dash-ash)">
          Your link appears here as soon as you claim a username.
        </p>
      ) : (
        <div className="mt-5 h-11 rounded-(--dash-radius-sm) bg-(--dash-tint) motion-safe:animate-pulse" />
      )}
    </div>
  );
}

const PayLinkAction = forwardRef(function PayLinkAction(
  {
    label,
    ariaLabel,
    onClick,
    disabled,
    primary = false,
    children,
  }: {
    label: string;
    ariaLabel: string;
    onClick: () => void;
    disabled: boolean;
    primary?: boolean;
    children: ReactNode;
  },
  ref: ForwardedRef<HTMLButtonElement>,
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={primary ? dashButtonPrimary : dashButtonSecondary}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {children}
      {label}
    </button>
  );
});

function LockedActivity() {
  return (
    <div className="flex h-full flex-col p-6">
      <CellHeading title="Recent activity" index="03" />
      <p className="my-auto max-w-sm py-10 text-sm leading-6 text-(--dash-ash)">
        Your payment history is private. Unlock your balance above to read it on
        this device.
      </p>
    </div>
  );
}

function WeekCard({
  buckets,
  received,
  cashedOut,
  hidden,
}: {
  buckets: number[];
  received: bigint;
  cashedOut: bigint;
  hidden: boolean;
}) {
  const max = Math.max(1, ...buckets);
  const today = new Date();
  const days = buckets.map((count, index) => {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - (6 - index),
    );
    return {
      key: date.toDateString(),
      label: date.toLocaleDateString(undefined, { weekday: "narrow" }),
      count,
    };
  });

  return (
    <div className="flex h-full flex-col p-6">
      <CellHeading title="Last 7 days" index="04" />

      <dl className="mt-5 grid grid-cols-2 border-y border-(--dash-line)">
        <div className="py-4 pr-4">
          <dt className="text-xs text-(--dash-ash)">Received</dt>
          <dd className="mt-1 text-2xl font-normal tracking-tight tabular-nums">
            {hidden ? "—" : `+${fromBaseUnits(received)}`}
          </dd>
        </div>
        <div className="border-l border-(--dash-line) py-4 pl-4">
          <dt className="text-xs text-(--dash-ash)">Cashed out</dt>
          <dd className="mt-1 text-2xl font-normal tracking-tight tabular-nums">
            {hidden ? "—" : `−${fromBaseUnits(cashedOut)}`}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] tracking-[0.12em] text-(--dash-ash) uppercase">
        Amounts in USDC
      </p>

      <div
        className="mt-auto pt-6"
        role="img"
        aria-label={`Payments per day over the last seven days: ${buckets.join(", ")}`}
      >
        <div className="flex h-20 items-end gap-1.5">
          {days.map((day) => (
            <span
              key={day.key}
              className={`flex-1 ${
                !hidden && day.count > 0
                  ? "bg-(--dash-accent)"
                  : "bg-(--dash-fg)/8"
              }`}
              style={{
                height: hidden
                  ? "6%"
                  : `${Math.max(6, (day.count / max) * 100)}%`,
              }}
            />
          ))}
        </div>
        <div className="mt-2 flex gap-1.5" aria-hidden="true">
          {days.map((day) => (
            <span
              key={day.key}
              className="flex-1 text-center text-[11px] text-(--dash-ash)"
            >
              {day.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
