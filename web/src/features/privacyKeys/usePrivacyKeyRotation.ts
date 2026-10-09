"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Hex } from "viem";
import { useWallet } from "../../components/WalletProvider";
import { maweeRegistryAbi } from "../../lib/abi";
import { gaslessEnabled, publicClient, registryAddress } from "../../lib/chain";
import { api } from "../../trpc/client";
import {
  reauthenticatePrivacyRoot,
  unlockPrivacyKeyring,
} from "./reauthenticate";
import { submitRegistryRotationWallet } from "./registryRotation";
import {
  createPrivacyRotationController,
  type RotationReview,
} from "./rotationController";
import { getPrivacyKeyring, installPrivacyKeyring } from "./session";
import type { PrivacyKeyState, RotationOperation } from "./types";

export function usePrivacyKeyRotation() {
  const wallet = useWallet(),
    identity = `${wallet.address.toLowerCase()}:${wallet.accountUnlocked}:${wallet.username}:${wallet.recoveryMethod}`;
  const busy = useRef(false);
  const current = useRef(identity);
  current.current = identity;
  const [state, setState] = useState<PrivacyKeyState | null>(null),
    [operation, setOperation] = useState<RotationOperation | null>(null),
    [review, setReview] = useState<RotationReview | null>(null),
    [isWorking, setWorking] = useState(false),
    [error, setError] = useState<string | null>(null);
  const controller = useMemo(
    () =>
      createPrivacyRotationController({
        owner: wallet.address.toLowerCase() as Hex,
        username: wallet.username ?? "",
        method: wallet.recoveryMethod ?? "pin",
        isCurrent: () => current.current === identity && wallet.accountUnlocked,
        state: () => api.privacyKeys.state.query(),
        verifiedState: () => api.privacyKeys.verifiedState.query(),
        bootstrap: (keys) => api.privacyKeys.bootstrap.mutate({ keys }),
        root: (pin) =>
          reauthenticatePrivacyRoot(wallet.recoveryMethod ?? "pin", pin),
        signer: wallet.getSigner,
        nonce: async () =>
          String(
            await publicClient.readContract({
              address: registryAddress,
              abi: maweeRegistryAbi,
              functionName: "nonces",
              args: [wallet.address as Hex],
            }),
          ),
        sponsored: gaslessEnabled,
        prepare: (intent) => api.privacyKeys.prepare.mutate(intent),
        submit: (id, authorization, mode) =>
          api.privacyKeys.submit.mutate({ id, authorization, mode }),
        wallet: async (op, authorization, onSubmitted) =>
          submitRegistryRotationWallet(
            await wallet.getSigner(),
            op,
            authorization,
            onSubmitted,
          ),
        abort: (id) => api.privacyKeys.abort.mutate({ id }),
        mark: (id, txHash) =>
          api.privacyKeys.markSubmitted.mutate({ id, txHash }),
        reconcile: (id) => api.privacyKeys.reconcile.mutate({ id }),
        install: (ring) => {
          installPrivacyKeyring(ring);
          void wallet.refreshPrivacyState();
        },
      }),
    [
      identity,
      wallet.getSigner,
      wallet.refreshPrivacyState,
      wallet.address,
      wallet.username,
      wallet.recoveryMethod,
      wallet.accountUnlocked,
    ],
  );
  const refresh = useCallback(async () => {
    const data = await api.privacyKeys.state.query();
    if (current.current === identity) {
      setState(data);
      setOperation(data?.pending ?? controller.pending());
    }
    return data;
  }, [identity, controller]);
  useEffect(() => {
    current.current = identity;
    setReview(null);
    setError(null);
    setOperation(null);
    if (wallet.address && wallet.username)
      void refresh().catch(() =>
        setError("Privacy key history could not be checked. Try again."),
      );
    return () => {
      current.current = "disposed";
      controller.dispose();
    };
  }, [controller, refresh, wallet.address, wallet.username, identity]);
  const work = useCallback(
    async <T>(action: () => Promise<T>): Promise<T> => {
      if (busy.current)
        throw new Error("A privacy key action is already running.");
      busy.current = true;
      setWorking(true);
      setError(null);
      try {
        return await action();
      } catch (cause) {
        if (current.current === identity) await refresh().catch(() => null);
        if (current.current === identity)
          setError(
            cause instanceof Error
              ? cause.message
              : "Privacy keys could not be updated. Check again.",
          );
        throw cause;
      } finally {
        busy.current = false;
        if (current.current === identity) setWorking(false);
      }
    },
    [identity, refresh],
  );
  const prepare = (pin?: string) =>
    work(async () => {
      if (!wallet.username || !wallet.recoveryMethod || !wallet.accountUnlocked)
        throw new Error(
          "Claim your username and unlock with your existing recovery first.",
        );
      const data = await controller.prepare(pin);
      if (current.current === identity) setReview(data);
      await refresh();
      return data;
    });
  const confirm = () =>
    work(async () => {
      const data = await controller.confirm();
      if (current.current === identity) setOperation(data);
      await refresh();
      return data;
    });
  const check = () =>
    work(async () => {
      const data = await controller.check();
      if (current.current === identity) setOperation(data);
      await refresh();
      return data;
    });
  const needsUnlock = Boolean(
    state &&
      (getPrivacyKeyring()?.revision !== state.revision ||
        getPrivacyKeyring()?.activeGeneration !== state.activeGeneration) &&
      !state.pending,
  );
  const unlockUpdatedKeys = (pin?: string) =>
    work(async () => {
      const at = identity;
      const root = await reauthenticatePrivacyRoot(
        wallet.recoveryMethod ?? "pin",
        pin,
      );
      try {
        const verified = await api.privacyKeys.verifiedState.query();
        if (!verified || verified.pending || current.current !== at)
          throw new Error(
            "Privacy key history is still synchronizing. Check again.",
          );
        await unlockPrivacyKeyring(
          root,
          verified,
          () => current.current === at && wallet.accountUnlocked,
        );
        await wallet.refreshPrivacyState();
        await refresh();
      } finally {
        root.fill(0);
      }
    });
  const clear = async () => {
    const pending = controller.pending() ?? operation;
    controller.dispose();
    setReview(null);
    if (
      pending &&
      !pending.registryAuthorization &&
      !pending.txHash &&
      pending.phase === "prepared"
    ) {
      const terminal = await api.privacyKeys.abort.mutate({
        id: pending.intent.id,
      });
      if (controller.pending()) controller.clearTerminal(terminal);
      setOperation(null);
      await refresh();
    } else if (pending?.phase === "confirmed" || pending?.phase === "failed") {
      controller.clearTerminal();
      setOperation(null);
      await refresh();
    }
  };
  return {
    state,
    needsUnlock,
    unlockUpdatedKeys,
    operation,
    review,
    isWorking,
    error,
    prepare,
    confirm,
    check,
    clear,
  };
}
