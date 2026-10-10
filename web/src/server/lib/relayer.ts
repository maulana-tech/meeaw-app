import "server-only";
import { randomUUID } from "node:crypto";
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
import {
  isSponsorshipError,
  SponsorshipError,
} from "../modules/sponsorship/sponsorship.errors";
import { type RelayIntent, runtimeSender } from "./durableRelayer";
import { RelayConflictError } from "./relayJournal";
import {
  RelayNotSubmittedError,
  RelayRevertedError,
} from "./relayOutcome.errors";

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
    let operationKey = `ordinary:${sponsor.identity.actionId}${sponsor.closeParent === false ? `:${sponsor.identity.childId}` : ""}`;
    let prior = await journal.read(
      `${chain.id}:${account.address.toLowerCase()}`,
      operationKey,
    );
    let foundSibling = false;
    if (!prior && sponsor.closeParent !== false) {
      const sibling = await budget.ledger.findOrdinaryAction(
        chain.id,
        sponsor.kind,
        sponsor.identity.businessDigest,
      );
      if (sibling) {
        foundSibling = true;
        if (
          sibling.intent.principal.kind !== sponsor.principal.kind ||
          sibling.intent.principal.key !== sponsor.principal.key
        )
          throw new RelayConflictError();
        operationKey = `ordinary:${sibling.intent.actionId}`;
        prior = await journal.read(
          `${chain.id}:${account.address.toLowerCase()}`,
          operationKey,
        );
      }
    }
    let intent: RelayIntent;
    if (prior?.serializedTransaction && prior.intent?.sponsorship) {
      const action = await budget.ledger.readAction(
        chain.id,
        prior.intent.sponsorship.action.actionId,
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
      const existingDeposit =
        sponsor.kind === "deposit"
          ? await budget.ledger.readAction(chain.id, sponsor.identity.actionId)
          : null;
      const freshDeposit =
        sponsor.kind === "deposit" &&
        !prior &&
        !foundSibling &&
        !existingDeposit;
      try {
        await reader.simulateContract({ ...request, account } as Parameters<
          typeof reader.simulateContract
        >[0]);
      } catch (error) {
        if (freshDeposit) throw new RelayNotSubmittedError(error);
        throw error;
      }
      const previousAction =
        sponsor.kind === "deposit"
          ? existingDeposit
          : await budget.ledger.readAction(chain.id, sponsor.identity.actionId);
      const abandoned =
        previousAction?.phase === "cancelled" ||
        (previousAction?.phase === "closed" &&
          !previousAction.charged &&
          Object.values(previousAction.children).every(
            (c) => c.phase === "abandoned",
          ));
      const action = await budget.ledger
        .admit({
          chainId: chain.id,
          actionId: abandoned
            ? `${sponsor.identity.actionId}:retry:${randomUUID()}`
            : sponsor.identity.actionId,
          kind: sponsor.kind,
          principal: sponsor.principal,
          businessDigest: sponsor.identity.businessDigest,
          maximumChildren: sponsor.maximumChildren ?? 1,
        })
        .catch((error) => {
          if (freshDeposit) throw new RelayNotSubmittedError(error);
          throw error;
        });
      operationKey = `ordinary:${action.actionId}${sponsor.closeParent === false ? `:${sponsor.identity.childId}` : ""}`;
      const accepted = await journal.read(
        `${chain.id}:${account.address.toLowerCase()}`,
        operationKey,
      );
      if (accepted?.serializedTransaction && accepted.intent)
        intent = accepted.intent;
      else
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
    try {
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
        throw new RelayRevertedError(result.txHash);
      if (result.state !== "confirmed")
        throw new Error("Transaction confirmation is still being checked.");
      return { hash: prepared.txHash, receipt };
    } catch (error) {
      if (sponsor.closeParent !== false && intent.sponsorship) {
        const saved = await journal.read(
          `${chain.id}:${account.address.toLowerCase()}`,
          intent.operationKey,
        );
        if (!saved?.serializedTransaction) {
          try {
            await budget.ledger.cancelUnsigned(intent.sponsorship.action);
            const unavailable = isSponsorshipError(error)
              ? error
              : new SponsorshipError("rpc");
            unavailable.released = true;
            throw unavailable;
          } catch (releaseError) {
            if (isSponsorshipError(releaseError) && releaseError.released)
              throw releaseError;
          }
        }
      }
      throw error;
    }
  };
  const next = queue.then(run, run);
  queue = next.catch(() => {});
  return next;
}
