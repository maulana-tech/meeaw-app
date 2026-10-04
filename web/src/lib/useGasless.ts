"use client";

import { useEffect, useState } from "react";
import { gaslessEnabled } from "./chain";

/** null while unknown, then whether the server relayer pays gas. */
export function useGasless(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    gaslessEnabled().then((value) => {
      if (!cancelled) setEnabled(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}
