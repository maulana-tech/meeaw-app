"use client";
import { CheckCircle2, CircleAlert, Loader } from "lucide-react";
import { useRef } from "react";
import { useReceiptVerification } from "../../features/receipts/useReceiptVerification";
import { ASSETS } from "../../lib/assets";
import { formatAssetUnits } from "../../lib/paymentAsset";
import { dashButtonPrimary, dashButtonSecondary } from "../dashboard/styles";

const explanations: Record<string, string> = {
  "file-too-large":
    "This file is too large. Choose a receipt JSON under 64 KiB.",
  "malformed-receipt": "The file does not contain a valid Meaw receipt.",
  "proof-shape-mismatch":
    "The proof path, payment index, or identifiers do not agree.",
  "asset-label-mismatch": "The amount or asset label does not match the proof.",
  "proof-mismatch": "The disclosed amount and proof do not agree.",
  "snapshot-mismatch": "The receipt does not match the historical pool state.",
  "anchor-missing":
    "Local proof valid; historical chain anchor missing. Ask the issuer to reissue it from History.",
  "unsupported-version":
    "This receipt version is not supported by this verifier.",
  "unsupported-pool": "This pool is not supported by this verifier.",
  "unsupported-network": "This network is not supported by this verifier.",
  "legacy-asset-missing":
    "This legacy receipt does not identify a supported asset.",
  "historical-data-unavailable":
    "Historical chain data is unavailable. Retry or ask the issuer to check their RPC provider.",
  "rpc-timeout": "The chain check timed out. Try again.",
  "insufficient-confirmations":
    "The anchored block needs more confirmations. Try again shortly.",
  "reorg-during-read": "The chain changed during this check. Try again.",
  "block-hash-mismatch":
    "The receipt's block hash differs from the canonical chain.",
  "chain-mismatch": "The chain provider returned a different network.",
  "token-mismatch": "The pool token differs from the configured asset.",
  "token-precision-mismatch":
    "The token precision differs from the configured asset.",
  "rate-limited": "Too many checks. Try again in a minute.",
  busy: "The verifier is busy. Try again shortly.",
  "future-block": "The anchored block is not available yet.",
  "block-before-deployment":
    "The anchor predates the configured pool deployment.",
};
export function VerifyReceipt() {
  const { busy, bundle, result, loadFile, retry, clear } =
      useReceiptVerification(),
    input = useRef<HTMLInputElement>(null);
  const title = busy
    ? "Checking receipt…"
    : result?.status === "verified"
      ? "Verified on chain"
      : result?.status === "invalid"
        ? "Invalid proof"
        : result?.status === "unavailable"
          ? "Unable to verify"
          : null;
  const Icon = result?.status === "verified" ? CheckCircle2 : CircleAlert;
  const message =
    result && "reason" in result
      ? (explanations[result.reason] ?? "This receipt could not be verified.")
      : null;
  function remove() {
    clear();
    if (input.current) input.current.value = "";
  }
  return (
    <section
      className="w-full min-w-0 rounded-(--dash-radius) border border-(--dash-line-solid) bg-(--dash-surface) p-6 text-(--dash-fg) sm:p-8"
      aria-label="Receipt verification"
    >
      <div className="mb-7 max-w-xl">
        <p className="dashboard-tile-title flex items-center gap-2">
          <span
            className="size-1.5 rounded-full bg-(--dash-accent)"
            aria-hidden="true"
          />
          Meaw Verify
        </p>
        <h1 className="mt-5 text-3xl font-normal tracking-tight">
          Check a payment receipt
        </h1>
        <p className="mt-3 text-sm leading-6 text-(--dash-ash)">
          Choose the JSON proof shared with the PDF. Its private details stay in
          this browser; only public pool and block coordinates are sent for the
          chain check.
        </p>
      </div>
      <label
        className="grid gap-2 text-sm font-semibold"
        htmlFor="receipt-json"
      >
        Receipt JSON
        <input
          ref={input}
          id="receipt-json"
          type="file"
          accept=".json,application/json"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            if (file) void loadFile(file);
            else remove();
          }}
          className="min-h-14 w-full min-w-0 cursor-pointer rounded-(--dash-radius-sm) border border-dashed border-(--dash-line-strong) bg-(--dash-tint) px-3 py-3 text-sm text-(--dash-ash) transition-colors hover:border-(--dash-fg) file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-(--dash-fg) file:px-4 file:py-2 file:text-xs file:font-semibold file:tracking-[0.08em] file:text-(--dash-surface) file:uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--dash-fg)"
        />
      </label>
      <p className="mt-2 text-xs text-(--dash-ash)">
        JSON only · maximum 64 KiB · no account or wallet required
      </p>
      {(busy || result) && (
        <div
          aria-live="polite"
          aria-atomic="true"
          className="mt-7 border-t border-(--dash-line) pt-6"
        >
          <div className="flex items-center gap-2">
            {busy ? (
              <Loader
                className="size-5 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Icon
                className={`size-5 ${result?.status === "verified" ? "text-(--dash-fg)" : result?.status === "invalid" ? "text-destructive" : "text-(--dash-ash)"}`}
                aria-hidden="true"
              />
            )}
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>
          {message && (
            <p className="mt-2 text-sm leading-6 text-(--dash-ash)">
              {message}
            </p>
          )}
          {result?.status === "verified" && (
            <p className="mt-2 text-sm leading-6 text-(--dash-ash)">
              The disclosed note matches the pool at its confirmed historical
              block. Compare the fingerprint below with the PDF.
            </p>
          )}
        </div>
      )}
      {bundle && (
        <div className="mt-6 grid min-w-0 gap-5">
          <div>
            <p className="text-xs text-(--dash-ash)">Disclosed amount</p>
            <p className="mt-1 text-3xl font-normal tracking-tight tabular-nums">
              {formatAssetUnits(
                BigInt(bundle.amount),
                bundle.tokenDecimals ?? 6,
              )}{" "}
              {ASSETS[bundle.asset ?? "USDC"].label}
            </p>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-(--dash-ash)">Username</dt>
              <dd className="mt-1 break-words">
                {bundle.username ? `@${bundle.username}` : "Not supplied"}
              </dd>
              <dd className="mt-1 text-xs text-(--dash-ash)">
                Provided by receipt issuer
              </dd>
            </div>
            <div>
              <dt className="text-(--dash-ash)">Receipt generated</dt>
              <dd className="mt-1 break-words">{bundle.disclosedAt}</dd>
            </div>
            <div>
              <dt className="text-(--dash-ash)">Network</dt>
              <dd className="mt-1">
                {bundle.network === "eip155:143"
                  ? "Monad Mainnet"
                  : bundle.network === "eip155:10143"
                    ? "Monad Testnet · test funds"
                    : `${bundle.network} · test network`}
              </dd>
            </div>
            {bundle.version === 2 && (
              <div>
                <dt className="text-(--dash-ash)">Checked block</dt>
                <dd className="mt-1 tabular-nums">
                  {bundle.anchor.blockNumber.toLocaleString("en-US")}
                </dd>
              </div>
            )}
          </dl>
          {result && "identity" in result && result.identity && (
            <div className="min-w-0">
              <p className="text-xs text-(--dash-ash)">Proof fingerprint</p>
              <code className="mt-2 block break-all rounded-lg border border-(--dash-line) p-3 text-xs leading-6">
                {result.identity.fingerprint}
              </code>
              <p className="mt-2 font-mono text-xs text-(--dash-ash)">
                {result.identity.reference}
              </p>
            </div>
          )}
          <details className="min-w-0 border-t border-(--dash-line) pt-4">
            <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--dash-fg)">
              Technical details
            </summary>
            <dl className="mt-3 grid min-w-0 gap-3 text-xs leading-6">
              <div>
                <dt className="text-(--dash-ash)">Pool</dt>
                <dd className="break-all font-mono">{bundle.pool}</dd>
              </div>
              <div>
                <dt className="text-(--dash-ash)">Commitment</dt>
                <dd className="break-all font-mono">{bundle.commitmentHex}</dd>
              </div>
              <div>
                <dt className="text-(--dash-ash)">Checks</dt>
                <dd>
                  Local proof: {result?.local ?? "checking"} · Chain:{" "}
                  {result?.chain ?? "checking"}
                </dd>
              </div>
            </dl>
          </details>
          <p className="text-xs leading-5 text-(--dash-ash)">
            Inclusion does not prove an invoice was paid, the issuer’s identity,
            current ownership, or an unspent balance.
          </p>
        </div>
      )}
      {(busy || result || bundle) && (
        <div className="mt-6 flex flex-wrap gap-3">
          {!busy &&
            bundle?.version === 2 &&
            result?.status === "unavailable" && (
              <button
                type="button"
                onClick={() => void retry()}
                className={dashButtonPrimary}
              >
                Retry verification
              </button>
            )}
          <button
            type="button"
            className={dashButtonSecondary}
            onClick={remove}
          >
            Remove receipt
          </button>
        </div>
      )}
    </section>
  );
}
