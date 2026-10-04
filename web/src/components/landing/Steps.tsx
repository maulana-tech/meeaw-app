import type { LucideIcon } from "lucide-react";
import { ArrowDownToLine, AtSign, QrCode } from "lucide-react";
import { Frame, MonoLabel } from "./primitives";

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: AtSign,
    title: "Claim your link",
    body: "Sign in with email, Google, or a passkey and pick a username. Your link is ready in under a minute.",
  },
  {
    icon: QrCode,
    title: "Share it with clients",
    body: "Send the link or show the QR code. Clients pay USDC from any EVM wallet — no Mawee account needed.",
  },
  {
    icon: ArrowDownToLine,
    title: "Withdraw privately",
    body: "Move your balance to any wallet whenever you like. Nobody can trace it back to the payment that funded it.",
  },
];

/** Gradient tile behind a step's icon (light sections). */
export function GradientTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div
      aria-hidden="true"
      className="flex size-16 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#3d2bff_0%,#836ef9_50%,#e24c9b_100%)] text-white shadow-[0_12px_32px_-12px_rgba(91,43,255,0.6)]"
    >
      <Icon className="size-7" strokeWidth={1.6} />
    </div>
  );
}

export function Steps() {
  return (
    <section
      id="how"
      data-ed-section
      aria-labelledby="how-title"
      className="relative bg-mist py-24 text-graphite sm:py-32"
    >
      <Frame>
        <MonoLabel className="text-graphite/60">{"/// How it works"}</MonoLabel>
        <h2
          id="how-title"
          className="mt-4 text-[clamp(1.9rem,3vw,2.8rem)] font-light tracking-tight"
        >
          From link to private balance in three steps
        </h2>
        <ol className="mt-14 grid list-none border-y border-graphite/10 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              data-ed-article
              className={`py-12 md:px-8 md:py-14 ${
                index > 0
                  ? "border-t border-graphite/10 md:border-t-0 md:border-l"
                  : ""
              } ${index === 0 ? "md:pl-0" : ""}`}
            >
              <GradientTile icon={step.icon} />
              <MonoLabel className="mt-8 block text-graphite/50">
                Step 0{index + 1}
              </MonoLabel>
              <h3 className="mt-2 text-[1.6rem] font-normal tracking-tight">
                {step.title}
              </h3>
              <p className="mt-3 max-w-[38ch] text-[15px] leading-relaxed text-graphite/65">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </Frame>
    </section>
  );
}
