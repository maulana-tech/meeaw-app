// Monad (EVM) client for the Mawee registry and shielded pool. Reads go through
// a shared public client; writes go through the caller's wallet client (Privy
// embedded wallet for recipients, an injected wallet for payers).

import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  defineChain,
  getAddress,
  type Hash,
  type Hex,
  http,
  isAddress,
  type Log,
  parseEventLogs,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { monad, monadTestnet } from "viem/chains";
import { env } from "../env";
import { api } from "../trpc/client";
import { erc20Abi, maweePoolAbi, maweeRegistryAbi } from "./abi";
import { bytesToHex, fromBaseUnits, hexToBytes } from "./crypto";
import type { EvmProof } from "./prover";

const localChain = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

function chainFor(id: number) {
  if (id === monad.id) return monad;
  if (id === monadTestnet.id) return monadTestnet;
  if (id === localChain.id) return localChain;
  throw new Error(`Unsupported NEXT_PUBLIC_MONAD_CHAIN_ID ${id}.`);
}

export const chain = chainFor(env.NEXT_PUBLIC_MONAD_CHAIN_ID);
export const isMainnet = chain.id === monad.id;
const configuredRpcUrl = env.NEXT_PUBLIC_MONAD_RPC_URL;
if (isMainnet && !configuredRpcUrl) {
  throw new Error("NEXT_PUBLIC_MONAD_RPC_URL must be configured for mainnet.");
}
export const rpcUrl = configuredRpcUrl || chain.rpcUrls.default.http[0];

/** Scope tag stored with mirrored data so a chain/pool change resets caches. */
export const network = `eip155:${chain.id}`;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
export const registryAddress = (env.NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS ??
  ZERO) as Address;
export const poolAddress = (env.NEXT_PUBLIC_MAWEE_POOL_ADDRESS ??
  ZERO) as Address;
export const usdcAddress = (env.NEXT_PUBLIC_USDC_ADDRESS ?? ZERO) as Address;
export const poolDeployBlock = BigInt(env.NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK);

export const publicClient = createPublicClient({
  chain,
  transport: http(rpcUrl),
});

const explorerBase = chain.blockExplorers?.default.url;

export function explorerTxUrl(txHash: string): string {
  return explorerBase ? `${explorerBase}/tx/${txHash}` : "";
}

export function explorerAddressUrl(address: string): string {
  return explorerBase ? `${explorerBase}/address/${address}` : "";
}

export function isEvmAddress(value: string): value is Address {
  return isAddress(value.trim(), { strict: false });
}

// --- signing ---------------------------------------------------------------

/** Who pays gas and authorizes a write. */
export type Signer = {
  address: Address;
  walletClient: WalletClient;
};

type WriteRequest = Parameters<WalletClient["writeContract"]>[0];

async function send(
  signer: Signer,
  request: Omit<WriteRequest, "account" | "chain">,
): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
  const hash = await signer.walletClient.writeContract({
    ...request,
    account: signer.address,
    chain,
  } as WriteRequest);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }
  return { hash, receipt };
}

/** The custom-error name of a contract revert, if viem could decode one. */
export function revertErrorName(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError
    ? (revert.data?.errorName ?? null)
    : null;
}

// --- token -----------------------------------------------------------------

export async function usdcBalance(owner: string): Promise<bigint> {
  if (usdcAddress === ZERO || !isEvmAddress(owner)) return 0n;
  try {
    return await publicClient.readContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [getAddress(owner)],
    });
  } catch {
    return 0n;
  }
}

export async function usdcBalanceLabel(owner: string): Promise<string> {
  return fromBaseUnits(await usdcBalance(owner));
}

export type AccountStatus = {
  usdc: string;
  gas: string;
};

export async function accountStatus(address: string): Promise<AccountStatus> {
  const [usdc, gas] = await Promise.all([
    usdcBalance(address),
    isEvmAddress(address)
      ? publicClient
          .getBalance({ address: getAddress(address) })
          .catch(() => 0n)
      : Promise.resolve(0n),
  ]);
  const mon = Number(gas) / 1e18;
  return {
    usdc: fromBaseUnits(usdc),
    gas: mon.toLocaleString(undefined, { maximumFractionDigits: 4 }),
  };
}

