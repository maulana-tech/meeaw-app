"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useWallet } from "../WalletProvider";
import { LANDING_SECTIONS } from "./Nav";
import {
  Frame,
  MonoLabel,
  pillOutlineDark,
  pillSolidViolet,
} from "./primitives";

// Product facts only — no vanity metrics.
const FACTS = [
  { value: "~0.8s", label: "Finality on Monad" },
  { value: "0 MON", label: "Gas for you or your client" },
  { value: "1 link", label: "For every client" },
  { value: "100%", label: "Self-custodial" },
] as const;

export function Hero() {
  const { address, signIn } = useWallet();

  return (
    <section
      id="top"
      aria-labelledby="hero-title"
      className="relative isolate overflow-hidden"
    >
      <Frame className="flex min-h-[92svh] flex-col justify-end pt-28 pb-14 sm:pb-20">
        <div className="grid items-end gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="max-w-3xl">
            <h1
              id="hero-title"
              className="text-[clamp(2.6rem,6.2vw,5.4rem)] font-normal leading-[1.02] tracking-[-0.02em]"
            >
              Get paid in USDC.
              <br />
              Keep your income private.
            </h1>
            <p className="mt-7 max-w-[56ch] text-base leading-relaxed text-starlight/80 sm:text-lg">
              Share one payment link. Your client pays in USDC on Monad, and the
              money lands in a private balance only you can see — with a receipt
              you can show your accountant whenever you need it.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
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
              <a href="#how" className={pillOutlineDark}>
                See how it works
              </a>
            </div>
          </div>

          <nav aria-label="Explore Meaw" className="hidden lg:block">
            <MonoLabel className="block border-b border-starlight/70 pb-3 text-starlight/85">
              Explore Meaw
            </MonoLabel>
            <ul className="list-none">
              {LANDING_SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="group flex items-center justify-between border-b border-starlight/15 py-3 font-landing text-xs uppercase tracking-[0.22em] text-starlight/80 transition-colors hover:text-starlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-starlight"
                  >
                    {section.label}
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Frame>

      <Frame>
        <dl className="grid grid-cols-2 border-y border-starlight/10 bg-void-2 lg:grid-cols-4">
          {FACTS.map((fact, index) => (
            <div
              key={fact.label}
              className={`flex flex-col-reverse gap-3 py-10 pr-4 sm:py-14 ${
                index % 2 === 1
                  ? "border-l border-starlight/10 pl-4 sm:pl-8"
                  : ""
              } ${index >= 2 ? "border-t border-starlight/10 lg:border-t-0" : ""} ${
                index === 2 ? "lg:border-l lg:pl-8" : ""
              }`}
            >
              <dt>
                <MonoLabel className="text-starlight/65">
                  {fact.label}
                </MonoLabel>
              </dt>
              <dd className="text-[clamp(2.2rem,4.2vw,3.6rem)] font-normal leading-none tracking-tight">
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      </Frame>
    </section>
  );
}
