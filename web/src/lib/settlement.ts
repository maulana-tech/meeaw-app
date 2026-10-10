export function formatSettlementSeconds(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 100) return "<0.1 s";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const rounded = Math.round(ms / 1000);
  if (rounded < 60) return `${rounded} s`;
  const minutes = Math.floor(rounded / 60),
    seconds = rounded % 60;
  return seconds ? `${minutes} m ${seconds} s` : `${minutes} m`;
}

export function createConfirmationTimer(clock = () => performance.now()) {
  let started: { id: string; at: number } | null = null;
  let elapsed: number | null = null;
  return {
    start(id: string) {
      if (started?.id === id) return;
      started = { id, at: clock() };
      elapsed = null;
    },
    observe(operation: {
      id: string;
      phase: string;
      txHash: string | null;
    }): number | null {
      if (!started || operation.id !== started.id) return null;
      if (operation.phase === "failed") {
        started = null;
        elapsed = null;
        return null;
      }
      if (operation.phase !== "confirmed" || !operation.txHash) return null;
      if (elapsed === null) {
        const duration = clock() - started.at;
        if (Number.isFinite(duration) && duration >= 0) elapsed = duration;
      }
      return elapsed;
    },
    reset() {
      started = null;
      elapsed = null;
    },
  };
}
