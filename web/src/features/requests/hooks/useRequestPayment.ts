"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "../../../components/WalletProvider";
import { getAccount, scanMyNotes } from "../../../lib/notes";
import { resolvePool } from "../../../lib/pools";
import { api } from "../../../trpc/client";
import { trpc } from "../../../trpc/react";
import { readPaymentStatus, watchPaymentStatus } from "../paymentStatusMonitor";
import {
  buildMergeSubmission,
  buildPaymentSubmission,
  buildSplitSubmission,
} from "../requestProofs";
import { selectFunding } from "../selectFunding";
import type {
  PaymentOperation,
  PaymentRequest,
  SignedRequest,
  SignedSubmission,
} from "../types";
export function useRequestPayment(request: PaymentRequest | null) {
  const wallet = useWallet(),
    [operation, setOperation] = useState<PaymentOperation | null>(null),
    [working, setWorking] = useState(false),
    [error, setError] = useState<string | null>(null),
    run = useRef(0);
  const cache = trpc.useUtils();
  const currentAddress = wallet.address.toLowerCase();
  const requestId = request?.id;
  const storedOperationId = request?.operationId;
  const requestStatus = request?.status;
  const selectionKey = `${currentAddress}:${requestId ?? ""}`;
  const identity = useRef(currentAddress);
  identity.current = currentAddress;
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false),
    [statusError, setStatusError] = useState<string | null>(null);
  const statusCheck = useRef<{
    seq: number;
    promise: Promise<PaymentOperation | null>;
  } | null>(null);
  const notified = useRef("");
  useEffect(() => {
    void selectionKey;
    run.current++;
    setWorking(false);
    setError(null);
    setOperation(null);
    setChecking(false);
    setStatusError(null);
  }, [selectionKey]);
  const refresh = useCallback(
    async (id: string): Promise<PaymentOperation | null> => {
      const seq = run.current;
      if (statusCheck.current?.seq === seq) return statusCheck.current.promise;
      setChecking(true);
      const promise = (async () => {
        try {
          const result = (await readPaymentStatus(
            currentAddress,
            id,
          )) as unknown as PaymentOperation | null;
          if (
            run.current === seq &&
            identity.current === currentAddress &&
            requestId === id
          ) {
            setStatusError(null);
            if (result?.requestId === id) setOperation(result);
          }
          return result;
        } catch {
          if (run.current === seq)
            setStatusError(
              "Status could not be checked. We will keep checking automatically.",
            );
          return null;
        } finally {
          if (run.current === seq) {
            setChecking(false);
            statusCheck.current = null;
          }
        }
      })();
      statusCheck.current = { seq, promise };
      return promise;
    },
    [requestId, currentAddress],
  );
  const phase = operation?.phase;
  useEffect(() => {
    if (
      !requestId ||
      working ||
      requestStatus !== "pending" ||
      phase === "confirmed" ||
      phase === "failed" ||
      phase === "preparing"
    )
      return;
    if (!storedOperationId && !phase) return;
    const seq = run.current;
    return watchPaymentStatus(currentAddress, requestId, (update) => {
      if (run.current !== seq || identity.current !== currentAddress) return;
      setChecking(update.checking);
      setStatusError(update.error);
      if (update.operation?.requestId === requestId)
        setOperation(update.operation);
    });
  }, [
    requestId,
    storedOperationId,
    requestStatus,
    phase,
    working,
    currentAddress,
  ]);
  useEffect(() => {
    if (!operation || (phase !== "confirmed" && phase !== "failed")) return;
    const key = `${currentAddress}:${operation.id}:${phase}`;
    if (notified.current === key) return;
    notified.current = key;
    window.dispatchEvent(new Event("mawee:balance-changed"));
    void Promise.all([
      cache.requests.get.invalidate(),
      cache.requests.pendingCount.invalidate(),
      cache.requests.listReceived.invalidate(),
      cache.requests.listSent.invalidate(),
      queryClient.invalidateQueries({ queryKey: ["payment-requests"] }),
      queryClient.invalidateQueries({ queryKey: ["payment-request-count"] }),
    ]).catch(() => {});
  }, [operation, phase, currentAddress, cache, queryClient]);
  const pay = useCallback(async () => {
    if (!request || !wallet.accountUnlocked)
      throw new Error("Unlock your account before paying this request.");
    const seq = ++run.current;
    setWorking(true);
    setError(null);
    const tick = (o: PaymentOperation) => {
      if (run.current === seq) setOperation(o);
    };
    try {
      const account = getAccount(),
        pool = resolvePool(request.pool),
        signer = await wallet.getSigner();
      if (run.current !== seq) return null;
      if (
        !account ||
        signer.address.toLowerCase() !==
          request.addressee.wallet.toLowerCase() ||
        pool.scope !== request.pool ||
        !pool.requestCapable
      )
        throw new Error(
          "This request is not available from your current account and pool.",
        );
      let live = await api.requests.get.query({ id: request.id });
      if (run.current !== seq) return null;
      if (live.status !== "pending")
        throw new Error("This request is no longer pending.");
      const signed = {
        version: live.version,
        id: live.id,
        pool: live.pool,
        requester: live.requester,
        addressee: live.addressee,
        createdAt: live.createdAt,
        recipientCommitment: live.recipientCommitment,
        requesterEnvelope: live.requesterEnvelope,
        addresseeEnvelope: live.addresseeEnvelope,
        signature: live.signature,
      } as unknown as SignedRequest;
      const { openRequest } = await import("../requestCrypto");
      const payload = await openRequest(signed, account, pool);
      if (run.current !== seq) return null;
      let scan = await scanMyNotes(account, {
        pool,
        includeRequestRecovery: true,
        includeTransferRecovery: true,
      });
      if (run.current !== seq) return null;
      if (scan.health !== "healthy")
        throw new Error(
          "Your private balance is still syncing. Try again shortly.",
        );
      let active: PaymentOperation | null =
        live.operationId && operation?.id === live.operationId
          ? operation
          : null;
      if (!active && !live.operationId) {
        selectFunding(scan.notes, BigInt(payload.amount), pool.scope);
        active = (await api.requests.beginPayment.mutate({
          id: live.id,
          revision: live.revision,
          attemptId: crypto.randomUUID(),
        })) as unknown as PaymentOperation;
        tick(active);
        if (run.current !== seq) return active;
      }
      if (live.operationId) {
        active = await refresh(live.id);
        if (run.current !== seq) return active;
      }
      if (!active) {
        live = await api.requests.get.query({ id: live.id });
        if (run.current !== seq) return null;
        active = live.operationId ? await refresh(live.id) : null;
        if (run.current !== seq) return active;
      }
      if (!active && !live.operationId) {
        active = (await api.requests.beginPayment.mutate({
          id: live.id,
          revision: live.revision,
          attemptId: crypto.randomUUID(),
        })) as unknown as PaymentOperation;
        tick(active);
        if (run.current !== seq) return active;
      }
      if (!active)
        throw new Error(
          "Payment progress is temporarily unavailable. Refresh and try again.",
        );
      while (run.current === seq) {
        if (active.phase === "confirmed" || active.phase === "failed") break;
        if (active.phase === "preparing") {
          const chosen = selectFunding(
            scan.notes,
            BigInt(payload.amount),
            pool.scope,
          );
          let body: SignedSubmission;
          if (
            chosen.length === 1 &&
            chosen[0].amount >= BigInt(payload.amount) &&
            ((active.nextStep === 0 && active.completedMerges === 0) ||
              active.completedMerges > 0)
          ) {
            body = await buildPaymentSubmission({
              record: signed,
              payload,
              operation: active,
              account,
              scan,
              inputIndex: chosen[0].leafIndex,
              signer,
              pool,
            });
          } else {
            if (chosen.length < 2)
              throw new Error(
                "Your private balance changed. Refresh and continue payment.",
              );
            const first = chosen[0],
              second = chosen[1];
            if (first.amount + second.amount > (1n << 64n) - 1n) {
              const contribution = BigInt(payload.amount) - first.amount;
              if (contribution <= 0n || contribution >= second.amount)
                throw new Error(
                  "Your private balance changed. Refresh and continue payment.",
                );
              body = await buildSplitSubmission({
                record: signed,
                operation: active,
                account,
                scan,
                inputIndex: second.leafIndex,
                splitAmount: contribution,
                signer,
                pool,
              });
            } else
              body = await buildMergeSubmission({
                record: signed,
                operation: active,
                account,
                scan,
                inputIndices: [first.leafIndex, second.leafIndex],
                signer,
                pool,
              });
          }
          // Proof generation can outlive an account switch. The local proof is
          // harmless, but do not submit it under a different wallet session.
          if (run.current !== seq) return active;
          const next = (body.kind === "payment"
            ? await api.requests.submitPayment.mutate(
                body as unknown as Parameters<
                  typeof api.requests.submitPayment.mutate
                >[0],
              )
            : await api.requests.submitConsolidation.mutate(
                body as unknown as Parameters<
                  typeof api.requests.submitConsolidation.mutate
                >[0],
              )) as unknown as PaymentOperation;
          tick(next);
          active = next;
          if (
            next.phase === "needsReconciliation" ||
            next.phase === "submitted" ||
            next.phase === "submitting"
          )
            break;
        } else if (
          active.phase === "submitting" ||
          active.phase === "submitted" ||
          active.phase === "needsReconciliation"
        ) {
          await new Promise((r) => setTimeout(r, 3000));
          if (run.current !== seq) break;
          const next = await refresh(live.id);
          if (run.current !== seq) break;
          if (!next) break;
          active = next;
          live = await api.requests.get.query({ id: live.id });
        }
        if (active.phase === "preparing" && active.nextStep > 0) {
          scan = await scanMyNotes(account, {
            pool,
            includeRequestRecovery: true,
            includeTransferRecovery: true,
          });
          if (scan.health !== "healthy") break;
          continue;
        }
        if (active.phase === "confirmed" || active.phase === "failed") break;
      }
      await cache.requests.get.invalidate();
      await cache.requests.pendingCount.invalidate();
      await cache.requests.listReceived.invalidate();
      await cache.requests.listSent.invalidate();
      if (active.phase === "failed")
        throw new Error(
          "This attempt failed before payment completed. Your private funds remain in your account.",
        );
      return active;
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Payment couldn't be prepared. Refresh and try again.";
      setError(message);
      throw new Error(message);
    } finally {
      if (run.current === seq) setWorking(false);
    }
  }, [
    request,
    wallet.accountUnlocked,
    wallet.getSigner,
    operation,
    cache,
    refresh,
  ]);
  return {
    operation,
    working,
    error,
    statusError,
    checking,
    pay,
    refresh: () => (request ? refresh(request.id) : Promise.resolve(null)),
  };
}
