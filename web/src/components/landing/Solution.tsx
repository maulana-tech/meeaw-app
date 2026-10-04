import {
  Check,
  FileText,
  Fingerprint,
  Laptop,
  Smartphone,
  User,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { Frame } from "./primitives";

function Glow({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-full blur-3xl ${className}`}
    />
  );
}

function Chip({
  children,
  tone = "plain",
}: {
  children: ReactNode;
  tone?: "plain" | "violet";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
        tone === "violet"
          ? "border-violet/60 bg-violet/15 text-starlight"
          : "border-starlight/20 bg-void/80 text-starlight/90"
      }`}
    >
      {children}
    </span>
  );
}

function Node({ children, ring }: { children: ReactNode; ring: string }) {
  return (
    <div
      className={`relative flex size-16 items-center justify-center rounded-2xl border bg-void-2 sm:size-20 ${ring}`}
    >
      {children}
    </div>
  );
}

/** Client → private note → you. */
function FlowArt() {
  return (
    <div className="relative flex items-center justify-center gap-3 sm:gap-5">
      <Glow className="left-1/4 top-1/2 size-40 -translate-y-1/2 bg-magenta/30" />
      <Glow className="right-1/4 top-1/2 size-40 -translate-y-1/2 bg-indigo-glow/40" />
      <div className="relative flex flex-col items-center gap-3">
        <Node ring="border-magenta/60">
          <User className="size-7" aria-hidden="true" />
        </Node>
        <Chip>Client</Chip>
      </div>
      <div className="relative -mt-8 h-px w-10 bg-gradient-to-r from-magenta to-violet sm:w-16">
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-magenta">
          Pays
        </span>
      </div>
      <div className="relative flex flex-col items-center gap-3">
        <Node ring="border-violet/70 rounded-full">
          <span className="font-landing-mono text-[10px] tracking-widest text-starlight/80">
            0x••
          </span>
        </Node>
        <Chip tone="violet">Encrypted note</Chip>
      </div>
      <div className="relative -mt-8 h-px w-10 bg-gradient-to-r from-violet to-indigo-glow sm:w-16">
        <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-violet">
          Only you
        </span>
      </div>
      <div className="relative flex flex-col items-center gap-3">
        <Node ring="border-indigo-glow/70">
          <span className="text-lg font-medium">$</span>
        </Node>
        <Chip>You</Chip>
      </div>
    </div>
  );
}

/** One receipt out of many, verified. */
function ReceiptArt() {
  return (
    <div className="relative mx-auto h-44 w-64">
      <Glow className="left-8 top-6 size-40 bg-violet/40" />
      {[2, 1].map((depth) => (
        <div
          key={depth}
          aria-hidden="true"
          className="absolute inset-x-6 top-0 h-36 rounded-xl border border-starlight/10 bg-void-2/80"
          style={{
            transform: `translate(${depth * 14}px, ${depth * 10}px)`,
            opacity: 0.5 / depth,
          }}
        />
      ))}
      <div className="absolute inset-x-6 top-0 flex h-36 flex-col justify-between rounded-xl border border-violet/50 bg-void-2 p-4">
        <div className="flex items-center gap-2 text-xs text-starlight/70">
          <FileText className="size-4" aria-hidden="true" />
          Payment receipt
        </div>
        <div className="text-2xl font-light">$300.00</div>
        <div className="flex items-center justify-between text-[11px] text-starlight/60">
          <span>Logo design</span>
          <Chip tone="violet">
            <Check className="size-3" aria-hidden="true" /> Verified
          </Chip>
        </div>
      </div>
    </div>
  );
}

/** One passkey, the same keys on every device. */
function PasskeyArt() {
  return (
    <div className="relative mx-auto flex h-48 w-72 items-center justify-center">
      <Glow className="left-1/2 top-1/2 size-44 -translate-x-1/2 -translate-y-1/2 bg-indigo-glow/45" />
      <div className="relative flex size-20 items-center justify-center rounded-full border border-violet/70 bg-void-2">
        <Fingerprint className="size-9" aria-hidden="true" />
      </div>
      <div className="absolute left-2 top-6">
        <Chip>
          <Laptop className="size-3.5" aria-hidden="true" /> Laptop
        </Chip>
      </div>
      <div className="absolute bottom-6 right-2">
        <Chip>
          <Smartphone className="size-3.5" aria-hidden="true" /> Phone
        </Chip>
      </div>
      <div className="absolute right-6 top-4">
        <Chip tone="violet">Same keys</Chip>
      </div>
    </div>
  );
}

/** Network fees are covered. */
function GaslessArt() {
  return (
    <div className="relative mx-auto flex h-44 w-72 items-center justify-center">
      <Glow className="left-1/2 top-1/2 size-44 -translate-x-1/2 -translate-y-1/2 bg-magenta/30" />
      <div className="relative grid w-full gap-2">
        {[
          ["Amount", "$120.00 USDC"],
          ["Network fee", "Covered"],
          ["You need", "Only USDC"],
        ].map(([label, value], index) => (
          <div
            key={label}
            className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-sm ${
              index === 1
                ? "border-violet/60 bg-violet/10"
                : "border-starlight/10 bg-void-2"
            }`}
          >
            <span className="text-starlight/65">{label}</span>
            <span className="flex items-center gap-1.5">
              {index === 1 ? (
                <Zap className="size-3.5 text-violet" aria-hidden="true" />
              ) : null}
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const REASONS = [
  {
    title: "Private by default",
    body: "Every payment becomes an encrypted note in a shared pool. Anyone can see that a deposit happened — not who it was for.",
    art: <FlowArt />,
  },
  {
    title: "Provable when it matters",
    body: "Export a receipt for any single payment for your accountant, bank, or tax office, without revealing the rest.",
    art: <ReceiptArt />,
  },
  {
    title: "Your passkey is the key",
    body: "Your private keys are rebuilt from your passkey on each device. No seed phrase, and nothing secret stored with us.",
    art: <PasskeyArt />,
  },
  {
    title: "No gas, no friction",
    body: "Mawee covers network fees. Your client signs once with the wallet they already use, and you never need to hold MON.",
    art: <GaslessArt />,
  },
] as const;

export function Solution() {
  return (
    <section
      id="why"
      data-ed-section
      aria-labelledby="why-title"
      className="relative bg-void"
    >
      <Frame>
        <div className="grid border-t border-starlight/10 lg:grid-cols-[1fr_2fr]">
          <div className="py-14 lg:border-r lg:border-starlight/10 lg:py-24 lg:pr-10">
            <h2
              id="why-title"
              className="text-[clamp(1.9rem,2.8vw,2.6rem)] font-light tracking-tight lg:sticky lg:top-28"
            >
              Why Mawee
            </h2>
          </div>
          <div>
            {REASONS.map((reason, index) => (
              <article
                key={reason.title}
                data-ed-article
                className={`grid items-center gap-10 py-14 md:grid-cols-[1fr_1.1fr] lg:pl-10 lg:py-20 ${
                  index > 0
                    ? "border-t border-starlight/10"
                    : "border-t border-starlight/10 lg:border-t-0"
                }`}
              >
                <div>
                  <h3 className="text-[clamp(1.5rem,2.2vw,2rem)] font-normal leading-tight tracking-tight">
                    {reason.title}
                  </h3>
                  <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-starlight/65">
                    {reason.body}
                  </p>
                </div>
                <div aria-hidden="true">{reason.art}</div>
              </article>
            ))}
          </div>
        </div>
      </Frame>
    </section>
  );
}
