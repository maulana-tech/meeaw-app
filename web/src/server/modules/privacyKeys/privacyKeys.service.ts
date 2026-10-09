import "server-only";
import { TRPCError } from "@trpc/server";
import { type Hex, verifyTypedData } from "viem";
import { samePublicKeys } from "../../../features/privacyKeys/keyRing";
import { rotationTypedData } from "../../../features/privacyKeys/rotationTypedData";
import type {
  PrivacyKeyState,
  PublicKeyPair,
  RegistryScope,
  RotationIntent,
} from "../../../features/privacyKeys/types";
import { usernameOfOnChain } from "../../../lib/chain";
import { getDb } from "../../db/mongo";
import { currentWallet } from "../wallets/wallets.service";
import { PrivacyKeysRepository } from "./privacyKeys.repository";
import {
  publicKeyPairSchema,
  rotationIntentSchema,
} from "./privacyKeys.schema";
import {
  configuredRegistryScope,
  type RegistryReader,
  readRegistry,
  registryConfirmations,
} from "./registryEvidence";

type Ports = {
  wallet(user: string): Promise<Hex | null>;
  username(owner: Hex): Promise<string | null>;
  registry: RegistryScope;
  confirmations: number;
  readRegistry: RegistryReader;
  now(): number;
  repository: Pick<PrivacyKeysRepository, "get" | "bootstrap" | "prepare">;
};
const rejected = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Privacy keys need reconciliation. Unlock with your existing recovery and check again.",
  });

export function createPrivacyKeyService(ports: Ports) {
  const identity = async (user: string) => {
    const owner = await ports.wallet(user);
    if (!owner)
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "A verified wallet is required.",
      });
    return owner.toLowerCase() as Hex;
  };
  const evidence = async (owner: Hex, username: string) => {
    const value = await ports.readRegistry(owner, username);
    if (
      value.owner.toLowerCase() !== owner ||
      value.scope.toLowerCase() !== ports.registry ||
      value.head - value.block + 1 < ports.confirmations
    )
      throw rejected();
    return value;
  };
  return {
    async state(user: string) {
      return ports.repository.get(await identity(user), ports.registry);
    },
    async verifiedState(user: string) {
      const owner = await identity(user),
        state = await ports.repository.get(owner, ports.registry);
      if (!state) return null;
      if (state.owner !== owner || state.registry !== ports.registry)
        throw rejected();
      const confirmed = await evidence(owner, state.username);
      if (
        !samePublicKeys(
          confirmed.keys,
          state.generations[state.activeGeneration],
        )
      )
        throw rejected();
      return state;
    },
    async bootstrap(
      user: string,
      input: { keys: PublicKeyPair },
    ): Promise<PrivacyKeyState> {
      const owner = await identity(user),
        keys = publicKeyPairSchema.parse(input.keys);
      const username = await ports.username(owner);
      if (!username) throw rejected();
      const confirmed = await evidence(owner, username);
      if (!samePublicKeys(confirmed.keys, keys)) throw rejected();
      const existing = await ports.repository.get(owner, ports.registry);
      if (existing) {
        if (
          existing.activeGeneration !== 0 ||
          existing.username !== username ||
          !samePublicKeys(existing.generations[0], keys)
        )
          throw rejected();
        return existing;
      }
      return ports.repository.bootstrap({
        version: 1,
        owner,
        registry: ports.registry,
        username,
        revision: 1,
        activeGeneration: 0,
        generations: [
          {
            id: 0,
            ...keys,
            evidence: {
              block: confirmed.block,
              blockHash: confirmed.blockHash,
              txHash: null,
            },
          },
        ],
        pending: null,
      });
    },
    async prepare(user: string, input: RotationIntent) {
      const owner = await identity(user),
        intent = rotationIntentSchema.parse(input);
      if (
        intent.owner !== owner ||
        intent.registry !== ports.registry ||
        BigInt(intent.deadline) <= BigInt(ports.now())
      )
        throw rejected();
      if (
        !(await verifyTypedData({
          ...rotationTypedData(intent),
          address: owner,
          signature: intent.signature,
        }))
      )
        throw rejected();
      const state = await ports.repository.get(owner, ports.registry);
      if (
        state?.generations.some(
          (entry) =>
            entry.notePubkey === intent.newKeys.notePubkey ||
            entry.viewPubkey === intent.newKeys.viewPubkey,
        )
      )
        throw rejected();
      if (
        !state ||
        state.username !== intent.username ||
        state.revision !== intent.expectedRevision ||
        state.activeGeneration !== intent.from
      )
        throw rejected();
      const confirmed = await evidence(owner, intent.username);
      if (
        !samePublicKeys(confirmed.keys, intent.oldKeys) ||
        !samePublicKeys(state.generations[intent.from], intent.oldKeys)
      )
        throw rejected();
      return ports.repository.prepare(intent);
    },
  };
}

