import "server-only";
import { type Hex, verifyTypedData } from "viem";
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
    if (op.phase === "confirmed" || !authorization) return op;
    const current = await ports.readRegistry(owner, op.intent.username);
    if (
      current.timestamp &&
      BigInt(current.timestamp) > BigInt(authorization.deadline) &&
      current.scope === registry &&
      current.owner.toLowerCase() === owner.toLowerCase() &&
      current.head - current.block + 1 >= ports.confirmations &&
      current.nonce === authorization.nonce &&
      samePublicKeys(current.keys, op.intent.oldKeys)
    )
      return ports.repository.terminateRotation(owner, registry, op);
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
    return ports.repository.completeProjection(owner, registry, op);
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
      const op = await authorize(
        owner,
        registry,
        input.id,
        input.authorization,
      );
      if (op.phase === "confirmed" || input.mode === "wallet") return op;
      const [chainId, target] = registry.split(":");
      const intent: RelayIntent = {
        operationKey: `privacy-rotation:${input.id}`,
        chainId: Number(chainId),
        wallet: ports.relayer,
        to: target as Hex,
        data: registryRotationCalldata(op.intent, input.authorization),
        confirmations: ports.confirmations,
      };
      const prepared = await ports.sender.prepare(intent);
      await progress(owner, registry, op, "submitted", prepared.txHash);
      await ports.sender.broadcast(intent);
      await ports.sender.reconcile(intent);
      return reconcile(owner, registry, input.id);
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

export async function runtimeRotationOperations(owner: Hex) {
  const relayer = (relayerAddress() ??
    "0x0000000000000000000000000000000000000000") as Hex;
  const verify = registryTransactionVerifier([owner, relayer]);
  return createRotationOperations({
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
  return (await runtimeRotationOperations(owner)).submit(
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
  return (await runtimeRotationOperations(owner)).markSubmitted(
    owner,
    configuredRegistryScope,
    input.id,
    input.txHash,
  );
}
export async function reconcilePrivacyRotation(user: string, id: string) {
  const owner = await boundOwner(user);
  return (await runtimeRotationOperations(owner)).reconcile(
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
  return (await runtimeRotationOperations(owner)).abort(
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
