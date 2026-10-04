"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { type ReactNode, useRef } from "react";
import { cn } from "@/lib/utils";
import { jetbrainsMono, urbanist } from "./fonts";
import { EditionsTopNav } from "./Nav";

gsap.registerPlugin(useGSAP, ScrollTrigger);

/**
 * Landing page shell: fonts, smooth scrolling, the sticky nav's scrolled
 * state, and fade-up reveals for anything marked `data-ed-article`.
 */
export function Chrome({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const topnav = root.querySelector<HTMLElement>("[data-ed-topnav]");
      const navLinks = gsap.utils.toArray<HTMLElement>(
        "[data-ed-navlink]",
        root,
      );
      const sections = gsap.utils.toArray<HTMLElement>(
        "[data-ed-section]",
        root,
      );

      const mm = gsap.matchMedia(root);
      mm.add(
        { reduceMotion: "(prefers-reduced-motion: reduce)" },
        (context) => {
          const { reduceMotion } = context.conditions as {
            reduceMotion: boolean;
          };

          let lenis: Lenis | undefined;
          let raf: ((t: number) => void) | undefined;
          if (!reduceMotion) {
            lenis = new Lenis();
            lenis.on("scroll", ScrollTrigger.update);
            raf = (t: number) => lenis?.raf(t * 1000);
            gsap.ticker.add(raf);
            gsap.ticker.lagSmoothing(0);
          }

          if (topnav) {
            ScrollTrigger.create({
              start: 40,
              onEnter: () => {
                topnav.dataset.scrolled = "true";
              },
              onLeaveBack: () => {
                topnav.dataset.scrolled = "false";
              },
            });
          }

          // Highlight the nav link of the section in view.
          for (const section of sections) {
            ScrollTrigger.create({
              trigger: section,
              start: "top 55%",
              end: "bottom 55%",
              onToggle: (self) => {
                if (!self.isActive) return;
                for (const link of navLinks) {
                  link.dataset.active = String(
                    link.dataset.edNavlink === section.id,
                  );
                }
              },
            });
          }

          if (!reduceMotion) {
            gsap.set("[data-ed-article]", { autoAlpha: 0, y: 36 });
            ScrollTrigger.batch("[data-ed-article]", {
              start: "top 88%",
              once: true,
              onEnter: (batch) =>
                gsap.to(batch, {
                  autoAlpha: 1,
                  y: 0,
                  duration: 0.9,
                  stagger: 0.1,
                  ease: "power3.out",
                  overwrite: true,
                }),
            });
          }

          return () => {
            if (raf) gsap.ticker.remove(raf);
            lenis?.destroy();
          };
        },
      );
      return () => mm.revert();
    },
    { scope: rootRef },
  );

  return (
    <div
      ref={rootRef}
      data-side="dark"
      className={cn(
        urbanist.variable,
        jetbrainsMono.variable,
        "relative isolate min-h-svh bg-void font-landing text-starlight antialiased selection:bg-violet/40",
      )}
    >
      <EditionsTopNav />
      {children}
    </div>
  );
}
