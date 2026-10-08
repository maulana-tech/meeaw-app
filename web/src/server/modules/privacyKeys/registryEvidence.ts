import "server-only";
import {
  getAddress,
  type Hex,
  keccak256,
  parseEventLogs,
  stringToHex,
  type TransactionReceipt,
  verifyTypedData,
} from "viem";
import { samePublicKeys } from "../../../features/privacyKeys/keyRing";
import {
  type RegistryAuthorization,
  registryAuthorizationTypedData,
  registryRotationCalldata,
} from "../../../features/privacyKeys/registryRotation";
import type {
  GenerationEvidence,
  PublicKeyPair,
  RegistryScope,
  RotationIntent,
  RotationOperation,
} from "../../../features/privacyKeys/types";
import { maweeRegistryAbi } from "../../../lib/abi";
import { chain, publicClient, registryAddress } from "../../../lib/chain";
import { activePool } from "../../../lib/pools";
import type { RegistryTransactionResult } from "./rotationOperations";

export type RegistryEvidence = {
  scope: RegistryScope;
  owner: Hex;
  keys: PublicKeyPair;
  nonce: string;
  block: number;
  blockHash: Hex;
  head: number;
  timestamp?: string;
};
export type RegistryReader = (
  owner: Hex,
  username: string,
) => Promise<RegistryEvidence>;
export const configuredRegistryScope =
  `${chain.id}:${registryAddress.toLowerCase()}` as RegistryScope;
export const registryConfirmations = activePool().confirmations;
type SearchPorts = {
  confirmations: number;
  head(): Promise<bigint>;
  blockHash(block: bigint): Promise<Hex | null>;
  logs(
    from: number,
    to: number,
    operation: RotationOperation,
  ): Promise<readonly Hex[]>;
  matchesTransaction(hash: Hex, operation: RotationOperation): Promise<boolean>;
};
export function createRegistryTransactionFinder(ports: SearchPorts) {
  return async (
    operation: RotationOperation,
  ): Promise<{ hash: Hex | null; scanned?: GenerationEvidence }> => {
    if (!operation.authorizationEvidence) return { hash: null };
    const head = await ports.head(),
      confirmedHead = head - BigInt(ports.confirmations - 1);
    if (head > BigInt(Number.MAX_SAFE_INTEGER)) return { hash: null };
    const cursor = operation.searchEvidence;
    let from = operation.authorizationEvidence.block;
    if (
      cursor &&
      (await ports.blockHash(BigInt(cursor.block))) === cursor.blockHash
    )
      from = cursor.block + 1;
    let scanned: GenerationEvidence | undefined;
    for (let batch = 0; batch < 3 && BigInt(from) <= confirmedHead; batch++) {
      const to = Math.min(from + 99, Number(confirmedHead));
      const before = await ports.blockHash(BigInt(to));
      const hashes = await ports.logs(from, to, operation);
      if (!before || (await ports.blockHash(BigInt(to))) !== before)
        return { hash: null };
      for (const hash of hashes)
        if (await ports.matchesTransaction(hash, operation)) return { hash };
      scanned = { block: to, blockHash: before, txHash: null };
      from = to + 1;
    }
    return { hash: null, scanned };
  };
}

export function registryTransactionFinder(
  verify: ReturnType<typeof registryTransactionVerifier>,
) {
  return createRegistryTransactionFinder({
    confirmations: registryConfirmations,
    head: () => publicClient.getBlockNumber({ cacheTime: 0 }),
    blockHash: async (blockNumber) =>
      (await publicClient.getBlock({ blockNumber })).hash,
    logs: async (from, to, op) => {
      const logs = await publicClient.getLogs({
        address: registryAddress,
        event: maweeRegistryAbi.find(
          (entry) => entry.type === "event" && entry.name === "PubkeysRotated",
        ) as Extract<
          (typeof maweeRegistryAbi)[number],
          { type: "event"; name: "PubkeysRotated" }
        >,
        args: {
          owner: op.intent.owner,
          usernameHash: keccak256(stringToHex(op.intent.username)),
        },
        fromBlock: BigInt(from),
        toBlock: BigInt(to),
        strict: true,
      });
      return logs
        .filter((log) => samePublicKeys(log.args, op.intent.newKeys))
        .map((log) => log.transactionHash);
    },
    matchesTransaction: async (hash, op) =>
      Boolean(
        op.registryAuthorization &&
          (await verify(hash, op.intent, op.registryAuthorization)).state ===
            "confirmed",
      ),
  });
}

