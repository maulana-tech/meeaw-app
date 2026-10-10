"use client";

import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dashButtonSecondary,
  dashFocus,
} from "../../components/dashboard/styles";
import {
  clearInstallPrompt,
  getInstallPrompt,
  type InstallEvent,
} from "./installPrompt";

const DISMISSED = "meaw:pwa-install-dismissed";

export function InstallMeaw() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const media = window.matchMedia("(display-mode: standalone)");
    const standalone = () =>
      media.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED) === "1";
    } catch {}
    if (standalone() || dismissed) return;
    setHidden(false);
    setPrompt(getInstallPrompt());
    setIos(
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );
    const offer = (event: Event) => {
      if (dismissed || standalone()) return;
      event.preventDefault();
      setPrompt(event as InstallEvent);
      setError("");
    };
    const installed = () => {
      clearInstallPrompt();
      setHidden(true);
      setPrompt(null);
    };
    const displayChanged = () => {
      if (standalone()) installed();
    };
    window.addEventListener("beforeinstallprompt", offer);
    window.addEventListener("appinstalled", installed);
    media.addEventListener("change", displayChanged);
    return () => {
      window.removeEventListener("beforeinstallprompt", offer);
      window.removeEventListener("appinstalled", installed);
      media.removeEventListener("change", displayChanged);
    };
  }, []);

  function dismiss() {
    clearInstallPrompt();
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {}
    setHidden(true);
    setPrompt(null);
  }
  async function install() {
    if (!prompt || working) return;
    setWorking(true);
    setError("");
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      clearInstallPrompt();
      setPrompt(null);
      if (choice.outcome === "accepted") setHidden(true);
      else dismiss();
    } catch {
      setError("Use your browser menu to install Meaw, or try again.");
    } finally {
      setWorking(false);
    }
  }
  if (hidden || (!prompt && !ios)) return null;
  return (
    <aside
      aria-label="Install Meaw"
      className="mb-5 flex items-start gap-3 border-y border-(--dash-line) py-4 lg:hidden"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Meaw on your home screen</p>
        <p className="mt-1 text-sm leading-6 text-(--dash-ash)">
          {ios
            ? "In Safari, open Share, then choose Add to Home Screen."
            : "Open your private payments directly from your phone."}
        </p>
        {prompt && (
          <button
            type="button"
            onClick={() => void install()}
            disabled={working}
            className={`${dashButtonSecondary} mt-3 min-h-11`}
          >
            <Download aria-hidden="true" />
            {working ? "Opening installer…" : "Install Meaw"}
          </button>
        )}
        {error && (
          <p role="status" className="mt-2 text-sm text-(--dash-ash)">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss install suggestion"
        onClick={dismiss}
        className={`flex size-11 shrink-0 items-center justify-center rounded-full text-(--dash-ash) hover:bg-(--dash-tint) ${dashFocus}`}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </aside>
  );
}
