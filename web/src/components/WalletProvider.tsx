"use client";

import {
  type ConnectedWallet,
  useCreateWallet,
  usePrivy,
  useWallets,
} from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DASHBOARD_PATH } from "../lib/auth-routes";
import {
  registerUsernameCache,
  type Signer,
  setUsernamePubkeys,
  usernameOf,
} from "../lib/chain";
import { deriveNoteSecrets, randomMaster } from "../lib/keys";
import {
  accountPubkeys,
  clearLocalAccount,
  deriveAndStoreAccount,
  hasLocalAccount,
  syncLocalAccountIdentity,
} from "../lib/notes";
import { BadPinError } from "../lib/pin-errors";
import { findEmbeddedWallet, privySigner } from "../lib/privy-wallet";
import { api } from "../trpc/client";
import type { PinMode } from "./PinDialog";

type WalletState = {
  address: string;
  connecting: boolean;
  error: string;
  authenticated: boolean;
  username: string | null;
  usernameResolved: boolean;
  sessionReady: boolean;
  setUsername: (u: string | null) => void;
  usernameModalOpen: boolean;
  openUsernameModal: () => void;
  closeUsernameModal: () => void;
  accountUnlocked: boolean;
  pinModalOpen: boolean;
  pinMode: PinMode;
  pinSubmitting: boolean;
  pinError: string;
  submitPin: (pin: string) => Promise<void>;
  closePinModal: () => void;
  promptUnlock: () => void;
  signIn: () => void;
  disconnect: () => Promise<void>;
  /** Signer for the user's embedded wallet on Monad (pays gas, signs writes). */
  getSigner: () => Promise<Signer>;
};

type WalletMapping = { address: string };

