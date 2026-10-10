import "server-only";

import { parseEventLogs } from "viem";
import type { ActionKind } from "../../../features/sponsorship/types";
import { erc20Abi, maweePoolAbi, maweeRegistryAbi } from "../../../lib/abi";
import {
  poolAddress,
  registryAddress,
  revertErrorName,
} from "../../../lib/chain";
import { USDC_DECIMALS } from "../../../lib/crypto";
import { activePool, findPool } from "../../../lib/pools";
import type { Context } from "../../context";
import { relayerConfigured, relayWrite } from "../../lib/relayer";
import {
  RelayNotSubmittedError,
  RelayRevertedError,
} from "../../lib/relayOutcome.errors";
import { ordinaryBusinessIdentity } from "../sponsorship/ordinaryIdentity";
import { principalFromContext } from "../sponsorship/principals";
import { isSponsorshipError } from "../sponsorship/sponsorship.errors";
import { withdrawBatches } from "../sponsorship/sponsorship.service";
import {
  currentWallet,
  verifiedPrivyWallets,
} from "../wallets/wallets.service";
import { RelayerUnavailableError, RelayRejectedError } from "./relay.errors";
import type {
  DepositInput,
  RegisterInput,
  TransferInput,
  WithdrawInput,
} from "./relay.schema";

export const TEST_USDC_MINT_UNITS = 100n * 10n ** BigInt(USDC_DECIMALS);
const guest: Context = {
  ip: null,
  authToken: null,
  privyUserId: null,
  privyClaim: null,
  authError: null,
};
function sponsorship(
  ctx: Context,
  kind: ActionKind,
  input: Record<string, unknown>,
  payer?: `0x${string}`,
) {
  return {
    kind,
    principal: principalFromContext(ctx, payer),
    identity: ordinaryBusinessIdentity(kind, input),
  };
}

// Contract reverts a user can hit, translated for the UI. Anything else is a
// relayer/RPC problem and surfaces as a generic failure.
const REJECTIONS: Record<string, string> = {
  InvalidSignature: "The signature is invalid or was already used.",
  SignatureExpired: "The signature expired. Please try again.",
  InvalidProof: "The zero-knowledge proof was rejected.",
  UnknownRoot: "Your balance view is out of date. Refresh and try again.",
  DoubleSpend: "This payment was already cashed out.",
  InvalidAmount: "That amount is not allowed.",
  Paused: "Payments are paused right now.",
  TokenTransferFailed:
    "The USDC transfer failed. Check the balance and approval.",
  UsernameTaken: "That username is already owned by another account.",
  OwnerHasUsername: "This wallet already owns a different username.",
  UsernameNotFound: "Your username was not found on the current network.",
  UsernameTooShort: "Username must be at least 3 characters.",
  UsernameTooLong: "Username must be no more than 32 characters.",
  UsernameInvalidCharacter:
    "Usernames can only use lowercase letters, numbers and underscores.",
};

async function relay<T>(send: () => Promise<T>): Promise<T> {
  if (!relayerConfigured()) throw new RelayerUnavailableError();
  try {
    return await send();
  } catch (error) {
    if (error instanceof RelayNotSubmittedError) {
      const original = error.original;
      if (isSponsorshipError(original)) throw error;
      const rejected = revertErrorName(original);
      throw new RelayNotSubmittedError(
        rejected && REJECTIONS[rejected]
          ? new RelayRejectedError(REJECTIONS[rejected])
          : new Error("The transaction could not be submitted. Try again."),
      );
    }
    if (isSponsorshipError(error) || error instanceof RelayRevertedError)
      throw error;
    const name = revertErrorName(error);
    if (name && REJECTIONS[name]) {
      throw new RelayRejectedError(REJECTIONS[name]);
    }
    console.error(
      "[relay] submission failed",
      error instanceof Error ? error.name : typeof error,
    );
    throw new Error("The transaction could not be submitted. Try again.");
  }
}

async function boundWallet(privyUserId: string): Promise<`0x${string}`> {
  const wallet = await currentWallet(privyUserId);
  if (!wallet) {
    throw new RelayRejectedError("No Meaw wallet is linked to this account.");
  }
  return wallet.address as `0x${string}`;
}

/** Registers or rotates keys for the signed-in user's own wallet only. */
export async function relayRegister(
  privyUserId: string,
  input: RegisterInput,
  ctx: Context = guest,
): Promise<{ txHash: string }> {
  const owner = await boundWallet(privyUserId);
  const { hash } = await relay(() =>
    relayWrite(
      {
        address: registryAddress,
        abi: maweeRegistryAbi,
        functionName: input.rotate ? "setPubkeysFor" : "registerFor",
        args: [
          owner,
          input.username,
          input.notePubkey,
          input.viewPubkey,
          input.deadline,
          input.signature,
        ],
      },
      sponsorship(ctx, input.rotate ? "rotation" : "register", {
        ...input,
        owner,
      }),
    ),
  );
  return { txHash: hash };
}

