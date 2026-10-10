"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "../../../components/WalletProvider";
import { getAccount, scanKeyringNotes, scanMyNotes } from "../../../lib/notes";
import { resolvePool } from "../../../lib/pools";
import { createConfirmationTimer } from "../../../lib/settlement";
import { api } from "../../../trpc/client";
import { accountForParticipant } from "../../privacyKeys/keyRing";
import { getPrivacyKeyring } from "../../privacyKeys/session";
import { runDirectTransfer } from "../directTransferRunner";
import { buildTransferSubmission } from "../transferProofs";
import type { TransferOperation, TransferRecord } from "../types";
export function useDirectTransfer(record: TransferRecord | null) {
  const wallet = useWallet();
  const identity = `${wallet.address.toLowerCase()}:${wallet.accountUnlocked}:${record?.id ?? ""}:${record?.pool ?? ""}`;
  const empty = {
    identity,
    operation: null as TransferOperation | null,
    working: false,
    error: null as string | null,
    settledInMs: null as number | null,
  };
  const [state, setState] = useState(empty);
  const { operation, working, error, settledInMs } =
    state.identity === identity ? state : empty;
  const session = useRef(identity),
    busy = useRef(false),
    auto = useRef(false),
    notified = useRef(""),
    mounted = useRef(true),
    timing = useRef({
      identity,
      timer: createConfirmationTimer(),
      isCurrent: (): boolean => true,
    });
  session.current = identity;
  if (timing.current.identity !== identity)
    timing.current = {
      identity,
      timer: createConfirmationTimer(),
      isCurrent: (): boolean => true,
    };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      timing.current.timer.reset();
    };
  }, []);
  const update = useCallback(
    (change: Partial<typeof empty>) => {
      if (!mounted.current || session.current !== identity) return;
      setState((previous) => ({
        ...(previous.identity === identity
          ? previous
          : {
              identity,
              operation: null,
              working: false,
              error: null,
              settledInMs: null,
            }),
        ...change,
        identity,
      }));
    },
    [identity],
  );
  const observe = useCallback(
    (next: TransferOperation) => {
      if (
        !mounted.current ||
        session.current !== identity ||
        next.transferId !== record?.id ||
        next.id !== record.operationId
      )
        return;
      if (!timing.current.isCurrent()) timing.current.timer.reset();
      const elapsed = timing.current.timer.observe(next);
      setState((previous) => {
        if (
          previous.identity === identity &&
          previous.operation?.phase === "confirmed" &&
          next.phase !== "confirmed"
        )
          return previous;
        return {
          ...(previous.identity === identity
            ? previous
            : { identity, working: false, error: null }),
          identity,
          operation: next,
          settledInMs: elapsed,
          ...(next.phase === "confirmed" ? { error: null } : {}),
        };
      });
    },
    [identity, record],
  );
  useEffect(() => {
    session.current = identity;
    auto.current = false;
    update({ operation: null, working: false, error: null, settledInMs: null });
  }, [identity, update]);
  const continueSend = useCallback(async () => {
    if (!record || busy.current) return null;
    if (!wallet.accountUnlocked)
      throw new Error("Unlock Meaw before continuing.");
    const currentIdentity = session.current,
      activeAccount = getAccount(),
      keyring = getPrivacyKeyring();
    if (!activeAccount) throw new Error("Unlock Meaw before continuing.");
    busy.current = true;
    auto.current = true;
    update({ working: true, error: null });
    const current = () =>
      mounted.current &&
      session.current === currentIdentity &&
      getAccount() === activeAccount &&
      getPrivacyKeyring() === keyring;
    try {
      const pool = resolvePool(record.pool),
        signer = await wallet.getSigner();
      if (!current()) return null;
      const account = keyring
        ? await accountForParticipant(keyring, record.sender)
        : activeAccount;
      return await runDirectTransfer(
        { record, account, pool, signer, ...(keyring ? { keyring } : {}) },
        {
          isCurrent: current,
          abandon: async (op) => {
            if (current() && op.sponsorshipAction)
              await api.sponsorship.cancelUnsigned.mutate({
                actionId: op.sponsorshipAction.actionId,
              });
          },
          operation: () => api.transfers.resume.mutate({ id: record.id }),
          scan: () =>
            keyring
              ? scanKeyringNotes(keyring, pool, {
                  includeRequestRecovery: true,
                  includeTransferRecovery: true,
                })
              : scanMyNotes(account, {
                  pool,
                  includeRequestRecovery: true,
                  includeTransferRecovery: true,
                }),
          build: (operation, scan, action) =>
            buildTransferSubmission(
              {
                record,
                operation,
                account,
                scan,
                pool,
                signer,
                ...(keyring
                  ? {
                      keyring,
                      fundingGeneration: operation.fundingGeneration ?? 0,
                    }
                  : {}),
                isCurrent: current,
              },
              action,
            ),
          submit: (s) => {
            if (current() && s.kind === "payment") {
              timing.current.isCurrent = current;
              timing.current.timer.start(s.operationId);
            }
            return api.transfers.submit.mutate({
              submission: {
                ...s,
                nullifiers: [...s.nullifiers],
                outputs: [...s.outputs],
                proof: {
                  a: [s.proof.a[0], s.proof.a[1]],
                  b: [
                    [s.proof.b[0][0], s.proof.b[0][1]],
                    [s.proof.b[1][0], s.proof.b[1][1]],
                  ],
                  c: [s.proof.c[0], s.proof.c[1]],
                },
              },
            });
          },
          tick: (o) => {
            if (current()) observe(o);
          },
        },
      );
    } catch (e) {
      auto.current = false;
      if (current())
        update({
          error:
            e instanceof Error ? e.message : "The transfer could not continue.",
        });
      return null;
    } finally {
      busy.current = false;
      if (!current()) auto.current = false;
      update({ working: false });
    }
  }, [record, wallet.accountUnlocked, wallet.getSigner, observe, update]);
  const phase = operation?.phase;
  useEffect(() => {
    if (!record || phase === "confirmed" || phase === "failed") return;
    let cancelled = false,
      reading = false;
    const at = identity;
    const refresh = async () => {
      if (reading) return;
      reading = true;
      try {
        const next = await api.transfers.status.query({ id: record.id });
        if (!cancelled && session.current === at) observe(next);
      } catch {
        if (!cancelled && session.current === at)
          update({
            error:
              "Status could not be checked. Reopen the transfer to try again.",
          });
      } finally {
        reading = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [record, identity, phase, observe, update]);
  useEffect(() => {
    if (
      auto.current &&
      operation?.phase === "preparing" &&
      !operation.sponsorshipPause &&
      !working &&
      wallet.accountUnlocked
    )
      void continueSend();
  }, [
    operation?.phase,
    operation?.sponsorshipPause,
    working,
    wallet.accountUnlocked,
    continueSend,
  ]);
  useEffect(() => {
    if (!operation || !["confirmed", "failed"].includes(operation.phase))
      return;
    auto.current = false;
    const id = `${operation.id}:${operation.phase}`;
    if (notified.current === id) return;
    notified.current = id;
    window.dispatchEvent(new Event("mawee:balance-changed"));
    window.dispatchEvent(new Event("mawee:transfers-changed"));
  }, [operation]);
  return {
    operation,
    working,
    error,
    checking: operation === null,
    continueSend,
    settledInMs,
  };
}
