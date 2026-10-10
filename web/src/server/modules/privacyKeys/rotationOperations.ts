import "server-only";
import { type Hex, keccak256, verifyTypedData } from "viem";
import { samePublicKeys } from "../../../features/privacyKeys/keyRing";
import {
  type RegistryAuthorization,
  registryAuthorizationTypedData,
  registryRotationCalldata,
} from "../../../features/privacyKeys/registryRotation";
import type {
  GenerationEvidence,
  RegistryScope,
  RotationIntent,
  RotationOperation,
} from "../../../features/privacyKeys/types";
import { getDb } from "../../db/mongo";
import type { RelayIntent, RelayResult } from "../../lib/durableRelayer";
import { runtimeSender } from "../../lib/durableRelayer";
import { relayerAddress, relayerConfigured } from "../../lib/relayer";
import { RelayJournal } from "../../lib/relayJournal";
import type { SponsorLedger } from "../sponsorship/ledger.service";
import {
  isSponsorshipError,
  SponsorshipError,
} from "../sponsorship/sponsorship.errors";
import { sponsorshipLedger } from "../sponsorship/sponsorship.service";
import { registerUsernameCache } from "../usernames/usernames.service";
import { currentWallet } from "../wallets/wallets.service";
import { PrivacyKeysRepository } from "./privacyKeys.repository";
import {
  configuredRegistryScope,
  type RegistryReader,
  readRegistry,
  registryConfirmations,
  registryTransactionFinder,
  registryTransactionVerifier,
} from "./registryEvidence";

export type RegistryTransactionResult = {
  state: "confirmed" | "reverted" | "unknown";
  evidence?: GenerationEvidence;
};
type Ports = {
  sponsorship?: { ledger: SponsorLedger; user?: string };
  journal?: Pick<RelayJournal, "read">;
  repository: PrivacyKeysRepository;
  readRegistry: RegistryReader;
  verifyTransaction(
    hash: Hex,
    intent: RotationIntent,
    authorization: RegistryAuthorization,
  ): Promise<RegistryTransactionResult>;
  findTransaction?(
    operation: RotationOperation,
  ): Promise<{ hash: Hex | null; scanned?: GenerationEvidence }>;
  refreshCache(
    username: string,
    keys: RotationIntent["newKeys"],
  ): Promise<void>;
  confirmations: number;
  now(): number;
  relayer: Hex;
  sender: {
    prepare(intent: RelayIntent): Promise<{ txHash: Hex }>;
    broadcast(intent: RelayIntent): Promise<{ txHash: Hex }>;
    reconcile(intent: RelayIntent): Promise<RelayResult>;
  };
};
const conflict = () =>
  new Error("Privacy rotation needs reconciliation before another operation");