type VerificationPorts = {
  chainId: number;
  registry: Hex;
  confirmations: number;
  allowedSenders: readonly Hex[];
  receipt(hash: Hex): Promise<TransactionReceipt | null>;
  transaction(hash: Hex): Promise<{ to: Hex | null; from: Hex; input: Hex }>;
  blockHash(block: bigint): Promise<Hex | null>;
  head(): Promise<bigint>;
  registryAt(
    owner: Hex,
    username: string,
    block: bigint,
  ): Promise<{ owner: Hex; keys: PublicKeyPair; nonce: string }>;
};
export function createRegistryTransactionVerifier(ports: VerificationPorts) {
  return async (
    hash: Hex,
    intent: RotationIntent,
    authorization: RegistryAuthorization,
  ): Promise<RegistryTransactionResult> => {
    try {
      if (
        intent.registry !== `${ports.chainId}:${ports.registry.toLowerCase()}`
      )
        return { state: "unknown" };
      const receipt = await ports.receipt(hash);
      if (
        !receipt ||
        receipt.transactionHash !== hash ||
        receipt.blockNumber > BigInt(Number.MAX_SAFE_INTEGER)
      )
        return { state: "unknown" };
      const canonical = await ports.blockHash(receipt.blockNumber),
        head = await ports.head();
      if (
        canonical !== receipt.blockHash ||
        head - receipt.blockNumber + 1n < BigInt(ports.confirmations)
      )
        return { state: "unknown" };
      const tx = await ports.transaction(hash);
      if (
        tx.to?.toLowerCase() !== ports.registry.toLowerCase() ||
        !ports.allowedSenders.some(
          (sender) => sender.toLowerCase() === tx.from.toLowerCase(),
        ) ||
        tx.input.toLowerCase() !==
          registryRotationCalldata(intent, authorization).toLowerCase()
      )
        return { state: "unknown" };
      if (
        !(await verifyTypedData({
          ...registryAuthorizationTypedData(intent, authorization),
          address: intent.owner,
          signature: authorization.signature,
        }))
      )
        return { state: "unknown" };
      if (receipt.status === "reverted") return { state: "reverted" };
      const logs = parseEventLogs({
        abi: maweeRegistryAbi,
        eventName: "PubkeysRotated",
        logs: receipt.logs.filter(
          (log) => log.address.toLowerCase() === ports.registry.toLowerCase(),
        ),
        strict: true,
      });
      if (
        !logs.some(
          (log) =>
            log.args.owner.toLowerCase() === intent.owner.toLowerCase() &&
            log.args.usernameHash === keccak256(stringToHex(intent.username)) &&
            samePublicKeys(log.args, intent.newKeys),
        )
      )
        return { state: "unknown" };
      const record = await ports.registryAt(
        intent.owner,
        intent.username,
        receipt.blockNumber,
      );
      if (
        record.owner.toLowerCase() !== intent.owner.toLowerCase() ||
        !samePublicKeys(record.keys, intent.newKeys) ||
        record.nonce !== (BigInt(authorization.nonce) + 1n).toString() ||
        (await ports.blockHash(receipt.blockNumber)) !== canonical
      )
        return { state: "unknown" };
      return {
        state: "confirmed",
        evidence: {
          block: Number(receipt.blockNumber),
          blockHash: receipt.blockHash,
          txHash: hash,
        },
      };
    } catch {
      return { state: "unknown" };
    }
  };
}

export function registryTransactionVerifier(allowedSenders: readonly Hex[]) {
  return createRegistryTransactionVerifier({
    chainId: chain.id,
    registry: registryAddress,
    confirmations: registryConfirmations,
    allowedSenders,
    receipt: async (hash) =>
      publicClient.getTransactionReceipt({ hash }).catch(() => null),
    transaction: (hash) => publicClient.getTransaction({ hash }),
    blockHash: async (blockNumber) =>
      (await publicClient.getBlock({ blockNumber })).hash,
    head: () => publicClient.getBlockNumber({ cacheTime: 0 }),
    registryAt: async (owner, username, blockNumber) => {
      const [record, nonce, name] = await Promise.all([
        publicClient.readContract({
          address: registryAddress,
          abi: maweeRegistryAbi,
          functionName: "resolve",
          args: [username],
          blockNumber,
        }),
        publicClient.readContract({
          address: registryAddress,
          abi: maweeRegistryAbi,
          functionName: "nonces",
          args: [owner],
          blockNumber,
        }),
        publicClient.readContract({
          address: registryAddress,
          abi: maweeRegistryAbi,
          functionName: "usernameOf",
          args: [owner],
          blockNumber,
        }),
      ]);
      if (name !== username) throw new Error("Registry username changed");
      return {
        owner: record.owner,
        keys: { notePubkey: record.notePubkey, viewPubkey: record.viewPubkey },
        nonce: nonce.toString(),
      };
    },
  });
}

export const readRegistry: RegistryReader = async (owner, username) => {
  const head = await publicClient.getBlockNumber({ cacheTime: 0 });
  const blockNumber = head - BigInt(registryConfirmations - 1);
  if (blockNumber < 0n || head > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Confirmed registry block unavailable");
  const before = await publicClient.getBlock({ blockNumber });
  const [record, ownedName, nonce, actualChain] = await Promise.all([
    publicClient.readContract({
      address: registryAddress,
      abi: maweeRegistryAbi,
      functionName: "resolve",
      args: [username],
      blockNumber,
    }),
    publicClient.readContract({
      address: registryAddress,
      abi: maweeRegistryAbi,
      functionName: "usernameOf",
      args: [getAddress(owner)],
      blockNumber,
    }),
    publicClient.readContract({
      address: registryAddress,
      abi: maweeRegistryAbi,
      functionName: "nonces",
      args: [getAddress(owner)],
      blockNumber,
    }),
    publicClient.getChainId(),
  ]);
  const after = await publicClient.getBlock({ blockNumber });
  if (
    !before.hash ||
    before.hash !== after.hash ||
    actualChain !== chain.id ||
    ownedName !== username ||
    record.owner.toLowerCase() !== owner.toLowerCase()
  )
    throw new Error("Confirmed registry identity is inconsistent");
  return {
    scope: configuredRegistryScope,
    owner: owner.toLowerCase() as Hex,
    keys: {
      notePubkey: record.notePubkey.toLowerCase() as Hex,
      viewPubkey: record.viewPubkey.toLowerCase() as Hex,
    },
    nonce: nonce.toString(),
    block: Number(blockNumber),
    blockHash: before.hash,
    head: Number(head),
    timestamp: before.timestamp.toString(),
  };
};
