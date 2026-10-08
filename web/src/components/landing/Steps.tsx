"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  AtSign,
  Check,
  Fingerprint,
  Lock,
  QrCode,
  Wallet,
  Zap,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { Frame, MonoLabel } from "./primitives";

const STEPS: {
  icon: LucideIcon;
  title: string;
  body: string;
  mock: () => ReactNode;
}[] = [
  {
    icon: AtSign,
    title: "Claim your link",
    body: "Sign in with email, Google, or a passkey and pick a username. Your link is ready in under a minute.",
    mock: ClaimMock,
  },
  {
    icon: QrCode,
    title: "Share it with clients",
    body: "Send the link or show the QR code. Clients pay USDC from any EVM wallet — no Meaw account, no gas.",
    mock: PayMock,
  },
  {
    icon: ArrowDownToLine,
    title: "Withdraw privately",
    body: "Move your balance to any wallet whenever you like. Nobody can trace it back to the payment that funded it.",
    mock: WithdrawMock,
  },
];

const AUTO_ADVANCE_MS = 6000;

export function Steps() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // One Steps per page, so a fixed id; useId drifted between SSR and client.
  const baseId = "how-steps";

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(query.matches);
    const onChange = () => setReduceMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Gently cycle through the steps until the visitor takes over. `active`
  // restarts the countdown whenever the step changes, including by hand.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (paused || reduceMotion) return;
    const timer = window.setTimeout(
      () => setActive((current) => (current + 1) % STEPS.length),
      AUTO_ADVANCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [active, paused, reduceMotion]);

  const select = useCallback((index: number, focus = false) => {
    setActive(index);
    setPaused(true);
    if (focus) tabRefs.current[index]?.focus();
  }, []);

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const last = STEPS.length - 1;
    const next =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? index === last
          ? 0
          : index + 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? index === 0
            ? last
            : index - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    select(next, true);
  };

  const Mock = STEPS[active].mock;

  return (
    <section
      id="how"
      data-ed-section
      aria-labelledby="how-title"
      className="relative py-24 text-graphite sm:py-32"
    >
      <Frame>
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <MonoLabel className="text-graphite/60">How it works</MonoLabel>
            <h2
              id="how-title"
              className="mt-4 text-[clamp(1.9rem,3vw,2.8rem)] font-normal tracking-tight"
            >
              From link to private balance in three steps
            </h2>
          </div>
          <p className="max-w-[46ch] self-end text-lg leading-relaxed text-graphite/70 lg:justify-self-end">
            No seed phrase, no gas, no new wallet for every invoice. Just a link
            you share and a balance only you can see.
          </p>
        </div>

        <div className="mt-14 grid overflow-hidden rounded-none border border-graphite/10 bg-white lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            role="tablist"
            aria-label="Steps"
            aria-orientation="vertical"
            className="flex flex-col"
          >
            {STEPS.map((step, index) => {
              const selected = index === active;
              const Icon = step.icon;
              return (
                <button
                  key={step.title}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${index}`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(index)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  onFocus={() => setPaused(true)}
                  className={cn(
                    "relative flex gap-5 border-b border-graphite/10 px-6 py-7 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet sm:px-9 sm:py-8",
                    selected ? "bg-mist/70" : "hover:bg-mist/40",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-12 shrink-0 items-center justify-center rounded-none transition-all",
                      selected
                        ? "bg-starlight text-void"
                        : "border border-graphite/15 text-graphite/55",
                    )}
                  >
                    <Icon className="size-5" strokeWidth={1.7} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <MonoLabel
                      className={cn(
                        "block",
                        selected ? "text-(--signal-ink)" : "text-graphite/45",
                      )}
                    >
                      Step 0{index + 1}
                    </MonoLabel>
                    <span
                      className={cn(
                        "mt-1.5 block text-[1.4rem] font-normal tracking-tight",
                        selected ? "text-graphite" : "text-graphite/60",
                      )}
                    >
                      {step.title}
                    </span>
                    <span
                      className={cn(
                        "grid transition-[grid-template-rows,opacity] duration-500 ease-out motion-reduce:transition-none",
                        selected
                          ? "grid-rows-[1fr] opacity-100"
                          : "grid-rows-[0fr] opacity-0",
                      )}
                    >
                      <span className="min-h-0 overflow-hidden">
                        <span className="block max-w-[40ch] pt-3 text-[15px] leading-relaxed text-graphite/65">
                          {step.body}
                        </span>
                      </span>
                    </span>
                  </span>
                  {selected && !reduceMotion ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-0.5 bg-graphite/5"
                    >
                      <span
                        key={`${active}-${paused}`}
                        className="block h-full origin-left bg-violet"
                        style={{
                          animation: paused
                            ? "none"
                            : `mawee-step-progress ${AUTO_ADVANCE_MS}ms linear forwards`,
                          transform: paused ? "scaleX(1)" : undefined,
                        }}
                      />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            id={`${baseId}-panel`}
            aria-labelledby={`${baseId}-tab-${active}`}
            className="relative isolate flex min-h-[460px] items-center justify-center overflow-hidden bg-void p-6 text-starlight sm:p-10"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 -z-10 bg-void-2"
            />
            <div
              key={active}
              className="w-full max-w-[420px] motion-safe:animate-[mawee-mock-in_500ms_ease-out]"
            >
              <Mock />
            </div>
          </div>
        </div>
      </Frame>
    </section>
  );
}

/* ---- product mocks (decorative copies of real Mawee screens) ---------------- */

function MockWindow({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-starlight/15 bg-void">
      <div className="flex items-center gap-2 border-b border-starlight/10 px-4 py-3">
        <span className="size-2.5 rounded-full bg-starlight/20" />
        <span className="size-2.5 rounded-full bg-starlight/20" />
        <span className="size-2.5 rounded-full bg-starlight/20" />
        <span className="ml-2 truncate font-landing text-[11px] text-starlight/50">
          {title}
        </span>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between rounded-none border px-3.5 py-2.5 text-sm",
        accent
          ? "border-violet/50 bg-violet/10"
          : "border-starlight/10 bg-void/60",
      )}
    >
      <span className="text-starlight/60">{label}</span>
      <span className="flex items-center gap-1.5 text-starlight">{value}</span>
    </div>
  );
}

function ClaimMock() {
  return (
    <MockWindow title="mawee.xyz">
      <p className="text-lg font-normal">Claim your username</p>
      <p className="mt-1 text-sm text-starlight/55">
        This becomes your payment link.
      </p>
      <div className="mt-5 flex items-center rounded-none border border-violet/60 bg-void px-3.5 py-3 font-landing text-sm">
        <span className="text-starlight/45">mawee.xyz/pay/</span>
        <span className="text-starlight">dinar</span>
        <span className="ml-0.5 h-4 w-px bg-violet motion-safe:animate-pulse" />
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-300">
        <Check className="size-3.5" /> Available
      </p>
      <div className="mt-5 rounded-none bg-indigo-glow py-3 text-center text-sm font-medium">
        Claim @dinar
      </div>
      <div className="mt-4 flex items-center gap-2.5 rounded-none border border-starlight/10 px-3.5 py-3 text-sm">
        <Fingerprint className="size-4 text-violet" />
        <span className="text-starlight/75">
          Keys protected by your passkey
        </span>
      </div>
    </MockWindow>
  );
}

/** Decorative QR-style grid (not a scannable code). */
function FauxQr() {
  const size = 17;
  const cells: { x: number; y: number }[] = [];
  let seed = 7;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const inFinder =
        (x < 5 && y < 5) || (x > size - 6 && y < 5) || (x < 5 && y > size - 6);
      if (!inFinder && seed % 3 === 0) cells.push({ x, y });
    }
  }
  const finder = (x: number, y: number) => (
    <g key={`${x}-${y}`}>
      <rect
        x={x + 0.5}
        y={y + 0.5}
        width="4"
        height="4"
        rx="0.8"
        fill="none"
        stroke="currentColor"
      />
      <rect
        x={x + 1.5}
        y={y + 1.5}
        width="2"
        height="2"
        rx="0.4"
        fill="currentColor"
      />
    </g>
  );
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="size-28 text-graphite"
      aria-hidden="true"
    >
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x + 0.1}
          y={c.y + 0.1}
          width="0.8"
          height="0.8"
          rx="0.2"
          fill="currentColor"
        />
      ))}
      {finder(0, 0)}
      {finder(size - 5, 0)}
      {finder(0, size - 5)}
    </svg>
  );
}

function PayMock() {
  return (
    <MockWindow title="mawee.xyz/pay/dinar">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-starlight/55">Pay @dinar</p>
          <p className="mt-1 text-3xl font-normal">300.00 USDC</p>
          <p className="mt-1 text-sm text-starlight/55">Logo design</p>
        </div>
        <div className="rounded-none bg-white p-2">
          <FauxQr />
        </div>
      </div>
      <div className="mt-5 grid gap-2">
        <Row
          label="Paying from"
          value={
            <>
              <Wallet className="size-3.5" /> 0x5A0b…9c4c
            </>
          }
        />
        <Row
          accent
          label="Network fee"
          value={
            <>
              <Zap className="size-3.5 text-violet" /> Covered
            </>
          }
        />
      </div>
      <div className="mt-5 rounded-none bg-indigo-glow py-3 text-center text-sm font-medium">
        Pay 300 USDC
      </div>
    </MockWindow>
  );
}

function WithdrawMock() {
  return (
    <MockWindow title="Meaw · Withdraw">
      <p className="text-sm text-starlight/55">Private balance</p>
      <p className="mt-1 text-3xl font-normal">$1,240.50</p>
      <ul className="mt-4 grid gap-1.5">
        {[
          { id: "note-a", label: "Private payment", amount: "$300.00" },
          { id: "note-b", label: "Private payment", amount: "$640.50" },
          { id: "note-c", label: "Private payment", amount: "$300.00" },
        ].map(({ id, label, amount }) => (
          <li
            key={id}
            className="flex items-center justify-between rounded-none bg-void/60 px-3.5 py-2 text-sm"
          >
            <span className="flex items-center gap-2 text-starlight/70">
              <Lock className="size-3.5 text-violet" /> {label}
            </span>
            <span>{amount}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 grid gap-2">
        <Row label="To" value="0x9F2c…41aB" />
        <Row
          accent
          label="Proof built in your browser"
          value={
            <>
              <Check className="size-3.5 text-emerald-300" /> Ready
            </>
          }
        />
      </div>
      <p className="mt-4 text-center font-landing text-[11px] uppercase tracking-[0.18em] text-starlight/50">
        Not linked to any deposit
      </p>
    </MockWindow>
  );
}
