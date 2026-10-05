"use client";

import { ChevronDown, LayoutDashboard, Loader, LogOut } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "../WalletProvider";
import { pillSolidViolet } from "./primitives";

export const LANDING_SECTIONS = [
  { id: "why", label: "Why Mawee" },
  { id: "how", label: "How it works" },
  { id: "who", label: "Who it's for" },
  { id: "faq", label: "FAQ" },
] as const;

export function EditionsTopNav() {
  const router = useRouter();
  const {
    address,
    connecting,
    username,
    usernameResolved,
    openUsernameModal,
    signIn,
    disconnect,
  } = useWallet();

  return (
    <header
      data-ed-topnav
      className="fixed inset-x-0 top-0 z-[70] flex items-center justify-between gap-3 px-4 py-4 text-starlight border-b border-transparent transition-colors duration-300 data-[scrolled=true]:border-starlight/10 data-[scrolled=true]:bg-void sm:px-8 lg:px-14"
    >
      <a
        className="flex flex-none items-center gap-2.5 rounded-full text-starlight hover:text-starlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-starlight"
        href="#top"
        aria-label="Mawee home"
      >
        <Image src="/assets/mawee.svg" alt="" width={32} height={32} priority />
        <span className="text-xl font-medium tracking-tight">Mawee</span>
      </a>

      <nav
        aria-label="Sections"
        className="absolute left-1/2 hidden -translate-x-1/2 items-center rounded-full border border-starlight/10 bg-void px-2 py-1.5 lg:flex"
      >
        {LANDING_SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            data-ed-navlink={section.id}
            className="rounded-full px-4 py-1.5 text-sm text-starlight/75 transition-colors hover:text-starlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-starlight data-[active=true]:bg-starlight/10 data-[active=true]:text-starlight"
          >
            {section.label}
          </a>
        ))}
      </nav>

      <div className="flex min-w-0 flex-none items-center gap-2 sm:gap-4">
        {address && usernameResolved && !username && (
          <button
            type="button"
            className="inline-flex min-h-11 items-center text-sm font-medium text-(--signal-ink) transition-colors hover:text-starlight"
            onClick={openUsernameModal}
            aria-label="Claim username"
          >
            <span className="sm:hidden">Claim</span>
            <span className="hidden sm:inline">Claim username</span>
          </button>
        )}
        {address ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="group inline-flex min-h-11 items-center gap-2 rounded-full border border-starlight/20 px-4 text-sm font-semibold transition-colors hover:border-starlight/50"
              title={address}
            >
              <span className="max-w-24 truncate sm:max-w-40">
                {username ? `@${username}` : "Account"}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-3.5 transition-transform group-data-[popup-open]:rotate-180"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={8}
              className="min-w-44 border border-starlight/10 bg-void-2 p-1.5 text-starlight ring-0"
            >
              <DropdownMenuItem
                className="cursor-pointer px-2.5 py-2 font-medium text-starlight focus:bg-starlight/10 focus:text-starlight [&_svg]:text-starlight"
                onClick={() => router.push("/dashboard")}
              >
                <LayoutDashboard aria-hidden="true" />
                Dashboard
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-starlight/10" />
              <DropdownMenuItem
                className="cursor-pointer px-2.5 py-2 !text-starlight focus:bg-starlight/10 [&_svg]:!text-starlight"
                onClick={disconnect}
              >
                <LogOut aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            type="button"
            className={`${pillSolidViolet} min-h-10 px-5 text-sm disabled:cursor-default disabled:opacity-60`}
            onClick={() => signIn()}
            disabled={connecting}
          >
            {connecting && (
              <Loader
                className="size-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
            )}
            {connecting ? "Signing in…" : "Sign in"}
          </button>
        )}
      </div>
    </header>
  );
}
