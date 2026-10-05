"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { DitherField } from "../landing/DitherField";

type DashboardMode = "light" | "dark";
const STORAGE_KEY = "mawee.dashboard.mode";

// Dither colours per mode: paper + signal blue, or ink + a deep blue that
// stays quiet behind light text.
const DITHER = {
  light: { light: "#faf7f0", dark: "#5ea6e5" },
  dark: { light: "#151310", dark: "#1c5f94" },
} as const;

// Runs before hydration so the saved (or system) mode paints without a flash.
const applyStoredMode = `try{var m=localStorage.getItem("${STORAGE_KEY}");if(m!=="light"&&m!=="dark")m=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.dashMode=m}catch(e){}`;

function readMode(): DashboardMode {
  return document.documentElement.dataset.dashMode === "dark"
    ? "dark"
    : "light";
}

export function DashboardBackground({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<DashboardMode>("light");

  // Follow the toggle wherever it lives: it writes data-dash-mode on <html>.
  useEffect(() => {
    setMode(readMode());
    const observer = new MutationObserver(() => setMode(readMode()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-dash-mode"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="theme-product dashboard-app relative isolate min-h-svh overflow-x-clip">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static, no user input */}
      <script dangerouslySetInnerHTML={{ __html: applyStoredMode }} />
      <div aria-hidden="true" className="fixed inset-0 -z-10">
        <DitherField {...DITHER[mode]} />
      </div>
      {children}
    </div>
  );
}

export function useDashboardMode() {
  const [mode, setMode] = useState<DashboardMode>("light");

  useEffect(() => {
    setMode(readMode());
  }, []);

  const toggleMode = useCallback(() => {
    setMode((current) => {
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.dashMode = next;
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Private mode: the choice just won't persist.
      }
      return next;
    });
  }, []);

  return { mode, toggleMode };
}