export async function relayDeposit(
  input: DepositInput,
  ctx: Context = guest,
): Promise<{ txHash: string; leafIndex: number }> {
  if (!relayerConfigured())
    throw new RelayNotSubmittedError(new RelayerUnavailableError());
  const permit = input.permit ?? {
    value: 0n,
    deadline: 0n,
    v: 0,
    r: `0x${"00".repeat(32)}` as const,
    s: `0x${"00".repeat(32)}` as const,
  };
  const pool = input.pool ? findPool(input.pool) : activePool();
  if (!pool)
    throw new RelayNotSubmittedError(new RelayRejectedError("Unknown pool."));
  if (pool.role !== "active") {
    throw new RelayNotSubmittedError(
      new RelayRejectedError("This pool no longer takes deposits."),
    );
  }
  const { hash, receipt } = await relay(() =>
    relayWrite(
      {
        address: pool.address,
        abi: maweePoolAbi,
        functionName: "depositWithAuthorization",
        args: [
          input.payer,
          input.commitment,
          input.amount,
          input.proof,
          input.ephemeralPk,
          input.ciphertext,
          input.deadline,
          input.signature,
          permit,
        ],
      },
      sponsorship(ctx, "deposit", { ...input, pool: pool.scope }, input.payer),
    ),
  );
  const [event] = parseEventLogs({
    abi: maweePoolAbi,
    eventName: "Deposit",
    logs: receipt.logs,
  });
  if (!event) throw new Error("Deposit confirmed without a Deposit event.");
  return { txHash: hash, leafIndex: event.args.leafIndex };
}

export async function relayWithdraw(
  input: WithdrawInput,
  ctx: Context = guest,
): Promise<{ txHash: string }> {
  // Legacy pools stay withdrawable; anything outside the manifest is refused.
  const pool = input.pool ? findPool(input.pool) : activePool();
  if (!pool) throw new RelayRejectedError("Unknown pool.");
  const binding = input.batchId
    ? await (await withdrawBatches()).binding(ctx, input.batchId, {
        pool: pool.scope,
        recipient: input.recipient,
        nullifier: input.nullifier,
      })
    : sponsorship(ctx, "withdraw", { ...input, pool: pool.scope });
  const { hash } = await relay(() =>
    relayWrite(
      {
        address: pool.address,
        abi: maweePoolAbi,
        functionName: "withdraw",
        args: [
          input.recipient,
          input.amount,
          input.root,
          input.nullifier,
          input.proof,
        ],
      },
      binding,
    ),
  );
  return { txHash: hash };
}

export async function relayTransfer(
  input: TransferInput,
  ctx: Context = guest,
): Promise<{ txHash: string; recipientIndex: number; changeIndex: number }> {
  const { hash, receipt } = await relay(() =>
    relayWrite(
      {
        address: poolAddress,
        abi: maweePoolAbi,
        functionName: "transfer",
        args: [
          input.root,
          input.nullifier,
          input.proof,
          input.recipientNote,
          input.changeNote,
        ],
      },
      sponsorship(ctx, "legacy-transfer", { ...input, pool: poolAddress }),
    ),
  );
  const deposits = parseEventLogs({
    abi: maweePoolAbi,
    eventName: "Deposit",
    logs: receipt.logs,
  });
  if (deposits.length !== 2) {
    throw new Error("Transfer confirmed without both output notes.");
  }
  return {
    txHash: hash,
    recipientIndex: deposits[0].args.leafIndex,
    changeIndex: deposits[1].args.leafIndex,
  };
}

/** Testnet only: mint a pool's mock token into the user's Mawee wallet, or a
 *  payer's Privy wallet when they have no Mawee account. */
export async function relayMintTestUsdc(
  privyUserId: string,
  poolScope?: string,
  actionId?: string,
  ctx: Context = guest,
): Promise<{ txHash: string }> {
  const pool = poolScope ? findPool(poolScope) : activePool();
  if (!pool?.mintable) {
    throw new RelayRejectedError(
      "Test tokens are not available for this pool.",
    );
  }
  // A payer with no Mawee account mints into the Privy embedded wallet they
  // pay from, verified against Privy rather than taken from the client.
  const to =
    (await currentWallet(privyUserId))?.address ??
    ((await verifiedPrivyWallets(privyUserId))[0]?.address as
      | `0x${string}`
      | undefined);
  if (!to) {
    throw new RelayRejectedError("No wallet is linked to this account.");
  }
  const { hash } = await relay(() =>
    relayWrite(
      {
        address: pool.token,
        abi: erc20Abi,
        functionName: "mint",
        args: [to, TEST_USDC_MINT_UNITS],
      },
      sponsorship(ctx, "faucet", {
        id: actionId,
        pool: pool.scope,
        recipient: to,
        amount: TEST_USDC_MINT_UNITS,
      }),
    ),
  );
  return { txHash: hash };
}
