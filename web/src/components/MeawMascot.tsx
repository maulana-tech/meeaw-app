import Image from "next/image";
import { cn } from "@/lib/utils";

type Mood = "idle" | "loading" | "success";

const LABELS: Record<Mood, string> = {
  idle: "Meaw the cat",
  loading: "Meaw the cat, waiting",
  success: "Meaw the cat tucking a coin away",
};

// The pixel cat from the logo. "success" drops a coin that the cat hides,
// "loading" hops, "idle" breathes. Motion lives in globals.css (.meaw-mascot)
// and stops under prefers-reduced-motion. `tone="auto"` follows the dashboard
// light/dark mode the same way the logo does.
export function MeawMascot({
  mood = "idle",
  size = 64,
  tone = "auto",
  className,
}: {
  mood?: Mood;
  size?: number;
  tone?: "auto" | "ink" | "white";
  className?: string;
}) {
  const cat = (src: string, extra?: string) => (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("meaw-cat size-full", extra)}
    />
  );
  return (
    <span
      role="img"
      aria-label={LABELS[mood]}
      data-mood={mood}
      className={cn("meaw-mascot relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {tone === "white" ? (
        cat("/assets/mawee-white.svg")
      ) : tone === "ink" ? (
        cat("/assets/mawee.svg")
      ) : (
        <>
          {cat("/assets/mawee.svg", "dash-logo-light")}
          {cat("/assets/mawee-white.svg", "dash-logo-dark")}
        </>
      )}
      {mood === "success" ? (
        <svg
          viewBox="0 0 6 6"
          shapeRendering="crispEdges"
          className="meaw-coin absolute left-1/2 top-0 w-[24%]"
          aria-hidden="true"
        >
          <path fill="#B7791F" d="M1 0h4v1h1v4h-1v1H1V5H0V1h1z" />
          <path fill="#FADF2A" d="M1 1h4v4H1z" />
          <path fill="#B7791F" d="M2.5 2h1v2h-1z" />
        </svg>
      ) : null}
    </span>
  );
}
