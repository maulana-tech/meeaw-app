import { Loupe, Padlock, Relay, Vault } from "@lucasmarkes/hairline/react";
import { Frame } from "./primitives";

const REASONS = [
  {
    title: "Private by default",
    body: "Every payment becomes an encrypted note in a shared pool. Anyone can see that a deposit happened — not who it was for.",
    Figure: Vault,
  },
  {
    title: "Provable when it matters",
    body: "Export a receipt for any single payment for your accountant, bank, or tax office, without revealing the rest.",
    Figure: Loupe,
  },
  {
    title: "Your passkey is the key",
    body: "Your private keys are rebuilt from your passkey on each device. No seed phrase, and nothing secret stored with us.",
    Figure: Padlock,
  },
  {
    title: "No gas, no friction",
    body: "Meaw covers network fees. Your client signs once with the wallet they already use, and you never need to hold MON.",
    Figure: Relay,
  },
] as const;

export function Solution() {
  return (
    <section
      id="why"
      data-ed-section
      aria-labelledby="why-title"
      className="relative"
    >
      <Frame>
        <div className="grid border-t border-starlight/10 lg:grid-cols-[1fr_2fr]">
          <div className="py-14 lg:border-r lg:border-starlight/10 lg:py-24 lg:pr-10">
            <h2
              id="why-title"
              className="text-[clamp(1.9rem,2.8vw,2.6rem)] font-normal tracking-tight lg:sticky lg:top-28"
            >
              Why Meaw
            </h2>
          </div>
          <div>
            {REASONS.map(({ Figure, ...reason }, index) => (
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
                {/* Hairline figures answer the pointer; `play` loops a demo
                    until someone hovers or focuses them. */}
                <Figure
                  theme="light"
                  play
                  intensity={1}
                  label={`${reason.title} illustration`}
                  className="hairline-figure mx-auto w-full max-w-[420px]"
                />
              </article>
            ))}
          </div>
        </div>
      </Frame>
    </section>
  );
}