export async function privacyKeyService() {
  return createPrivacyKeyService({
    wallet: async (user) =>
      ((await currentWallet(user))?.address as Hex) ?? null,
    username: usernameOfOnChain,
    registry: configuredRegistryScope,
    confirmations: registryConfirmations,
    repository: new PrivacyKeysRepository(await getDb()),
    readRegistry,
    now: () => Math.floor(Date.now() / 1000),
  });
}
export async function getPrivacyKeyState(user: string) {
  return (await privacyKeyService()).state(user);
}
export async function getVerifiedPrivacyKeyState(user: string) {
  return (await privacyKeyService()).verifiedState(user);
}
export async function bootstrapPrivacyKeyState(
  user: string,
  input: { keys: PublicKeyPair },
) {
  return (await privacyKeyService()).bootstrap(user, input);
}
export async function preparePrivacyRotation(
  user: string,
  intent: RotationIntent,
) {
  const wallet = await currentWallet(user);
  if (!wallet || wallet.address.toLowerCase() !== intent.owner.toLowerCase())
    throw rejected();
  await (await cashoutOperations()).reconcile(
    wallet.address.toLowerCase() as Hex,
    true,
  );
  const db = await getDb(),
    owner = wallet.address.toLowerCase();
  const [transfer, request] = await Promise.all([
    db.collection("private_transfers").findOne({
      "sender.wallet": owner,
      status: "pending",
      "operation.phase": { $nin: ["failed", "confirmed"] },
    }),
    db.collection("payment_requests").findOne({
      addresseeWallet: owner,
      status: "pending",
      operationId: { $type: "string" },
      "reservation.phase": { $nin: ["failed", "confirmed"] },
    }),
  ]);
  if (transfer || request)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Finish or reconcile your private payment before rotating privacy keys.",
    });
  return (await privacyKeyService()).prepare(user, intent);
}
async function cashoutOperations() {
  const { accountSpendGate } = await import("./spendGate"),
    gate = await accountSpendGate();
  const { CashoutOperations } = await import("./cashoutOperations");
  return new CashoutOperations(await getDb(), gate, async (record) => {
    const { resolvePool } = await import("../../../lib/pools"),
      pool = resolvePool(record.pool);
    const { publicClient } = await import("../../../lib/chain"),
      { maweePoolAbi } = await import("../../../lib/abi");
    const head = await publicClient.getBlockNumber(),
      block = head - BigInt(pool.confirmations - 1);
    if (block < 0n) return false;
    const before = await publicClient.getBlock({ blockNumber: block });
    const spent = await publicClient.readContract({
      address: pool.address,
      abi: maweePoolAbi,
      functionName: "isSpent",
      args: [record.nullifier],
      blockNumber: block,
    });
    const after = await publicClient.getBlock({ blockNumber: block });
    if (before.hash !== after.hash) throw rejected();
    return spent;
  });
}
async function cashoutOwner(user: string) {
  const wallet = await currentWallet(user);
  if (!wallet) throw rejected();
  return wallet.address.toLowerCase() as Hex;
}
export async function admitCashout(
  user: string,
  input: {
    operationId: string;
    fundingGeneration: number;
    keyRevision: number;
    pool: string;
    nullifier: Hex;
    sponsorBatchId?: string;
  },
) {
  return (await cashoutOperations()).admit(await cashoutOwner(user), input);
}
export async function dispatchCashout(
  user: string,
  input: {
    operationId: string;
    accountTicketId: string;
    fundingGeneration: number;
    keyRevision: number;
  },
) {
  return (await cashoutOperations()).dispatch(
    await cashoutOwner(user),
    input.operationId,
    input,
  );
}
export async function cancelCashout(
  user: string,
  input: { operationId: string },
) {
  return (await cashoutOperations()).cancel(
    await cashoutOwner(user),
    input.operationId,
  );
}
export async function finishCashout(
  user: string,
  input: { operationId: string },
) {
  return (await cashoutOperations()).finish(
    await cashoutOwner(user),
    input.operationId,
  );
}
