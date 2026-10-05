import { Frame } from "./primitives";
import { ScrollReveal } from "./ScrollReveal";

/** Lattice glyph that opens the statement, drawn as hairlines. */
function LatticeGlyph() {
  return (
    <svg
      viewBox="0 0 60 60"
      className="size-14 text-starlight/80"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      {[0, 20, 40].map((y) =>
        [0, 20, 40].map((x) => (
          <g key={`${x}-${y}`}>
            <rect x={x + 0.5} y={y + 0.5} width="19" height="19" />
            <path d={`M${x + 0.5} ${y + 0.5}L${x + 19.5} ${y + 19.5}`} />
          </g>
        )),
      )}
    </svg>
  );
}

export function ProblemStatement() {
  return (
    <section
      id="problem"
      aria-labelledby="problem-title"
      className="relative py-24 sm:py-32"
    >
      <Frame>
        <h2 className="sr-only" id="problem-title">
          Public wallets were never designed for business.
        </h2>
        <LatticeGlyph />
        <div className="mt-10 max-w-[1100px] text-[clamp(1.7rem,3.3vw,2.9rem)] font-normal leading-[1.22] tracking-[-0.01em]">
          <span data-ed-article className="text-(--signal-ink)">
            Public wallets were never designed for business.{" "}
          </span>
          <ScrollReveal
            containerClassName="inline"
            textClassName="inline text-starlight"
            baseRotation={0}
            baseOpacity={0.2}
            blurStrength={2}
            rotationEnd="center center"
            wordAnimationEnd="center center"
          >
            Get paid to one wallet and anyone can look up
            <span className="font-normal text-starlight">
              {" "}
              how much you earn, who your clients are, and when they pay.
            </span>{" "}
            Mawee keeps that between you and your client.
          </ScrollReveal>
        </div>
      </Frame>
    </section>
  );
}
