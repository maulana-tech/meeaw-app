"use client";

import {
  ArrowUpRight,
  FileText,
  History,
  Inbox,
  LayoutGrid,
  Link2,
  LogOut,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { usePendingRequestsCount } from "../../features/requests/hooks/usePendingRequestsCount";
import {
  DASHBOARD_PATH,
  HISTORY_PATH,
  INVOICES_PATH,
  LINKS_PATH,
  REQUESTS_PATH,
  SETTINGS_PATH,
  WITHDRAW_PATH,
} from "../../lib/auth-routes";
import { cn } from "../../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useWallet } from "../WalletProvider";
import { useDashboardMode } from "./DashboardBackground";
import { dashFocus, dashIconButton } from "./styles";

const NAV_ITEMS = [
  { href: DASHBOARD_PATH, label: "Overview", icon: LayoutGrid },
  { href: LINKS_PATH, label: "Links", icon: Link2 },
  { href: INVOICES_PATH, label: "Invoices", icon: FileText },
  { href: WITHDRAW_PATH, label: "Cash out", icon: ArrowUpRight },
  { href: HISTORY_PATH, label: "History", icon: History },
  { href: REQUESTS_PATH, label: "Requests", icon: Inbox },
  { href: SETTINGS_PATH, label: "Settings", icon: Settings },
] as const;

const MAIN_ITEMS = NAV_ITEMS.filter((item) => item.href !== SETTINGS_PATH);
const FOOTER_ITEMS = NAV_ITEMS.filter((item) => item.href === SETTINGS_PATH);

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function LogoMark() {
  return (
    <>
      <Image
        src="/assets/mawee.svg"
        alt=""
        width={28}
        height={28}
        className="dash-logo-light size-7"
      />
      <Image
        src="/assets/mawee-white.svg"
        alt=""
        width={28}
        height={28}
        className="dash-logo-dark size-7"
      />
    </>
  );
}

export function DashboardShell({
  children,
  contentClassName,
  navigation = false,
}: {
  children: ReactNode;
  contentClassName?: string;
  navigation?: boolean;
}) {
  const pathname = usePathname();

  if (!navigation) {
    return (
      <div className="relative min-h-svh overflow-x-clip pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        <main
          id="main-content"
          className={cn(
            "relative isolate mx-auto w-full max-w-7xl px-(--dashboard-gutter) py-5 sm:py-6 lg:py-7",
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>
    );
  }

  return (
    <DashboardNavLayout pathname={pathname} contentClassName={contentClassName}>
      {children}
    </DashboardNavLayout>
  );
}

function DashboardNavLayout({
  children,
  pathname,
  contentClassName,
}: {
  children: ReactNode;
  pathname: string;
  contentClassName?: string;
}) {
  const { count: pendingRequestsCount } = usePendingRequestsCount();

  const current =
    NAV_ITEMS.find((item) => isActive(pathname, item.href))?.label ??
    "Overview";

  return (
    <div className="relative flex min-h-svh pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <aside className="hidden w-[5.5rem] shrink-0 lg:block">
        <div className="sticky top-14 ml-4 flex h-[calc(100svh-4.5rem)] w-14 flex-col items-center rounded-(--dash-radius) border border-(--dash-line-solid) bg-(--dash-surface) py-4">
          <Link
            href="/"
            aria-label="Meaw home"
            className={cn("rounded-(--dash-radius-sm) p-1", dashFocus)}
          >
            <LogoMark />
          </Link>
          <nav
            aria-label="Dashboard"
            className="flex w-full flex-1 flex-col items-center"
          >
            <ul className="my-auto grid gap-2">
              {MAIN_ITEMS.map((item) => (
                <RailLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  badge={
                    item.href === REQUESTS_PATH
                      ? pendingRequestsCount
                      : undefined
                  }
                />
              ))}
            </ul>
            <ul className="grid gap-2">
              {FOOTER_ITEMS.map((item) => (
                <RailLink key={item.href} item={item} pathname={pathname} />
              ))}
            </ul>
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between gap-4 px-(--dashboard-gutter) lg:pr-10 lg:pl-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              aria-label="Meaw home"
              className={cn("rounded-(--dash-radius-sm) lg:hidden", dashFocus)}
            >
              <LogoMark />
            </Link>
            <span className="dashboard-tile-title">{current}</span>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <AccountMenu />
          </div>
        </header>

        <main
          id="main-content"
          className={cn(
            "relative isolate mx-auto w-full max-w-6xl px-(--dashboard-gutter) pt-4 pb-28 lg:pr-10 lg:pb-16 lg:pl-6",
            contentClassName,
          )}
        >
          {children}
        </main>
      </div>

      <div className="fixed right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] z-40 rounded-(--dash-radius) border border-(--dash-line-solid) bg-(--dash-surface) lg:hidden">
        <MobileTabs
          pathname={pathname}
          pendingRequestsCount={pendingRequestsCount}
        />
      </div>
    </div>
  );
}

function RailLink({
  item: { href, label, icon: Icon },
  pathname,
  badge,
}: {
  item: (typeof NAV_ITEMS)[number];
  pathname: string;
  badge?: number;
}) {
  const active = isActive(pathname, href);
  const showBadge = typeof badge === "number" && badge > 0;
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "group relative flex size-10 items-center justify-center rounded-full transition-colors",
          dashFocus,
          active
            ? "bg-(--dash-fg) text-(--dash-surface)"
            : "text-(--dash-ash) hover:bg-(--dash-tint) hover:text-(--dash-fg)",
        )}
      >
        <Icon
          className="size-[1.125rem]"
          strokeWidth={1.6}
          aria-hidden="true"
        />
        {showBadge ? (
          <span
            className={cn(
              "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none tabular-nums",
              active
                ? "bg-(--dash-surface) text-(--dash-fg) ring-2 ring-(--dash-fg)"
                : "bg-(--dash-fg) text-(--dash-surface) ring-2 ring-(--dash-surface)",
            )}
            aria-hidden="true"
          >
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
        {active ? (
          <span
            className="absolute -left-[9px] h-4 w-0.5 rounded-full bg-(--dash-accent)"
            aria-hidden="true"
          />
        ) : null}
        <span className="pointer-events-none absolute left-full z-50 ml-4 rounded-(--dash-radius-sm) bg-(--dash-fg) px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em] whitespace-nowrap text-(--dash-surface) uppercase opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {label}
          {showBadge ? ` (${badge})` : null}
        </span>
        {showBadge ? <span className="sr-only"> ({badge} pending)</span> : null}
      </Link>
    </li>
  );
}

function MobileTabs({
  pathname,
  pendingRequestsCount,
}: {
  pathname: string;
  pendingRequestsCount?: number;
}) {
  return (
    <nav
      aria-label="Dashboard tabs"
      className="overflow-x-auto overscroll-x-contain"
    >
      <ul className="grid min-w-[28rem] grid-cols-7">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          const badge =
            href === REQUESTS_PATH ? pendingRequestsCount : undefined;
          const showBadge = typeof badge === "number" && badge > 0;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-15 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors",
                  dashFocus,
                  active
                    ? "text-(--dash-fg)"
                    : "text-(--dash-fg)/50 hover:text-(--dash-fg)",
                )}
              >
                {active ? (
                  <span
                    className="absolute top-0 h-0.5 w-6 rounded-full bg-(--dash-accent)"
                    aria-hidden="true"
                  />
                ) : null}
                <div className="relative">
                  <Icon
                    className="size-[1.125rem]"
                    strokeWidth={1.6}
                    aria-hidden="true"
                  />
                  {showBadge ? (
                    <span
                      className="absolute -top-1.5 -right-2.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-(--dash-fg) px-1 text-[9px] font-bold leading-none text-(--dash-surface) ring-2 ring-(--dash-surface) tabular-nums"
                      aria-hidden="true"
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  ) : null}
                </div>
                {label}
                {showBadge ? (
                  <span className="sr-only"> ({badge} pending)</span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ModeToggle() {
  const { mode, toggleMode } = useDashboardMode();
  const dark = mode === "dark";
  return (
    <button
      type="button"
      onClick={toggleMode}
      className={cn(dashIconButton, "border border-(--dash-line)")}
      aria-label={dark ? "Use light mode" : "Use dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}

function AccountMenu() {
  const { username, disconnect } = useWallet();
  const identity = username ? `@${username}` : "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id="dashboard-account-menu-trigger"
        className={cn(
          "flex h-9 items-center gap-2 rounded-full border border-(--dash-line) pr-3.5 pl-1 text-sm font-medium transition-colors hover:bg-(--dash-tint)",
          dashFocus,
        )}
        aria-label={`${identity} account menu`}
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-(--dash-fg) text-xs font-semibold text-(--dash-surface) uppercase">
          {username?.slice(0, 1) || "?"}
        </span>
        <span className="max-w-40 truncate">{identity}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        appearance="glass"
        align="end"
        sideOffset={8}
        className="min-w-52"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="dashboard-tile-title px-2 py-1.5">
            Signed in as {identity}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="bg-(--dash-line)" />
        <DropdownMenuItem
          className="cursor-pointer !text-(--dash-fg) focus:bg-(--dash-tint) focus:!text-(--dash-fg) [&_svg]:!text-(--dash-fg)"
          onClick={disconnect}
        >
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