const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const userId = user?.id ?? null;
  const [address, setAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const [username, setUsername] = useState<string | null>(null);
  const [usernameResolved, setUsernameResolved] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [usernameModalOpen, setUsernameModalOpen] = useState(false);
  const [accountUnlocked, setAccountUnlocked] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode>("unlock");
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const [pinError, setPinError] = useState("");
  const mappingRef = useRef<WalletMapping | null>(null);
  const pendingMasterRef = useRef<Uint8Array | null>(null);
  const revisionRef = useRef(0);
  const sessionAbortedRef = useRef(false);
  const walletsRef = useRef<readonly ConnectedWallet[]>(wallets);
  const createWalletRef = useRef(createWallet);
  const setupRef = useRef<{
    key: string;
    promise: Promise<{ mapping: WalletMapping; openDashboard: boolean }>;
  } | null>(null);

  walletsRef.current = wallets;
  createWalletRef.current = createWallet;

  const openPinModal = useCallback((mode: PinMode) => {
    setPinMode(mode);
    setPinError("");
    setPinModalOpen(true);
  }, []);

  const routeToDashboard = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      window.location.pathname !== DASHBOARD_PATH
    ) {
      router.replace(DASHBOARD_PATH);
    }
  }, [router]);

  const activateMapping = useCallback(
    async (mapping: WalletMapping) => {
      if (sessionAbortedRef.current) return;
      const escrow = await api.wallets.getEscrow.query();
      if (sessionAbortedRef.current) return;
      mappingRef.current = mapping;
      setAddress(mapping.address);
      if (!escrow) {
        const master = randomMaster();
        pendingMasterRef.current = master;
        deriveAndStoreAccount(master);
        setAccountUnlocked(true);
      } else if (hasLocalAccount()) {
        setAccountUnlocked(true);
      } else {
        openPinModal("unlock");
      }
    },
    [openPinModal],
  );

  useEffect(() => {
    if (!ready || (authenticated && !walletsReady)) return;
    const revision = ++revisionRef.current;
    syncLocalAccountIdentity(authenticated ? userId : null);
    if (!authenticated || !userId) {
      sessionAbortedRef.current = true;
      setupRef.current = null;
      mappingRef.current = null;
      setAddress("");
      setAccountUnlocked(false);
      setSessionReady(true);
      return;
    }

    sessionAbortedRef.current = false;
    let cancelled = false;
    setConnecting(true);
    setError("");
    setSessionReady(false);
    const setupKey = `${userId}:${bootstrapRevision}`;
    if (setupRef.current?.key !== setupKey) {
      setupRef.current = {
        key: setupKey,
        promise: api.wallets.restore.mutate().then(async (restored) => {
          if (restored) return { mapping: restored, openDashboard: true };

          // createOnLogin normally provisions the embedded wallet; create it
          // here for identities that signed up before that was enabled.
          const address =
            findEmbeddedWallet(walletsRef.current)?.address ??
            (await createWalletRef.current()).address;
          const mapping = await api.wallets.bootstrap.mutate({ address });
          return { mapping, openDashboard: true };
        }),
      };
    }
    setupRef.current.promise
      .then(async ({ mapping, openDashboard }) => {
        if (
          cancelled ||
          sessionAbortedRef.current ||
          revisionRef.current !== revision
        )
          return;
        await activateMapping(mapping);
        if (openDashboard) routeToDashboard();
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Privy wallet setup failed.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setConnecting(false);
          setSessionReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    ready,
    walletsReady,
    authenticated,
    userId,
    activateMapping,
    routeToDashboard,
    bootstrapRevision,
  ]);

  useEffect(() => {
    if (!address) {
      setUsername(null);
      setUsernameResolved(false);
      return;
    }
    let cancelled = false;
    setUsernameResolved(false);
    usernameOf(address)
      .then((name) => {
        if (!cancelled) {
          setUsername(name);
          setUsernameResolved(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUsername(null);
          setUsernameResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (
      address &&
      usernameResolved &&
      !username &&
      accountUnlocked &&
      !pinModalOpen
    ) {
      setUsernameModalOpen(true);
    }
  }, [address, usernameResolved, username, accountUnlocked, pinModalOpen]);

  useEffect(() => {
    if (username && pendingMasterRef.current && !usernameModalOpen)
      openPinModal("set");
  }, [username, usernameModalOpen, openPinModal]);

  const getSigner = useCallback(async (): Promise<Signer> => {
    const mapping = mappingRef.current;
    if (!mapping) throw new Error("Sign in first.");
    const wallet = walletsRef.current.find(
      (candidate) =>
        candidate.walletClientType === "privy" &&
        candidate.address.toLowerCase() === mapping.address.toLowerCase(),
    );
    if (!wallet) {
      throw new Error("Your Mawee wallet is still loading. Try again.");
    }
    return privySigner(wallet);
  }, []);

  const signIn = useCallback(() => {
    if (authenticated) setBootstrapRevision((value) => value + 1);
    else login();
  }, [authenticated, login]);

  const submitPin = useCallback(
    async (pin: string) => {
      if (!mappingRef.current) return;
      setPinSubmitting(true);
      setPinError("");
      try {
        if (pinMode === "secure") {
          const master = randomMaster();
          if (username) {
            const account = deriveNoteSecrets(master);
            const { notePubkey, viewPubkey } = await accountPubkeys(account);
            await setUsernamePubkeys(
              await getSigner(),
              username,
              notePubkey,
              viewPubkey,
            );
            try {
              await registerUsernameCache(username);
            } catch (cause) {
              console.warn("re-key on-chain ok but Mongo mirror failed", cause);
            }
          }
          const { serializeEscrow, encryptMaster } = await import(
            "../lib/keys"
          );
          await api.wallets.saveEscrow.mutate(
            serializeEscrow(encryptMaster(master, pin)),
          );
          deriveAndStoreAccount(master);
        } else if (pinMode === "set") {
          const master = pendingMasterRef.current ?? randomMaster();
          const { serializeEscrow, encryptMaster } = await import(
            "../lib/keys"
          );
          await api.wallets.saveEscrow.mutate(
            serializeEscrow(encryptMaster(master, pin)),
          );
          deriveAndStoreAccount(master);
          pendingMasterRef.current = null;
        } else {
          const wire = await api.wallets.getEscrow.query();
          if (!wire) {
            openPinModal("secure");
            return;
          }
          const { decryptMaster, deserializeEscrow } = await import(
            "../lib/keys"
          );
          let master: Uint8Array;
          try {
            master = decryptMaster(deserializeEscrow(wire), pin);
          } catch {
            throw new BadPinError();
          }
          deriveAndStoreAccount(master);
        }
        setAccountUnlocked(true);
        setPinModalOpen(false);
      } catch (cause) {
        setPinError(
          cause instanceof BadPinError
            ? "Incorrect PIN. Try again."
            : cause instanceof Error
              ? cause.message
              : "Something went wrong.",
        );
      } finally {
        setPinSubmitting(false);
      }
    },
    [pinMode, username, openPinModal, getSigner],
  );

  const disconnect = useCallback(async () => {
    revisionRef.current += 1;
    sessionAbortedRef.current = true;
    setupRef.current = null;
    mappingRef.current = null;
    pendingMasterRef.current = null;
    clearLocalAccount();
    syncLocalAccountIdentity(null);
    setAddress("");
    setUsernameModalOpen(false);
    setPinModalOpen(false);
    setAccountUnlocked(false);
    await logout();
    // Privy logout and an already-resolved bootstrap can settle in the same
    // microtask turn. Reassert the disconnected state after logout completes.
    mappingRef.current = null;
    setAddress("");
    setUsernameModalOpen(false);
    setPinModalOpen(false);
    setAccountUnlocked(false);
  }, [logout]);

  const openUsernameModal = useCallback(() => setUsernameModalOpen(true), []);
  const closeUsernameModal = useCallback(() => setUsernameModalOpen(false), []);
  const closePinModal = useCallback(() => {
    if (pinMode !== "set") setPinModalOpen(false);
  }, [pinMode]);
  const promptUnlock = useCallback(
    () => openPinModal("unlock"),
    [openPinModal],
  );

  const value = useMemo<WalletState>(
    () => ({
      address,
      connecting,
      error,
      authenticated,
      username,
      usernameResolved,
      sessionReady,
      setUsername,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      accountUnlocked,
      pinModalOpen,
      pinMode,
      pinSubmitting,
      pinError,
      submitPin,
      closePinModal,
      promptUnlock,
      signIn,
      disconnect,
      getSigner,
    }),
    [
      address,
      connecting,
      error,
      authenticated,
      username,
      usernameResolved,
      sessionReady,
      usernameModalOpen,
      openUsernameModal,
      closeUsernameModal,
      accountUnlocked,
      pinModalOpen,
      pinMode,
      pinSubmitting,
      pinError,
      submitPin,
      closePinModal,
      promptUnlock,
      signIn,
      disconnect,
      getSigner,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within WalletProvider");
  return context;
}
