import { api } from "../../trpc/client";
import type { PaymentOperation } from "./types";

type Update = {
  operation?: PaymentOperation | null;
  checking: boolean;
  error: string | null;
};
type Entry = {
  id: string;
  startedAt: number;
  listeners: Set<(update: Update) => void>;
  timer?: ReturnType<typeof setTimeout>;
  pending?: Promise<PaymentOperation | null>;
};
const entries = new Map<string, Entry>();
function entryFor(owner: string, id: string) {
  const key = `${owner.toLowerCase()}:${id}`;
  let entry = entries.get(key);
  if (!entry) {
    entry = { id, startedAt: Date.now(), listeners: new Set() };
    entries.set(key, entry);
  }
  return { key, entry };
}
function notify(entry: Entry, update: Update) {
  for (const listener of entry.listeners) listener(update);
}
async function check(entry: Entry): Promise<PaymentOperation | null> {
  if (entry.pending) return entry.pending;
  clearTimeout(entry.timer);
  entry.timer = undefined;
  notify(entry, { checking: true, error: null });
  entry.pending = (async () => {
    let result: PaymentOperation | null = null;
    try {
      result = (await api.requests.paymentStatus.query({
        id: entry.id,
      })) as PaymentOperation | null;
      if (result && result.requestId !== entry.id)
        throw new Error("Unexpected payment identity.");
      const updatedAt = result ? Date.parse(result.updatedAt) : NaN;
      if (Number.isFinite(updatedAt))
        entry.startedAt = Math.min(entry.startedAt, updatedAt);
      notify(entry, { operation: result, checking: false, error: null });
      return result;
    } catch {
      result = null;
      notify(entry, {
        checking: false,
        error:
          "Status could not be checked. We will keep checking automatically.",
      });
      return null;
    } finally {
      entry.pending = undefined;
      if (
        entry.listeners.size &&
        result?.phase !== "confirmed" &&
        result?.phase !== "failed" &&
        result?.phase !== "preparing"
      ) {
        const interval = Date.now() - entry.startedAt < 30_000 ? 3_000 : 10_000;
        entry.timer = setTimeout(() => void check(entry), interval);
      }
    }
  })();
  return entry.pending;
}
export function watchPaymentStatus(
  owner: string,
  id: string,
  listener: (update: Update) => void,
) {
  const { key, entry } = entryFor(owner, id);
  entry.listeners.add(listener);
  if (!entry.pending && !entry.timer)
    entry.timer = setTimeout(() => void check(entry), 0);
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) {
      clearTimeout(entry.timer);
      if (entries.get(key) === entry) entries.delete(key);
    }
  };
}
export async function readPaymentStatus(owner: string, id: string) {
  const { key, entry } = entryFor(owner, id);
  try {
    return await check(entry);
  } finally {
    if (!entry.listeners.size && entries.get(key) === entry)
      entries.delete(key);
  }
}