// --- registry --------------------------------------------------------------

export type MaweeAccount = {
  owner: string;
  note_pubkey: Uint8Array;
  view_pubkey: Uint8Array;
  created: bigint;
};

const REGISTRY_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  UsernameTaken: "That username is already owned by another account.",
  OwnerHasUsername: "This wallet already owns a different username.",
  UsernameNotFound: "Your username was not found on the current network.",
  UsernameTooShort: "Username must be at least 3 characters.",
  UsernameTooLong: "Username must be no more than 32 characters.",
  UsernameInvalidCharacter:
    "Usernames can only use lowercase letters, numbers and underscores.",
};

function friendlyRegistryError(error: unknown): unknown {
  const name = revertErrorName(error);
  return name === null
    ? error
    : new Error(
        REGISTRY_ERROR_MESSAGES[name] ??
          "The username registry rejected this request. Please try again.",
        { cause: error },
      );
}

const hexOf = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`;

export async function registerUsername(
  signer: Signer,
  username: string,
  notePubkey: Uint8Array,
  viewPubkey: Uint8Array,
): Promise<void> {
  try {
    await send(signer, {
      address: registryAddress,
      abi: maweeRegistryAbi,
      functionName: "register",
      args: [username, hexOf(notePubkey), hexOf(viewPubkey)],
    });
  } catch (error) {
    throw friendlyRegistryError(error);
  }
}

export async function setUsernamePubkeys(
  signer: Signer,
  username: string,
  notePubkey: Uint8Array,
  viewPubkey: Uint8Array,
): Promise<void> {
  const args = [username, hexOf(notePubkey), hexOf(viewPubkey)] as const;
  try {
    await send(signer, {
      address: registryAddress,
      abi: maweeRegistryAbi,
      functionName: "setPubkeys",
      args,
    });
  } catch (error) {
    if (revertErrorName(error) !== "UsernameNotFound") {
      throw friendlyRegistryError(error);
    }
    try {
      await send(signer, {
        address: registryAddress,
        abi: maweeRegistryAbi,
        functionName: "register",
        args,
      });
    } catch (registerError) {
      throw friendlyRegistryError(registerError);
    }
  }
}

export async function resolveUsernameOnChain(
  username: string,
): Promise<MaweeAccount | null> {
  try {
    const rec = await publicClient.readContract({
      address: registryAddress,
      abi: maweeRegistryAbi,
      functionName: "resolve",
      args: [username],
    });
    return {
      owner: rec.owner,
      note_pubkey: hexToBytes(rec.notePubkey),
      view_pubkey: hexToBytes(rec.viewPubkey),
      created: rec.created,
    };
  } catch (error) {
    if (revertErrorName(error) === "UsernameNotFound") return null;
    throw error;
  }
}

export async function usernameOfOnChain(owner: string): Promise<string | null> {
  if (!isEvmAddress(owner)) return null;
  const name = await publicClient.readContract({
    address: registryAddress,
    abi: maweeRegistryAbi,
    functionName: "usernameOf",
    args: [getAddress(owner)],
  });
  return name || null;
}

export async function resolveUsername(
  username: string,
): Promise<MaweeAccount | null> {
  try {
    const rec = await api.usernames.resolve.query({ username });
    if (!rec) return null;
    return {
      owner: rec.owner,
      note_pubkey: hexToBytes(rec.notePubkeyHex),
      view_pubkey: hexToBytes(rec.viewPubkeyHex),
      created: BigInt(Math.floor(new Date(rec.createdAt).getTime() / 1000)),
    };
  } catch {
    return resolveUsernameOnChain(username);
  }
}

export async function usernameOf(owner: string): Promise<string | null> {
  try {
    return await api.usernames.byOwner.query({ owner });
  } catch {
    return usernameOfOnChain(owner);
  }
}

export async function registerUsernameCache(username: string): Promise<void> {
  await api.usernames.register.mutate({ username });
}

// --- pool ------------------------------------------------------------------

/**
 * Pay `amount` into a private note. Approves the pool for exactly `amount`
 * first when the current allowance is short, so no standing approval remains.
 */
export async function poolDeposit(
  signer: Signer,
  commitment: Uint8Array,
  amount: bigint,
  proof: EvmProof,
  ephemeralPk: Uint8Array,
  ciphertext: Uint8Array,
): Promise<{ leafIndex: number; txHash: string }> {
  const allowance = await publicClient.readContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: [signer.address, poolAddress],
  });
  if (allowance < amount) {
    await send(signer, {
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [poolAddress, amount],
    });
  }
  const { hash, receipt } = await send(signer, {
    address: poolAddress,
    abi: maweePoolAbi,
    functionName: "deposit",
    args: [
      hexOf(commitment),
      amount,
      proof,
      hexOf(ephemeralPk),
      hexOf(ciphertext),
    ],
  });
  const [event] = parseEventLogs({
    abi: maweePoolAbi,
    eventName: "Deposit",
    logs: receipt.logs,
  });
  if (!event) throw new Error("Deposit confirmed without a Deposit event.");
  return { leafIndex: event.args.leafIndex, txHash: hash };
}

export const usdcMintable = env.NEXT_PUBLIC_USDC_MINTABLE && !isMainnet;

/** Testnet only: mint MockUSDC to the signer so demos can be funded freely. */
export async function mintTestUsdc(
  signer: Signer,
  amount: bigint,
): Promise<string> {
  if (!usdcMintable) throw new Error("Test USDC minting is not available.");
  const { hash } = await send(signer, {
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "mint",
    args: [signer.address, amount],
  });
  return hash;
}

export const gasFaucetUrl = chain.testnet ? "https://faucet.monad.xyz" : "";

export async function transferUsdc(
  signer: Signer,
  destination: string,
  amount: bigint,
): Promise<string> {
  const { hash } = await send(signer, {
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [getAddress(destination), amount],
  });
  return hash;
}

export async function poolWithdraw(
  signer: Signer,
  recipient: string,
  amount: bigint,
  root: Uint8Array,
  nullifier: Uint8Array,
  proof: EvmProof,
): Promise<string> {
  const { hash } = await send(signer, {
    address: poolAddress,
    abi: maweePoolAbi,
    functionName: "withdraw",
    args: [getAddress(recipient), amount, hexOf(root), hexOf(nullifier), proof],
  });
  return hash;
}

export type TransferNote = {
  commitment: Uint8Array;
  ephemeralPk: Uint8Array;
  ciphertext: Uint8Array;
};

const noteOutput = (note: TransferNote) => ({
  commitment: hexOf(note.commitment),
  ephemeralPk: hexOf(note.ephemeralPk),
  ciphertext: hexOf(note.ciphertext),
});

export async function poolTransfer(
  signer: Signer,
  root: Uint8Array,
  nullifier: Uint8Array,
  proof: EvmProof,
  recipient: TransferNote,
  change: TransferNote,
): Promise<{ recipientIndex: number; changeIndex: number }> {
  const { receipt } = await send(signer, {
    address: poolAddress,
    abi: maweePoolAbi,
    functionName: "transfer",
    args: [
      hexOf(root),
      hexOf(nullifier),
      proof,
      noteOutput(recipient),
      noteOutput(change),
    ],
  });
  const deposits = parseEventLogs({
    abi: maweePoolAbi,
    eventName: "Deposit",
    logs: receipt.logs,
  });
  if (deposits.length !== 2) {
    throw new Error("Transfer confirmed without both output notes.");
  }
  return {
    recipientIndex: deposits[0].args.leafIndex,
    changeIndex: deposits[1].args.leafIndex,
  };
}

export async function isSpent(nullifierBytes: Uint8Array): Promise<boolean> {
  return publicClient.readContract({
    address: poolAddress,
    abi: maweePoolAbi,
    functionName: "isSpent",
    args: [hexOf(nullifierBytes)],
  });
}

export async function poolLeafCount(): Promise<number> {
  return publicClient.readContract({
    address: poolAddress,
    abi: maweePoolAbi,
    functionName: "nextIndex",
  });
}

// --- events ----------------------------------------------------------------

export type DepositEvent = {
  leafIndex: number;
  commitment: Uint8Array;
  ephemeralPk: Uint8Array;
  ciphertext: Uint8Array;
  receivedAt?: string;
};

export type SpentEvent = {
  nullifierHex: string;
};

export type PoolLog = {
  kind: "deposit" | "spend";
  blockNumber: bigint;
  txHash: Hash;
  logIndex: number;
  deposit?: DepositEvent;
  spent?: SpentEvent;
};

export function parsePoolLogs(logs: Log[]): PoolLog[] {
  const out: PoolLog[] = [];
  for (const log of parseEventLogs({
    abi: maweePoolAbi,
    logs,
    strict: true,
  })) {
    const base = {
      blockNumber: log.blockNumber ?? 0n,
      txHash: log.transactionHash ?? ("0x" as Hash),
      logIndex: log.logIndex ?? 0,
    };
    if (log.eventName === "Deposit") {
      out.push({
        ...base,
        kind: "deposit",
        deposit: {
          leafIndex: log.args.leafIndex,
          commitment: hexToBytes(log.args.commitment),
          ephemeralPk: hexToBytes(log.args.ephemeralPk),
          ciphertext: hexToBytes(log.args.ciphertext),
        },
      });
    } else if (log.eventName === "Spend") {
      out.push({
        ...base,
        kind: "spend",
        spent: { nullifierHex: log.args.nullifier.slice(2).toLowerCase() },
      });
    }
  }
  return out;
}

/**
 * Pool Deposit/Spend logs in (fromBlock, toBlock], fetched in `blockRange`
 * chunks because public Monad RPCs cap eth_getLogs spans. At most
 * `maxChunks` requests run per call; `scannedTo` reports how far it got.
 */
export async function fetchPoolLogs(options: {
  afterBlock: bigint;
  blockRange: number;
  maxChunks?: number;
}): Promise<{ logs: PoolLog[]; scannedTo: bigint; latestBlock: bigint }> {
  const latestBlock = await publicClient.getBlockNumber();
  const step = BigInt(options.blockRange);
  const maxChunks = options.maxChunks ?? 500;
  let from =
    options.afterBlock + 1n > poolDeployBlock
      ? options.afterBlock + 1n
      : poolDeployBlock;
  let scannedTo = options.afterBlock;
  const logs: PoolLog[] = [];
  for (let i = 0; i < maxChunks && from <= latestBlock; i += 1) {
    const to = from + step - 1n < latestBlock ? from + step - 1n : latestBlock;
    const raw = await publicClient.getLogs({
      address: poolAddress,
      fromBlock: from,
      toBlock: to,
    });
    logs.push(...parsePoolLogs(raw));
    scannedTo = to;
    from = to + 1n;
  }
  return { logs, scannedTo, latestBlock };
}

export async function scanDepositsOnChain(): Promise<DepositEvent[]> {
  const { logs } = await fetchPoolLogs({
    afterBlock: poolDeployBlock > 0n ? poolDeployBlock - 1n : 0n,
    blockRange: 100,
  });
  return logs
    .flatMap((l) => (l.deposit ? [l.deposit] : []))
    .sort((a, b) => a.leafIndex - b.leafIndex);
}

export async function scanDeposits(): Promise<DepositEvent[]> {
  try {
    const rows = await api.deposits.list.query({ since: -1 });
    return rows
      .map((r) => ({
        leafIndex: r.leafIndex,
        commitment: hexToBytes(r.commitmentHex),
        ephemeralPk: hexToBytes(r.ephemeralPkHex),
        ciphertext: hexToBytes(r.ciphertextHex),
        receivedAt: r.ts,
      }))
      .sort((a, b) => a.leafIndex - b.leafIndex);
  } catch {
    return scanDepositsOnChain();
  }
}