export function createRotationOperations(ports: Ports) {
  function relayIntent(op: RotationOperation): RelayIntent {
    const auth = op.registryAuthorization;
    if (!auth) throw conflict();
    const [chainId, target] = op.intent.registry.split(":");
    const operationKey = `privacy-rotation:${op.intent.id}`;
    return {
      operationKey,
      chainId: Number(chainId),
      wallet: ports.relayer,
      to: target as Hex,
      data: registryRotationCalldata(op.intent, auth),
      confirmations: ports.confirmations,
      ...(op.sponsorshipAction
        ? {
            sponsorship: {
              action: op.sponsorshipAction,
              childId: operationKey,
            },
          }
        : {}),
    };
  }
  async function feeReconcile(op: RotationOperation) {
    if (!op.sponsorshipAction) return;
    try {
      await ports.sender.reconcile(relayIntent(op));
    } catch {
      // The wallet journal retains unresolved fee liability independently.
    }
  }
  async function closeSponsor(op: RotationOperation) {
    if (!ports.sponsorship || !op.sponsorshipAction) return;
    await feeReconcile(op);
    try {
      await ports.sponsorship.ledger.closeAction(op.sponsorshipAction);
    } catch (error) {
      if (!isSponsorshipError(error)) throw error;
    }
  }
  const authorize = async (
    owner: Hex,
    registry: RegistryScope,
    id: string,
    authorization: RegistryAuthorization,
  ) => {
    const op = await ports.repository.operation(owner, registry, id);
    if (op.registryAuthorization) {
      if (
        op.registryAuthorization.nonce !== authorization.nonce ||
        op.registryAuthorization.deadline !== authorization.deadline ||
        op.registryAuthorization.signature !== authorization.signature
      )
        throw conflict();
      return op;
    }
    if (
      op.phase !== "prepared" ||
      BigInt(authorization.deadline) <= BigInt(ports.now())
    )
      throw conflict();
    if (
      !(await verifyTypedData({
        ...registryAuthorizationTypedData(op.intent, authorization),
        address: owner,
        signature: authorization.signature,
      }))
    )
      throw conflict();
    const observed = await ports.readRegistry(owner, op.intent.username);
    if (
      observed.scope !== registry ||
      observed.owner.toLowerCase() !== owner.toLowerCase() ||
      observed.nonce !== authorization.nonce ||
      !samePublicKeys(observed.keys, op.intent.oldKeys) ||
      observed.head - observed.block + 1 < ports.confirmations
    )
      throw conflict();
    return ports.repository.authorize(owner, registry, id, authorization, {
      block: observed.block,
      blockHash: observed.blockHash,
      txHash: null,
    });
  };
  const progress = async (
    owner: Hex,
    registry: RegistryScope,
    op: RotationOperation,
    phase: RotationOperation["phase"],
    txHash = op.txHash,
  ) =>
    ports.repository.saveOperation(owner, registry, {
      ...op,
      phase,
      txHash,
      updatedAt: new Date().toISOString(),
    });
  const reconcile = async (
    owner: Hex,
    registry: RegistryScope,
    id: string,
  ): Promise<RotationOperation> => {
    let op = await ports.repository.operation(owner, registry, id);
    const authorization = op.registryAuthorization;
    if (op.phase === "confirmed") {
      await closeSponsor(op);
      return op;
    }
    if (!authorization) return op;
    await feeReconcile(op);
    const current = await ports.readRegistry(owner, op.intent.username);
    if (
      current.timestamp &&
      BigInt(current.timestamp) > BigInt(authorization.deadline) &&
      current.scope === registry &&
      current.owner.toLowerCase() === owner.toLowerCase() &&
      current.head - current.block + 1 >= ports.confirmations &&
      current.nonce === authorization.nonce &&
      samePublicKeys(current.keys, op.intent.oldKeys)
    ) {
      const closed = await ports.repository.terminateRotation(
        owner,
        registry,
        op,
      );
      await closeSponsor(closed);
      return closed;
    }
    if (!op.txHash && ports.findTransaction) {
      const found = await ports.findTransaction(op);
      op = await progress(
        owner,
        registry,
        { ...op, ...(found.scanned ? { searchEvidence: found.scanned } : {}) },
        "needsReconciliation",
        found.hash,
      );
    }
    if (!op.txHash) return progress(owner, registry, op, "needsReconciliation");
    const result = await ports.verifyTransaction(
      op.txHash,
      op.intent,
      authorization,
    );
    if (result.state !== "confirmed" || !result.evidence)
      return progress(
        owner,
        registry,
        op,
        result.state === "reverted" ? "failed" : "needsReconciliation",
      );
    const observed = await ports.readRegistry(owner, op.intent.username);
    if (
      observed.scope !== registry ||
      observed.owner.toLowerCase() !== owner.toLowerCase() ||
      !samePublicKeys(observed.keys, op.intent.newKeys) ||
      observed.nonce !== (BigInt(authorization.nonce) + 1n).toString() ||
      observed.head - observed.block + 1 < ports.confirmations
    )
      return progress(owner, registry, op, "conflict");
    await ports.repository.appendConfirmed(
      owner,
      registry,
      op,
      result.evidence,
    );
    try {
      await ports.refreshCache(op.intent.username, op.intent.newKeys);
    } catch {
      return progress(owner, registry, op, "confirming");
    }
    const completed = await ports.repository.completeProjection(
      owner,
      registry,
      op,
    );
    await closeSponsor(completed);
    return completed;
  };
  return {
    async abort(owner: Hex, registry: RegistryScope, id: string) {
      const op = await ports.repository.operation(owner, registry, id);
      return ports.repository.terminateRotation(owner, registry, op, true);
    },
    authorize,
    async submit(
      owner: Hex,
      registry: RegistryScope,
      input: {
        id: string;
        authorization: RegistryAuthorization;
        mode?: "relay" | "wallet";
      },
    ) {
      let op = await authorize(owner, registry, input.id, input.authorization);
      if (op.phase === "confirmed" || input.mode === "wallet") return op;
      let intent = relayIntent(op);
      try {
        const prior = await ports.journal?.read(
          `${intent.chainId}:${intent.wallet.toLowerCase()}`,
          intent.operationKey,
        );
        if (prior?.serializedTransaction && prior.intent) intent = prior.intent;
        else if (ports.sponsorship) {
          const { ledger, user } = ports.sponsorship,
            actionId = `rotation:${input.id}`,
            businessDigest = keccak256(intent.data);
          const existing = await ledger.readAction(intent.chainId, actionId);
          if (
            existing &&
            (existing.intent.businessDigest !== businessDigest ||
              existing.intent.kind !== "rotation" ||
              existing.intent.principal.kind !== "user" ||
              (user && existing.intent.principal.key !== user) ||
              existing.phase === "cancelled")
          )
            throw new SponsorshipError("budget");
          if (!existing && !user) throw new SponsorshipError("initializing");
          const action = existing
            ? { chainId: intent.chainId, actionId, fence: existing.fence }
            : await ledger.admit({
                chainId: intent.chainId,
                actionId,
                kind: "rotation",
                principal: { kind: "user", key: user as string },
                businessDigest,
                maximumChildren: 1,
              });
          op = await progress(
            owner,
            registry,
            { ...op, sponsorshipAction: action, sponsorshipPause: undefined },
            op.phase,
          );
          intent = relayIntent(op);
        }
        const prepared = await ports.sender.prepare(intent);
        await progress(owner, registry, op, "submitted", prepared.txHash);
        await ports.sender.broadcast(intent);
        await ports.sender.reconcile(intent);
        return reconcile(owner, registry, input.id);
      } catch (error) {
        if (isSponsorshipError(error)) {
          const latest = await ports.repository.operation(
            owner,
            registry,
            input.id,
          );
          await progress(
            owner,
            registry,
            { ...latest, sponsorshipPause: error.reason },
            latest.phase,
          );
        }
        throw error;
      }
    },
    async markSubmitted(
      owner: Hex,
      registry: RegistryScope,
      id: string,
      hash: Hex,
    ) {
      const op = await ports.repository.operation(owner, registry, id);
      if (!op.registryAuthorization || (op.txHash && op.txHash !== hash))
        throw conflict();
      return progress(owner, registry, op, "submitted", hash);
    },
    reconcile,
  };
}

