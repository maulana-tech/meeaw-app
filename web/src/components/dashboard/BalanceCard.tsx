"use client";

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  LockKeyhole,
  Plus,
  QrCode,
  RotateCw,
  Send,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { ASSETS } from "../../lib/assets";
import { fromBaseUnits } from "../../lib/crypto";
import { activePools } from "../../lib/pools";
import { CoinIcon } from "../ui/coin-icon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  dashButtonPrimary,
  dashButtonSecondary,
  dashIconButton,
} from "./styles";
import { assetLabel, selectAsset, useSelectedPool } from "./useSelectedPool";

// Balance currencies. AUSD, USDT and MUSD are fiat-backed payment stablecoins
// already live on Monad (largest supply first, per DefiLlama); MON is Monad's
// native token. Each needs its own pool, since a MaweePool holds exactly one
// token: an entry becomes selectable once its pool is active, the rest stay
// "Coming soon". Entries without a logo show their initials.
const UPCOMING_CURRENCIES: readonly {
  symbol: string;
  issuer: string;
  logo?: string;
}[] = [
  { symbol: "AUSD", issuer: "Agora" },
  { symbol: "USDT", issuer: "Tether" },
  { symbol: "MUSD", issuer: "MetaMask USD" },
  { symbol: "MON", issuer: "Monad native token" },
  { symbol: "EURC", issuer: "Circle", logo: "/stablecoins/eurc.png" },
  { symbol: "GYEN", issuer: "GMO Trust", logo: "/stablecoins/gyen.png" },
  { symbol: "ZUSD", issuer: "GMO Trust", logo: "/stablecoins/zusd.png" },
  { symbol: "AUDD", issuer: "Novatti", logo: "/stablecoins/audd.png" },
];

