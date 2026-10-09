"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "../../../components/WalletProvider";
import { getAccount, scanKeyringNotes, scanMyNotes } from "../../../lib/notes";
import { resolvePool } from "../../../lib/pools";
import { api } from "../../../trpc/client";
import { accountForParticipant } from "../../privacyKeys/keyRing";
import { getPrivacyKeyring } from "../../privacyKeys/session";
import { runDirectTransfer } from "../directTransferRunner";
import { buildTransferSubmission } from "../transferProofs";
import type { TransferOperation, TransferRecord } from "../types";
export function useDirectTransfer(record: TransferRecord | null) {
  const wallet = useWallet(),
    [operation, setOperation] = useState<TransferOperation | null>(null),
    [working, setWorking] = useState(false),
    [error, setError] = useState<string | null>(null);
  const identity = `${wallet.address.toLowerCase()}:${wallet.accountUnlocked}:${record?.id ?? ""}`,
    session = useRef(identity),
    busy = useRef(false),
    auto = useRef(false),
    notified = useRef("");
  session.current = identity;
  useEffect(() => {
    session.current = identity;
    auto.current = false;
    setOperation(null);
    setError(null);
  }, [identity]);
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
    setWorking(true);
    setError(null);
    const current = () =>
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
          submit: (s) =>
            api.transfers.submit.mutate({
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
            }),
          tick: (o) => {
            if (current()) setOperation(o);
          },
        },
      );
    } catch (e) {
      auto.current = false;
      if (current())
        setError(
          e instanceof Error ? e.message : "The transfer could not continue.",
        );
      return null;
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }, [record, wallet.accountUnlocked, wallet.getSigner]);
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
        if (!cancelled && session.current === at) setOperation(next);
      } catch {
        if (!cancelled)
          setError(
            "Status could not be checked. Reopen the transfer to try again.",
          );
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
  }, [record, identity, phase]);
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
  };
}