export async function runtimeRotationOperations(owner: Hex, user?: string) {
  const relayer = (relayerAddress() ??
    "0x0000000000000000000000000000000000000000") as Hex;
  const verify = registryTransactionVerifier([owner, relayer]);
  return createRotationOperations({
    sponsorship: { ledger: await sponsorshipLedger(), user },
    journal: new RelayJournal(await getDb()),
    repository: new PrivacyKeysRepository(await getDb()),
    readRegistry,
    verifyTransaction: verify,
    findTransaction: registryTransactionFinder(verify),
    relayer,
    confirmations: registryConfirmations,
    now: () => Math.floor(Date.now() / 1000),
    refreshCache: async (username, keys) => {
      const result = await registerUsernameCache(username);
      if (
        !result ||
        result.owner.toLowerCase() !== owner.toLowerCase() ||
        !samePublicKeys(
          {
            notePubkey: `0x${result.notePubkeyHex}`,
            viewPubkey: `0x${result.viewPubkeyHex}`,
          },
          keys,
        )
      )
        throw conflict();
    },
    sender: {
      prepare: async (intent) => (await runtimeSender()).sender.prepare(intent),
      broadcast: async (intent) =>
        (await runtimeSender()).sender.broadcast(intent),
      reconcile: async (intent) =>
        (await runtimeSender()).sender.reconcile(intent),
    },
  });
}
async function boundOwner(user: string): Promise<Hex> {
  const wallet = await currentWallet(user);
  if (!wallet) throw conflict();
  return wallet.address.toLowerCase() as Hex;
}
export async function submitPrivacyRotation(
  user: string,
  input: {
    id: string;
    authorization: RegistryAuthorization;
    mode?: "relay" | "wallet";
  },
) {
  if (input.mode !== "wallet" && !relayerConfigured())
    throw new Error(
      "The gasless relayer is unavailable. Use your wallet to submit this rotation.",
    );
  const owner = await boundOwner(user);
  return (await runtimeRotationOperations(owner, user)).submit(
    owner,
    configuredRegistryScope,
    input,
  );
}
export async function markPrivacyRotationSubmitted(
  user: string,
  input: { id: string; txHash: Hex },
) {
  const owner = await boundOwner(user);
  return (await runtimeRotationOperations(owner, user)).markSubmitted(
    owner,
    configuredRegistryScope,
    input.id,
    input.txHash,
  );
}
export async function reconcilePrivacyRotation(user: string, id: string) {
  const owner = await boundOwner(user);
  return (await runtimeRotationOperations(owner, user)).reconcile(
    owner,
    configuredRegistryScope,
    id,
  );
}
export async function privacyRotationStatus(user: string, id: string) {
  return new PrivacyKeysRepository(await getDb()).operation(
    await boundOwner(user),
    configuredRegistryScope,
    id,
  );
}
export async function abortPrivacyRotation(user: string, id: string) {
  const owner = await boundOwner(user);
  return (await runtimeRotationOperations(owner, user)).abort(
    owner,
    configuredRegistryScope,
    id,
  );
}
export async function reconcilePendingPrivacyRotations({
  limit,
}: {
  limit: number;
}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new Error("Invalid privacy reconciliation limit");
  const repo = new PrivacyKeysRepository(await getDb());
  const pending = await repo.accounts
    .find({
      "state.registry": configuredRegistryScope,
      "state.pending.registryAuthorization": { $exists: true },
    })
    .sort({ "state.pending.updatedAt": 1, _id: 1 })
    .limit(limit)
    .toArray();
  const counts = {
    examined: pending.length,
    confirmed: 0,
    pending: 0,
    failed: 0,
  };
  for (const doc of pending) {
    try {
      const op = doc.state.pending;
      if (!op) continue;
      const result = await (
        await runtimeRotationOperations(doc.state.owner)
      ).reconcile(doc.state.owner, configuredRegistryScope, op.intent.id);
      if (result.phase === "confirmed") counts.confirmed++;
      else counts.pending++;
    } catch {
      counts.failed++;
    }
  }
  return counts;
}
