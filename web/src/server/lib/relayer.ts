import "server-only";
import {
  type Abi,
  type ContractFunctionArgs,
  type ContractFunctionName,
  createPublicClient,
  encodeFunctionData,
  type Hash,
  http,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getServerEnv } from "../../env.server";
import type { ActionKind, Principal } from "../../features/sponsorship/types";
import { chain, rpcUrl } from "../../lib/chain";
import type { ordinaryBusinessIdentity } from "../modules/sponsorship/ordinaryIdentity";
import { type RelayIntent, runtimeSender } from "./durableRelayer";
import { RelayConflictError } from "./relayJournal";

export type OrdinarySponsor = {
  kind: ActionKind;
  principal: Principal;
  identity: ReturnType<typeof ordinaryBusinessIdentity>;
  maximumChildren?: number;
  closeParent?: boolean;
};

export function relayerConfigured() {
  return Boolean(getServerEnv().RELAYER_PRIVATE_KEY);
}
export function relayerAddress(): string | null {
  const key = getServerEnv().RELAYER_PRIVATE_KEY;
  return key ? privateKeyToAccount(key as `0x${string}`).address : null;
}
let queue: Promise<unknown> = Promise.resolve();
/** Every ordinary send shares the persistent wallet fence with request sends. */
export function relayWrite<
  const abi extends Abi,
  functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
>(
  request: {
    address: `0x${string}`;
    abi: abi;
    functionName: functionName;
    args: ContractFunctionArgs<abi, "nonpayable" | "payable", functionName>;
  },
  sponsor: OrdinarySponsor,
): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
  const run = async () => {
    const env = getServerEnv();
    if (!env.RELAYER_PRIVATE_KEY)
      throw new Error("The gasless relayer is not configured.");
    const account = privateKeyToAccount(
      env.RELAYER_PRIVATE_KEY as `0x${string}`,
    );
    const reader = createPublicClient({
      chain,
      transport: http(env.RELAYER_RPC_URL ?? rpcUrl),
    });
    const { sender, journal, budget } = await runtimeSender();
    const operationKey = `ordinary:${sponsor.identity.actionId}${sponsor.closeParent === false ? `:${sponsor.identity.childId}` : ""}`;
    const prior = await journal.read(
      `${chain.id}:${account.address.toLowerCase()}`,
      operationKey,
    );
    let intent: RelayIntent;
    if (prior?.serializedTransaction && prior.intent?.sponsorship) {
      const action = await budget.ledger.readAction(
        chain.id,
        sponsor.identity.actionId,
      );
      if (
        !action ||
        action.intent.businessDigest !== sponsor.identity.businessDigest ||
        action.intent.kind !== sponsor.kind ||
        action.intent.principal.kind !== sponsor.principal.kind ||
        action.intent.principal.key !== sponsor.principal.key ||
        action.fence !== prior.intent.sponsorship.action.fence
      )
        throw new RelayConflictError();
      intent = prior.intent;
    } else {
      await reader.simulateContract({ ...request, account } as Parameters<
        typeof reader.simulateContract
      >[0]);
      const action = await budget.ledger.admit({
        chainId: chain.id,
        actionId: sponsor.identity.actionId,
        kind: sponsor.kind,
        principal: sponsor.principal,
        businessDigest: sponsor.identity.businessDigest,
        maximumChildren: sponsor.maximumChildren ?? 1,
      });
      intent = {
        operationKey,
        chainId: chain.id,
        wallet: account.address,
        to: request.address,
        data: encodeFunctionData({
          abi: request.abi,
          functionName: request.functionName,
          args: request.args,
        } as Parameters<typeof encodeFunctionData>[0]),
        confirmations: 1,
        sponsorship: { action, childId: sponsor.identity.childId },
      };
    }
    const prepared = await sender.prepare(intent);
    await sender.broadcast(intent);
    const receipt = await reader.waitForTransactionReceipt({
      hash: prepared.txHash,
      confirmations: 1,
      timeout: 30_000,
    });
    const result = await sender.reconcile(intent);
    if (
      result.state !== "unknown" &&
      intent.sponsorship &&
      sponsor.closeParent !== false
    )
      await budget.ledger.closeAction(intent.sponsorship.action);
    if (result.state === "reverted")
      throw new Error("Relayed transaction reverted.");
    if (result.state !== "confirmed")
      throw new Error("Transaction confirmation is still being checked.");
    return { hash: prepared.txHash, receipt };
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}
