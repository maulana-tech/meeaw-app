"use client";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  currencyForLocale,
  FX_CACHE_TTL_MS,
  FX_CURRENCIES,
  type FxCurrency,
  type FxSnapshot,
  fxEstimateText,
  isFxCurrency,
  parseFxSnapshot,
} from "../../lib/fx";
import { readReferenceRates } from "../../lib/fxClient";

const preferenceKey = "mawee:fiat-reference-currency";
const preferenceEvent = "mawee:fiat-currency-changed";
function preference(): FxCurrency {
  try {
    const stored = localStorage.getItem(preferenceKey);
    if (isFxCurrency(stored)) return stored;
  } catch {
    /* Estimates also work when storage is unavailable. */
  }
  const currency = currencyForLocale(navigator.language);
  return isFxCurrency(currency) ? currency : "USD";
}
let temporaryPreference: FxCurrency | null = null;
function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(preferenceEvent, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(preferenceEvent, notify);
  };
}
function setPreference(currency: FxCurrency) {
  temporaryPreference = currency;
  try {
    localStorage.setItem(preferenceKey, currency);
    temporaryPreference = null;
  } catch {
    /* Keep the choice for this tab. */
  }
  window.dispatchEvent(new Event(preferenceEvent));
}
export function FxEstimate({
  amount,
  asset,
  testFunds,
  allowCurrencyChoice = false,
}: {
  amount: string;
  asset: string;
  testFunds: boolean;
  allowCurrencyChoice?: boolean;
}) {
  const currency = useSyncExternalStore(
    subscribe,
    () => temporaryPreference ?? preference(),
    () => "USD" as FxCurrency,
  );
  const id = useId();
  const [snapshot, setSnapshot] = useState<FxSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (currency === "USD") return;
    let cancelled = false;
    async function refresh() {
      setLoading(true);
      try {
        const rates = await readReferenceRates();
        if (!cancelled) setSnapshot(rates);
      } catch {
        if (!cancelled) setSnapshot(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [currency]);
  let validSnapshot: FxSnapshot | null = null;
  try {
    if (snapshot) validSnapshot = parseFxSnapshot(snapshot);
  } catch {
    /* Hide expired references. */
  }
  const estimate = validSnapshot
    ? fxEstimateText(
        amount,
        currency,
        validSnapshot,
        typeof navigator === "undefined" ? "en-US" : navigator.language,
      )
    : null;
  const quote = validSnapshot?.quotes[currency];
  return (
    <div className="grid min-w-0 gap-1 text-xs font-normal text-muted-foreground">
      {allowCurrencyChoice && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={id}>Estimate currency</label>
          <select
            id={id}
            value={currency}
            onChange={(event) => {
              if (isFxCurrency(event.target.value))
                setPreference(event.target.value);
            }}
            className="min-h-11 rounded-lg border border-input bg-card px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/45"
          >
            {FX_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </div>
      )}
      {currency !== "USD" &&
        (quote ? (
          <>
            {estimate && (
              <p className="break-words tabular-nums">
                {estimate} · {currency} estimate
              </p>
            )}
            <p>
              {validSnapshot &&
              (validSnapshot.stale ||
                Date.now() - Date.parse(validSnapshot.fetchedAt) >=
                  FX_CACHE_TTL_MS)
                ? "Cached reference"
                : "Daily reference"}{" "}
              · {quote.date} ·{" "}
              <a
                href="https://frankfurter.dev/"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Frankfurter
              </a>
            </p>
          </>
        ) : (
          <p>
            {loading
              ? "Loading reference rate…"
              : "Fiat estimate unavailable. You can still send."}
          </p>
        ))}
      <p>
        Assumes 1 {asset} = 1 USD. Payment stays in {asset}.
      </p>
      {testFunds && <p>Testnet funds; this estimate has no cash value.</p>}
    </div>
  );
}
