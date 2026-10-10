export const FX_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CAD",
  "CHF",
  "SGD",
  "MYR",
  "IDR",
  "PHP",
  "THB",
  "VND",
  "INR",
  "PKR",
  "BDT",
  "NGN",
  "KES",
  "BRL",
  "MXN",
  "JPY",
  "KRW",
] as const;
export type FxCurrency = (typeof FX_CURRENCIES)[number];
export type FxSnapshot = {
  base: "USD";
  source: "Frankfurter";
  fetchedAt: string;
  stale: boolean;
  quotes: Partial<Record<FxCurrency, { rate: number; date: string }>>;
};
const DAY = 86400000;
export const MAX_REFERENCE_AGE_MS = 7 * DAY;
export const FX_CACHE_TTL_MS = 3600000;
export function isFxCurrency(value: unknown): value is FxCurrency {
  return (
    typeof value === "string" && FX_CURRENCIES.some((code) => code === value)
  );
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid reference rates");
  return value as Record<string, unknown>;
}
function validateQuote(rate: unknown, date: unknown, now: number) {
  if (
    typeof rate !== "number" ||
    !Number.isFinite(rate) ||
    rate <= 0 ||
    rate > 100000000 ||
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  )
    throw new Error("Invalid reference rates");
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== date ||
    timestamp > now ||
    now - timestamp > MAX_REFERENCE_AGE_MS
  )
    throw new Error("Invalid reference date");
  return { rate, date };
}
export function snapshotFromRates(
  value: unknown,
  now = Date.now(),
): FxSnapshot {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length >= FX_CURRENCIES.length
  )
    throw new Error("Invalid reference rates");
  const quotes: FxSnapshot["quotes"] = {};
  for (const item of value) {
    const row = object(item);
    if (
      row.base !== "USD" ||
      !isFxCurrency(row.quote) ||
      row.quote === "USD" ||
      quotes[row.quote]
    )
      throw new Error("Invalid reference currency");
    quotes[row.quote] = validateQuote(row.rate, row.date, now);
  }
  return {
    base: "USD",
    source: "Frankfurter",
    fetchedAt: new Date(now).toISOString(),
    stale: false,
    quotes,
  };
}
export function parseFxSnapshot(value: unknown, now = Date.now()): FxSnapshot {
  const data = object(value);
  if (
    data.base !== "USD" ||
    data.source !== "Frankfurter" ||
    typeof data.stale !== "boolean" ||
    typeof data.fetchedAt !== "string"
  )
    throw new Error("Invalid reference snapshot");
  const fetchedAt = Date.parse(data.fetchedAt);
  if (
    !Number.isFinite(fetchedAt) ||
    fetchedAt > now + 60000 ||
    now - fetchedAt > MAX_REFERENCE_AGE_MS
  )
    throw new Error("Invalid reference snapshot date");
  const entries = Object.entries(object(data.quotes));
  if (!entries.length || entries.length >= FX_CURRENCIES.length)
    throw new Error("Invalid reference rates");
  const quotes: FxSnapshot["quotes"] = {};
  for (const [currency, value] of entries) {
    const quote = object(value);
    if (!isFxCurrency(currency) || currency === "USD")
      throw new Error("Invalid reference currency");
    quotes[currency] = validateQuote(quote.rate, quote.date, now);
  }
  return {
    base: "USD",
    source: "Frankfurter",
    fetchedAt: data.fetchedAt,
    stale: data.stale,
    quotes,
  };
}

const REGION_CURRENCY: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  AU: "AUD",
  CA: "CAD",
  CH: "CHF",
  SG: "SGD",
  MY: "MYR",
  ID: "IDR",
  PH: "PHP",
  TH: "THB",
  VN: "VND",
  IN: "INR",
  PK: "PKR",
  BD: "BDT",
  NG: "NGN",
  KE: "KES",
  BR: "BRL",
  MX: "MXN",
  JP: "JPY",
  KR: "KRW",
  DE: "EUR",
  FR: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
  BE: "EUR",
  AT: "EUR",
  PT: "EUR",
  IE: "EUR",
  FI: "EUR",
  GR: "EUR",
  LU: "EUR",
  SK: "EUR",
  SI: "EUR",
  EE: "EUR",
  LV: "EUR",
  LT: "EUR",
  CY: "EUR",
  MT: "EUR",
  HR: "EUR",
};

export function currencyForLocale(locale: string | undefined): string | null {
  if (!locale) return null;
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region ? (REGION_CURRENCY[region] ?? null) : null;
  } catch {
    return null;
  }
}

function parseDecimalAmount(amount: string): number | null {
  const text = amount.trim();
  if (!/^\d{1,14}(\.\d{0,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (
    BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0")) >
    18446744073709551615n
  )
    return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function fxEstimateText(
  amount: string,
  currency: FxCurrency,
  snapshot: FxSnapshot,
  locale = "en-US",
  now = Date.now(),
): string | null {
  if (currency === "USD") return null;
  const units = parseDecimalAmount(amount);
  if (units === null) return null;
  try {
    const quote = parseFxSnapshot(snapshot, now).quotes[currency];
    if (!quote) return null;
    const value = units * quote.rate;
    const formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: value >= 1000 ? 0 : 2,
    }).format(value);
    return `≈ ${formatted}`;
  } catch {
    return null;
  }
}