function formatUsd(units: bigint): string {
  return Number(fromBaseUnits(units)).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

export function BalanceCard({
  claimable,
  loading,
  locked = false,
  unlockLabel = "Unlock",
  onUnlock,
  onReceive,
  onSend,
  onAddFunds,
  cashOutHref,
  onRefresh,
  refreshing = false,
  stale = false,
}: {
  claimable: bigint;
  loading: boolean;
  locked?: boolean;
  unlockLabel?: string;
  onUnlock?: () => void;
  onReceive?: () => void;
  onSend?: () => void;
  onAddFunds?: () => void;
  cashOutHref?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
  stale?: boolean;
}) {
  const [balanceVisible, setBalanceVisible] = useState(true);
  const pool = useSelectedPool();

  if (locked) {
    return (
      <div className="flex h-full flex-col p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="dashboard-tile-title">Private balance</h2>
          <span className="flex items-center gap-2 text-xs text-(--dash-ash) tabular-nums">
            <LockKeyhole
              className="size-3.5"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            01
          </span>
        </div>
        <p
          className="mt-6 text-6xl font-normal tracking-tight text-(--dash-fg)/15 select-none"
          aria-hidden="true"
        >
          $ –––.––
        </p>
        <p className="mt-3 max-w-md text-sm leading-6 text-(--dash-ash)">
          Your balance is encrypted on this device. Unlock to see it and move
          funds.
        </p>
        <div className="mt-auto pt-8">
          <button
            type="button"
            onClick={onUnlock}
            disabled={!onUnlock}
            className={dashButtonPrimary}
          >
            <LockKeyhole aria-hidden="true" />
            {unlockLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <h2 className="dashboard-tile-title">Private balance</h2>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!onRefresh || refreshing}
            className={dashIconButton}
            aria-label={
              refreshing
                ? "Updating balance"
                : stale
                  ? "Balance data is delayed. Retry"
                  : "Refresh balance"
            }
            title={refreshing ? "Updating balance…" : "Refresh balance"}
          >
            <RotateCw
              className={`!size-3.5 ${refreshing ? "motion-safe:animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <CurrencySelector />
          <button
            type="button"
            className={dashIconButton}
            onClick={() => setBalanceVisible((visible) => !visible)}
            aria-label={balanceVisible ? "Hide balance" : "Show balance"}
            aria-pressed={!balanceVisible}
            title={balanceVisible ? "Hide balance" : "Show balance"}
          >
            {balanceVisible ? (
              <Eye aria-hidden="true" />
            ) : (
              <EyeOff aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 h-16 w-64 max-w-full rounded-(--dash-radius-sm) bg-(--dash-tint) motion-safe:animate-pulse" />
      ) : (
        <p className="mt-6 text-6xl font-normal tracking-tight tabular-nums sm:text-7xl">
          {balanceVisible ? formatUsd(claimable) : "$ –––.––"}
        </p>
      )}
      <p
        className="mt-3 flex items-center gap-2 text-sm text-(--dash-ash)"
        role={stale ? "status" : undefined}
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${stale ? "bg-amber-500" : "bg-(--dash-accent)"}`}
          aria-hidden="true"
        />
        {stale
          ? "Balance may be a few minutes behind. Refresh to try again."
          : `${assetLabel(pool)} on Monad, held as private notes only you can read.`}
      </p>

      <div className="mt-auto flex flex-wrap gap-2 pt-8">
        {onSend ? (
          <button
            type="button"
            className={dashButtonPrimary}
            onClick={onSend}
            disabled={loading}
            aria-label="Send private payment"
          >
            <Send aria-hidden="true" />
            Send
          </button>
        ) : null}
        {onReceive ? (
          <button
            type="button"
            className={dashButtonPrimary}
            onClick={onReceive}
            aria-label="Receive payment"
          >
            <QrCode aria-hidden="true" />
            Receive
          </button>
        ) : null}
        {onAddFunds ? (
          <button
            type="button"
            className={dashButtonSecondary}
            onClick={onAddFunds}
            disabled={loading}
          >
            <Plus aria-hidden="true" />
            Add funds
          </button>
        ) : null}
        {cashOutHref ? (
          <Link href={cashOutHref} className={dashButtonSecondary}>
            <ArrowUpRight aria-hidden="true" />
            Cash out
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function CurrencySelector() {
  const selected = useSelectedPool();
  const pools = activePools();
  const live = new Set(pools.map((p) => assetLabel(p).toUpperCase()));
  const upcoming = UPCOMING_CURRENCIES.filter((c) => !live.has(c.symbol));
  const selectedAsset = ASSETS[selected.asset];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="group relative flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-(--dash-tint) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--dash-fg)"
        aria-label="Choose balance currency"
        title={`${selectedAsset.label} · choose currency`}
      >
        {selectedAsset.logo ? (
          <Image
            src={selectedAsset.logo}
            alt=""
            width={22}
            height={22}
            className="size-5.5"
          />
        ) : (
          <span className="text-[10px] font-semibold" aria-hidden="true">
            {selectedAsset.label.slice(0, 2)}
          </span>
        )}
        <span className="absolute right-0 bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-(--dash-fg) text-(--dash-surface)">
          <ChevronDown
            className="size-3 transition-transform group-data-[popup-open]:rotate-180"
            aria-hidden="true"
          />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        appearance="glass"
        align="start"
        sideOffset={10}
        className="min-w-64 p-2"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pt-1 pb-2 text-xs font-semibold text-brand-linen/65">
            Currencies
          </DropdownMenuLabel>
          {pools.map((pool) => {
            const asset = ASSETS[pool.asset];
            const current = pool.scope === selected.scope;
            return (
              <DropdownMenuItem
                key={pool.scope}
                onClick={() => selectAsset(pool.asset)}
                className={`min-h-12 gap-3 rounded-lg px-3 py-2 text-brand-linen focus:bg-brand-linen/18 focus:text-brand-linen [&_svg]:text-brand-linen ${current ? "bg-brand-linen/12" : ""}`}
              >
                <CoinIcon
                  symbol={asset.label}
                  logo={asset.logo}
                  className="size-8"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{asset.label}</span>
                  {pools.length > 1 ? (
                    <span className="block text-[11px] text-brand-linen/70">
                      {asset.issuer}
                    </span>
                  ) : null}
                </span>
                {current ? (
                  <span className="inline-flex items-center gap-1 text-xs text-brand-linen/70">
                    <Check className="size-3" aria-hidden="true" /> Active
                  </span>
                ) : null}
              </DropdownMenuItem>
            );
          })}
          {upcoming.length ? (
            <DropdownMenuSeparator className="my-2 bg-brand-linen/12" />
          ) : null}
          {upcoming.map(({ symbol, issuer, logo }) => (
            <DropdownMenuItem
              key={symbol}
              disabled
              className="min-h-11 gap-3 rounded-lg px-3 py-2 text-brand-linen/55 opacity-100 data-disabled:pointer-events-none data-disabled:opacity-55"
            >
              <CoinIcon symbol={symbol} logo={logo} className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{symbol}</span>
                <span className="block text-[11px]">{issuer}</span>
              </span>
              <span className="text-xs">Coming soon</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
