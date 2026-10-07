"use client";
import { useEffect, useRef, useState } from "react";
import type { LoadReceiptSnapshot } from "./receiptChainTypes";
import { loadReceiptSnapshot } from "./receiptClient";
import { MAX_RECEIPT_BYTES, parseReceiptJson } from "./receiptSchema";
import type { ReceiptBundle, ReceiptVerificationResult } from "./receiptTypes";
import { verifyReceipt } from "./receiptVerification";

const defaultLoad: LoadReceiptSnapshot = loadReceiptSnapshot;
export function useReceiptVerification(
  load: LoadReceiptSnapshot = defaultLoad,
) {
  const [busy, setBusy] = useState(false),
    [bundle, setBundle] = useState<ReceiptBundle | null>(null),
    [result, setResult] = useState<ReceiptVerificationResult | null>(null),
    generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  function clear() {
    generation.current++;
    setBusy(false);
    setBundle(null);
    setResult(null);
  }
  const invalid = (reason: string): ReceiptVerificationResult => ({
    status: "invalid",
    local: "failed",
    chain: "not-run",
    reason,
  });
  async function loadFile(file: File) {
    const at = ++generation.current,
      current = () => generation.current === at;
    setBundle(null);
    setResult(null);
    setBusy(true);
    try {
      if (file.size > MAX_RECEIPT_BYTES) {
        setResult(invalid("file-too-large"));
        return;
      }
      const text = await file.text();
      if (!current()) return;
      const parsed = parseReceiptJson(text);
      if (parsed.status !== "parsed") {
        setResult(
          parsed.status === "invalid"
            ? invalid(parsed.reason)
            : {
                status: "unavailable",
                local: "not-run",
                chain: "unavailable",
                reason: parsed.reason,
              },
        );
        return;
      }
      setBundle(parsed.bundle);
      const checked = await verifyReceipt(
        parsed.bundle,
        parsed.pool,
        load,
        current,
      );
      if (current()) setResult(checked);
    } catch {
      if (current()) setResult(invalid("malformed-receipt"));
    } finally {
      if (current()) setBusy(false);
    }
  }
  async function retry() {
    if (!bundle) return;
    const at = ++generation.current,
      current = () => generation.current === at;
    setBusy(true);
    setResult(null);
    try {
      const parsed = parseReceiptJson(JSON.stringify(bundle));
      if (parsed.status !== "parsed") {
        if (current()) {
          setBundle(null);
          setResult({
            status: "unavailable",
            local: "not-run",
            chain: "unavailable",
            reason: "unsupported-pool",
          });
        }
        return;
      }
      const checked = await verifyReceipt(
        parsed.bundle,
        parsed.pool,
        load,
        current,
      );
      if (current()) setResult(checked);
    } catch {
      if (current())
        setResult({
          status: "unavailable",
          local: "not-run",
          chain: "unavailable",
          reason: "historical-data-unavailable",
        });
    } finally {
      if (current()) setBusy(false);
    }
  }
  return { busy, bundle, result, loadFile, retry, clear };
}
