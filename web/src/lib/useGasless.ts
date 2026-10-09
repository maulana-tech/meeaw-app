"use client";

import { useEffect, useState } from "react";
import { gaslessEnabled } from "./chain";

/** null while unknown, then whether the server relayer pays gas. */
export function useGasless(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      gaslessEnabled()
        .then((value) => {
          if (!cancelled) setEnabled(value);
        })
        .catch(() => {
          if (!cancelled) setEnabled(null);
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("mawee:balance-changed", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("mawee:balance-changed", refresh);
    };
  }, []);
  return enabled;
}
