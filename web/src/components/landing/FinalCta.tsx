"use client";

import Link from "next/link";
import { useWallet } from "../WalletProvider";
import { Frame, pillSolidViolet } from "./primitives";

export function FinalCta() {
  const { address, signIn } = useWallet();
  return (
    <section
      aria-labelledby="cta-title"
      className="relative isolate overflow-hidden text-graphite"
    >
      <Frame className="flex min-h-[78svh] flex-col justify-center py-24">
        <h2
          id="cta-title"
          className="text-[clamp(4rem,13vw,11rem)] font-normal leading-[0.9] tracking-[-0.04em]"
        >
          Meaw
        </h2>
        <p className="mt-6 max-w-[40ch] text-lg leading-relaxed text-graphite/85 sm:text-xl">
          Private USDC payment links on Monad. Claim yours in under a minute.
        </p>
        <div className="mt-9">
          {address ? (
            <Link href="/dashboard" className={pillSolidViolet}>
              Open your dashboard
            </Link>
          ) : (
            <button
              type="button"
              className={pillSolidViolet}
              onClick={() => signIn()}
            >
              Create your payment link
            </button>
          )}
        </div>
      </Frame>
    </section>
  );
}
