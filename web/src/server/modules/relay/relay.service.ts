import "server-only";

import { parseEventLogs } from "viem";
import { erc20Abi, maweePoolAbi, maweeRegistryAbi } from "../../../lib/abi";
import {
  poolAddress,
  registryAddress,
  revertErrorName,
  usdcAddress,
  usdcMintable,
} from "../../../lib/chain";
import { USDC_DECIMALS } from "../../../lib/crypto";
import { activePool, findPool } from "../../../lib/pools";
import { relayerConfigured, relayWrite } from "../../lib/relayer";
import { currentWallet } from "../wallets/wallets.service";
import { RelayerUnavailableError, RelayRejectedError } from "./relay.errors";
import type {
  DepositInput,
  RegisterInput,
  TransferInput,
  WithdrawInput,
} from "./relay.schema";

export const TEST_USDC_MINT_UNITS = 100n * 10n ** BigInt(USDC_DECIMALS);

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
    const name = revertErrorName(error);
    if (name && REJECTIONS[name]) {
      throw new RelayRejectedError(REJECTIONS[name]);
    }
    console.error("[relay] submission failed", error);
    throw new Error("The transaction could not be submitted. Try again.");
  }
}

async function boundWallet(privyUserId: string): Promise<`0x${string}`> {
  const wallet = await currentWallet(privyUserId);
  if (!wallet) {
    throw new RelayRejectedError("No Mawee wallet is linked to this account.");
  }
  return wallet.address as `0x${string}`;
}

/** Registers or rotates keys for the signed-in user's own wallet only. */
export async function relayRegister(
  privyUserId: string,
  input: RegisterInput,
): Promise<{ txHash: string }> {
  const owner = await boundWallet(privyUserId);
  const { hash } = await relay(() =>
    relayWrite({
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
    }),
  );
  return { txHash: hash };
}

export async function relayDeposit(
  input: DepositInput,
): Promise<{ txHash: string; leafIndex: number }> {
  const permit = input.permit ?? {
    value: 0n,
    deadline: 0n,
    v: 0,
    r: `0x${"00".repeat(32)}` as const,
    s: `0x${"00".repeat(32)}` as const,
  };
  const { hash, receipt } = await relay(() =>
    relayWrite({
      address: poolAddress,
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
    }),
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
): Promise<{ txHash: string }> {
  // Legacy pools stay withdrawable; anything outside the manifest is refused.
  const pool = input.pool ? findPool(input.pool) : activePool();
  if (!pool) throw new RelayRejectedError("Unknown pool.");
  const { hash } = await relay(() =>
    relayWrite({
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
    }),
  );
  return { txHash: hash };
}

export async function relayTransfer(
  input: TransferInput,
): Promise<{ txHash: string; recipientIndex: number; changeIndex: number }> {
  const { hash, receipt } = await relay(() =>
    relayWrite({
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
    }),
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

/** Testnet only: mint MockUSDC straight into the user's Mawee wallet. */
export async function relayMintTestUsdc(
  privyUserId: string,
): Promise<{ txHash: string }> {
  if (!usdcMintable) {
    throw new RelayRejectedError("Test USDC is not available on this network.");
  }
  const to = await boundWallet(privyUserId);
  const { hash } = await relay(() =>
    relayWrite({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "mint",
      args: [to, TEST_USDC_MINT_UNITS],
    }),
  );
  return { txHash: hash };
}
