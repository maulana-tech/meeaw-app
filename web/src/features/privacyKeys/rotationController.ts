import type { Hex } from "viem";
import type { Signer } from "../../lib/chain";
import { derivePrivacyAccount } from "./keyDerivation";
import {
  derivePrivacyKeyring,
  erasePrivacyAccounts,
  privacyAccountPubkeys,
  samePublicKeys,
} from "./keyRing";
import {
  type RegistryAuthorization,
  registryAuthorizationTypedData,
} from "./registryRotation";
import { rotationTypedData } from "./rotationTypedData";
import type {
  LocalPrivacyKeyring,
  PrivacyKeyState,
  PublicKeyPair,
  RotationIntent,
  RotationOperation,
} from "./types";

export type RotationReview = {
  from: number;
  to: number;
  newKeys: PublicKeyPair;
  state: PrivacyKeyState;
};
export type RotationPorts = {
  owner: Hex;
  username: string;
  method: "pin" | "passkey";
  isCurrent(): boolean;
  state(): Promise<PrivacyKeyState | null>;
  verifiedState(): Promise<PrivacyKeyState | null>;
  bootstrap(keys: PublicKeyPair): Promise<PrivacyKeyState>;
  root(pin?: string): Promise<Uint8Array>;
  signer(): Promise<Signer>;
  nonce(): Promise<string>;
  sponsored(): Promise<boolean>;
  prepare(intent: RotationIntent): Promise<RotationOperation>;
  submit(
    id: string,
    authorization: RegistryAuthorization,
    mode: "relay" | "wallet",
  ): Promise<RotationOperation>;
  wallet(
    op: RotationOperation,
    authorization: RegistryAuthorization,
    onSubmitted: (hash: Hex) => Promise<void>,
  ): Promise<Hex>;
  mark(id: string, hash: Hex): Promise<RotationOperation>;
  abort?(id: string): Promise<RotationOperation>;
  reconcile(id: string): Promise<RotationOperation>;
  install(ring: LocalPrivacyKeyring): void;
};
export function createPrivacyRotationController(ports: RotationPorts) {
  let epoch = 0;
  let review: RotationReview | null = null,
    candidate: LocalPrivacyKeyring | null = null,
    operation: RotationOperation | null = null,
    intent: RotationIntent | null = null;
  const current = (at = epoch) => {
    if (at !== epoch || !ports.isCurrent())
      throw new Error(
        "Wallet or lock state changed. Review this rotation again.",
      );
  };
  const dispose = () => {
    epoch++;
    if (candidate) erasePrivacyAccounts(candidate.accounts);
    candidate = null;
    review = null;
  };
  const install = async (at: number) => {
    if (operation?.phase !== "confirmed" || !candidate) return;
    const state = await ports.verifiedState();
    current(at);
    if (
      !state ||
      state.pending ||
      state.activeGeneration !== candidate.activeGeneration ||
      state.owner !== candidate.owner ||
      state.registry !== candidate.registry ||
      !samePublicKeys(
        state.generations[state.activeGeneration],
        review?.newKeys ?? state.generations[0],
      )
    )
      throw new Error(
        "Confirmed privacy key history is still synchronizing. Check again.",
      );
    const verified: LocalPrivacyKeyring = {
      ...candidate,
      revision: state.revision,
    };
    candidate = null;
    ports.install(verified);
  };
  return {
    async prepare(pin?: string): Promise<RotationReview> {
      current();
      dispose();
      intent = null;
      operation = null;
      const at = epoch;
      let state = await ports.state();
      current(at);
      if (state?.pending) {
        operation = state.pending;
        throw new Error(
          "A rotation is already pending. Check its status before rotating again.",
        );
      }
      const root = await ports.root(pin);
      try {
        current(at);
        if (!state) {
          const original = derivePrivacyAccount(root, 0);
          try {
            state = await ports.bootstrap(
              await privacyAccountPubkeys(original),
            );
          } finally {
            original.viewSk.fill(0);
            original.ownerSecret = 0n;
          }
        }
        const verified = await ports.verifiedState();
        current(at);
        if (
          !verified ||
          verified.owner.toLowerCase() !== ports.owner.toLowerCase() ||
          verified.username !== ports.username ||
          verified.pending ||
          verified.activeGeneration >= 63
        )
          throw new Error(
            "Your privacy key history is unavailable, pending, or at its rotation limit.",
          );
        const next = verified.activeGeneration + 1,
          account = derivePrivacyAccount(root, next);
        let keys: PublicKeyPair;
        try {
          keys = await privacyAccountPubkeys(account);
        } finally {
          account.viewSk.fill(0);
          account.ownerSecret = 0n;
        }
        const future: PrivacyKeyState = {
          ...verified,
          revision: verified.revision + 1,
          activeGeneration: next,
          generations: [
            ...verified.generations,
            {
              id: next,
              ...keys,
              evidence: {
                block: 0,
                blockHash: `0x${"0".repeat(64)}`,
                txHash: null,
              },
            },
          ],
        };
        candidate = await derivePrivacyKeyring(root, future);
        current(at);
        review = {
          from: verified.activeGeneration,
          to: next,
          newKeys: keys,
          state: verified,
        };
        return review;
      } catch (error) {
        if (at === epoch) dispose();
        throw error;
      } finally {
        root.fill(0);
      }
    },
    async confirm(): Promise<RotationOperation> {
      const at = epoch;
      current();
      if (!review || !candidate)
        throw new Error("Review your privacy rotation first.");
      const signer = await ports.signer();
      current(at);
      if (signer.address.toLowerCase() !== ports.owner.toLowerCase())
        throw new Error("The signing wallet changed.");
      if (!intent) {
        const unsigned = {
          version: 1 as const,
          id: crypto.randomUUID(),
          owner: ports.owner,
          registry: review.state.registry,
          username: ports.username,
          expectedRevision: review.state.revision,
          from: review.from,
          to: review.to,
          oldKeys: review.state.generations[review.from],
          newKeys: review.newKeys,
          deadline: String(Math.floor(Date.now() / 1000) + 600),
        };
        const signature = await signer.walletClient.signTypedData({
          ...rotationTypedData(unsigned),
          account: signer.walletClient.account ?? signer.address,
        });
        current(at);
        intent = { ...unsigned, signature };
      }
      if (!operation) {
        try {
          operation = await ports.prepare(intent);
        } catch (error) {
          operation = (await ports.state())?.pending ?? null;
          if (!operation || operation.intent.id !== intent.id) throw error;
        }
      }
      if (
        at !== epoch &&
        operation.phase === "prepared" &&
        !operation.registryAuthorization &&
        !operation.txHash &&
        ports.abort
      ) {
        operation = await ports.abort(operation.intent.id);
      }
      current(at);
      const authorization = operation.registryAuthorization ?? {
        nonce: await ports.nonce(),
        deadline: intent.deadline,
        signature: "0x" as Hex,
      };
      if (!operation.registryAuthorization) {
        authorization.signature = await signer.walletClient.signTypedData({
          ...registryAuthorizationTypedData(intent, authorization),
          account: signer.walletClient.account ?? signer.address,
        });
        current(at);
      }
      const sponsored = await ports.sponsored();
      current(at);
      operation = await ports.submit(
        intent.id,
        authorization,
        sponsored ? "relay" : "wallet",
      );
      current(at);
      if (!sponsored && !operation.txHash && operation.phase !== "confirmed")
        await ports.wallet(operation, authorization, async (hash) => {
          operation = await ports.mark(
            intent?.id ?? operation?.intent.id ?? "",
            hash,
          );
        });
      await install(at);
      return operation;
    },
    async check(): Promise<RotationOperation | null> {
      const at = epoch;
      current(at);
      if (!operation) operation = (await ports.state())?.pending ?? null;
      current(at);
      if (!operation) return null;
      operation = await ports.reconcile(operation.intent.id);
      current(at);
      await install(at);
      return operation;
    },
    pending: () => operation,
    clearTerminal: (terminal?: RotationOperation) => {
      if (terminal) {
        if (
          terminal.intent.id !== operation?.intent.id ||
          (terminal.phase !== "confirmed" && terminal.phase !== "failed")
        )
          throw new Error(
            "The rotation completion response does not match this operation.",
          );
        operation = terminal;
      }
      if (operation?.phase === "confirmed" || operation?.phase === "failed") {
        operation = null;
        intent = null;
      }
    },
    dispose,
  };
}
