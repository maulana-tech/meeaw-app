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
  keccak256,
  type Log,
  parseEventLogs,
  parseSignature,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { monad, monadTestnet } from "viem/chains";
import { env } from "../env";
import {
  canonicalRelayRevert,
  completePendingAction,
  pendingActionId,
  unsignedSponsorshipReleased,
} from "../features/sponsorship/pendingAction";
import { completeFaucet } from "../features/sponsorship/pendingFaucet";
import { api } from "../trpc/client";
import { erc20Abi, maweePoolAbi, maweeRegistryAbi } from "./abi";
import { bytesToHex, fromBaseUnits, hexToBytes } from "./crypto";
import { activePool, type PoolDescriptor } from "./pools";
import type { EvmProof } from "./prover";
import {
  depositTypedData,
  permitTypedData,
  registryTypedData,
} from "./typedData";

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
/** The active pool: deposits and new notes go here (see lib/pools.ts). */
export const poolAddress = activePool().address as Address;
export const usdcAddress = activePool().token as Address;
export const poolDeployBlock = BigInt(activePool().deployBlock);

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

// --- gasless relay ---------------------------------------------------------
//
// When the server relayer is configured, users only sign: the relayer submits
// the transaction and pays the MON gas. Withdraw/transfer need no signature
// at all — their proofs are the authorization — which also keeps the user's
// wallet out of the withdrawal transaction.

let gaslessStatus: Promise<boolean> | null = null;

/** Configuration is refreshed between actions; allowance stays authoritative on the server. */
export function gaslessEnabled(): Promise<boolean> {
  if (gaslessStatus) return gaslessStatus;
  const request = api.relay.status
    .query()
    .then((status) => status.enabled)
    .catch(() => {
      throw new Error(
        "Gasless availability could not be checked. Try again before continuing.",
      );
    });
  gaslessStatus = request;
  const clear = () => {
    if (gaslessStatus === request) gaslessStatus = null;
  };
  request.then(clear, clear);
  return request;
}

const SIGNATURE_TTL_SECONDS = 15n * 60n;

function signatureDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000)) + SIGNATURE_TTL_SECONDS;
}

/** tRPC carries JSON, so uint256 values travel as decimal strings. */
function proofJson(proof: EvmProof) {
  const d = (x: bigint) => x.toString();
  return {
    a: [d(proof.a[0]), d(proof.a[1])] as [string, string],
    b: [
      [d(proof.b[0][0]), d(proof.b[0][1])],
      [d(proof.b[1][0]), d(proof.b[1][1])],
    ] as [[string, string], [string, string]],
    c: [d(proof.c[0]), d(proof.c[1])] as [string, string],
  };
}

async function relayRegistryWrite(
  signer: Signer,
  rotate: boolean,
  username: string,
  notePubkey: Hex,
  viewPubkey: Hex,
): Promise<void> {
  const nonce = await publicClient.readContract({
    address: registryAddress,
    abi: maweeRegistryAbi,
    functionName: "nonces",
    args: [signer.address],
  });
  const deadline = signatureDeadline();
  const signature = await signer.walletClient.signTypedData({
    account: signer.address,
    ...registryTypedData({
      rotate,
      chainId: chain.id,
      registry: registryAddress,
      owner: signer.address,
      username,
      notePubkey,
      viewPubkey,
      nonce,
      deadline,
    }),
  });
  await api.relay.register.mutate({
    username,
    notePubkey,
    viewPubkey,
    deadline: deadline.toString(),
    signature,
    rotate,
  });
}

/** EIP-712 domain of a pool asset's permit, read from the token itself. */
async function permitDomain(token: Address): Promise<{
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}> {
  try {
    const [, name, version, chainId, verifyingContract] =
      await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "eip712Domain",
      });
    return { name, version, chainId: Number(chainId), verifyingContract };
  } catch {
    // Tokens without ERC-5267 (e.g. FiatToken) expose name()/version().
    const [name, version] = await Promise.all([
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "name",
      }),
      publicClient
        .readContract({
          address: token,
          abi: erc20Abi,
          functionName: "version",
        })
        .catch(() => "1"),
    ]);
    return { name, version, chainId: chain.id, verifyingContract: token };
  }
}

async function relayDeposit(
  signer: Signer,
  pool: PoolDescriptor,
  commitment: Hex,
  amount: bigint,
  proof: EvmProof,
  ephemeralPk: Hex,
  ciphertext: Hex,
  isCurrent: () => boolean = () => true,
): Promise<{ leafIndex: number; txHash: string }> {
  const [poolNonce, allowance] = await Promise.all([
    publicClient.readContract({
      address: pool.address,
      abi: maweePoolAbi,
      functionName: "nonces",
      args: [signer.address],
    }),
    publicClient.readContract({
      address: pool.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [signer.address, pool.address],
    }),
  ]);
  const deadline = signatureDeadline();

  // Permit only when the pool cannot already pull the funds.
  let permit: {
    value: string;
    deadline: string;
    v: number;
    r: Hex;
    s: Hex;
  } | null = null;
  if (allowance < amount) {
    const tokenNonce = await publicClient.readContract({
      address: pool.token,
      abi: erc20Abi,
      functionName: "nonces",
      args: [signer.address],
    });
    if (!isCurrent())
      throw new Error("The payment selection changed. Review again.");
    const permitSignature = await signer.walletClient.signTypedData({
      account: signer.address,
      ...permitTypedData({
        domain: await permitDomain(pool.token),
        owner: signer.address,
        spender: pool.address,
        value: amount,
        nonce: tokenNonce,
        deadline,
      }),
    });
    const { r, s, v, yParity } = parseSignature(permitSignature);
    permit = {
      value: amount.toString(),
      deadline: deadline.toString(),
      v: Number(v ?? BigInt(yParity + 27)),
      r,
      s,
    };
  }

  if (!isCurrent())
    throw new Error("The payment selection changed. Review again.");
  const signature = await signer.walletClient.signTypedData({
    account: signer.address,
    ...depositTypedData({
      chainId: chain.id,
      pool: pool.address,
      payer: signer.address,
      commitment,
      amount,
      ephemeralPk,
      ciphertextHash: keccak256(ciphertext),
      nonce: poolNonce,
      deadline,
    }),
  });

  if (!isCurrent())
    throw new Error("The payment selection changed. Review again.");
  return api.relay.deposit.mutate({
    pool: pool.scope,
    payer: signer.address,
    commitment,
    amount: amount.toString(),
    proof: proofJson(proof),
    ephemeralPk,
    ciphertext,
    deadline: deadline.toString(),
    signature,
    permit,
  });
}

// --- token -----------------------------------------------------------------

/** Wallet balance of a pool's token (the primary USDC pool by default). */
export async function tokenBalance(
  owner: string,
  pool: PoolDescriptor = activePool(),
): Promise<bigint> {
  if (pool.token === ZERO || !isEvmAddress(owner)) return 0n;
  try {
    return await publicClient.readContract({
      address: pool.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [getAddress(owner)],
    });
  } catch {
    return 0n;
  }
}

export function usdcBalance(owner: string): Promise<bigint> {
  return tokenBalance(owner);
}

export async function usdcBalanceLabel(owner: string): Promise<string> {
  return fromBaseUnits(await usdcBalance(owner));
}

export type AccountStatus = {
  usdc: string;
  gas: string;
};

export async function accountStatus(
  address: string,
  pool: PoolDescriptor = activePool(),
): Promise<AccountStatus> {
  const [usdc, gas] = await Promise.all([
    tokenBalance(address, pool),
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
  if (await gaslessEnabled()) {
    await relayRegistryWrite(
      signer,
      false,
      username,
      hexOf(notePubkey),
      hexOf(viewPubkey),
    );
    return;
  }
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
  if (await gaslessEnabled()) {
    const owned = await usernameOfOnChain(signer.address);
    await relayRegistryWrite(signer, owned === username, ...args);
    return;
  }
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
  pool: PoolDescriptor = activePool(),
  isCurrent: () => boolean = () => true,
): Promise<{ leafIndex: number; txHash: string }> {
  if (pool.role !== "active")
    throw new Error("This pool no longer takes deposits.");
  if (await gaslessEnabled()) {
    return relayDeposit(
      signer,
      pool,
      hexOf(commitment),
      amount,
      proof,
      hexOf(ephemeralPk),
      hexOf(ciphertext),
      isCurrent,
    );
  }
  const allowance = await publicClient.readContract({
    address: pool.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [signer.address, pool.address],
  });
  if (allowance < amount) {
    if (!isCurrent())
      throw new Error("The payment selection changed. Review again.");
    await send(signer, {
      address: pool.token,
      abi: erc20Abi,
      functionName: "approve",
      args: [pool.address, amount],
    });
  }
  if (!isCurrent())
    throw new Error("The payment selection changed. Review again.");
  const { hash, receipt } = await send(signer, {
    address: pool.address,
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

/** Whether the primary (USDC) pool's token can be minted for demos. */
export const usdcMintable = activePool().mintable;

/** Testnet only: mint a pool's mock token to the signer to fund demos. */
export async function mintTestUsdc(
  signer: Signer,
  amount: bigint,
  pool: PoolDescriptor = activePool(),
  actionId: string = crypto.randomUUID(),
): Promise<string> {
  if (!pool.mintable) throw new Error("Test tokens are not available here.");
  if (await gaslessEnabled()) {
    // The relayer mints a fixed amount to the caller's bound wallet.
    try {
      return (
        await api.relay.mintTestUsdc.mutate({ pool: pool.scope, id: actionId })
      ).txHash;
    } catch (error) {
      if (canonicalRelayRevert(error) || unsignedSponsorshipReleased(error))
        completeFaucet(localStorage, signer.address, pool.scope, actionId);
      throw error;
    }
  }
  const { hash } = await send(signer, {
    address: pool.token,
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

/**
 * Spend a note to `recipient`. With the relayer, no signer is needed: the
 * proof binds the recipient and amount, so the relayer cannot redirect it.
 * `pool` is the note's own pool; legacy notes withdraw from their legacy pool.
 */
export async function poolWithdraw(
  signer: Signer | null,
  recipient: string,
  amount: bigint,
  root: Uint8Array,
  nullifier: Uint8Array,
  proof: EvmProof,
  pool: PoolDescriptor = activePool(),
  batchId?: string,
  isCurrent?: () => boolean,
): Promise<string> {
  const sponsored = await gaslessEnabled();
  if (isCurrent && !isCurrent())
    throw new Error("The private account changed during cash-out.");
  if (sponsored) {
    const key = `mawee:relay-withdraw:${keccak256(new TextEncoder().encode(`${pool.scope}:${hexOf(nullifier)}:${recipient.toLowerCase()}:${amount}`))}`;
    const id = batchId ? undefined : pendingActionId(localStorage, key);
    try {
      const { txHash } = await api.relay.withdraw.mutate({
        id,
        batchId,
        pool: pool.scope,
        recipient: getAddress(recipient),
        amount: amount.toString(),
        root: hexOf(root),
        nullifier: hexOf(nullifier),
        proof: proofJson(proof),
      });
      if (id) completePendingAction(localStorage, key, id);
      return txHash;
    } catch (error) {
      if (
        id &&
        (canonicalRelayRevert(error) || unsignedSponsorshipReleased(error))
      )
        completePendingAction(localStorage, key, id);
      throw error;
    }
  }
  if (batchId)
    throw new Error(
      "Gas sponsorship is temporarily unavailable. Resume this cash-out when it returns.",
    );
  if (!signer) throw new Error("Connect a wallet with MON to pay gas.");
  const { hash } = await send(signer, {
    address: pool.address,
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
  signer: Signer | null,
  root: Uint8Array,
  nullifier: Uint8Array,
  proof: EvmProof,
  recipient: TransferNote,
  change: TransferNote,
): Promise<{ recipientIndex: number; changeIndex: number }> {
  if (await gaslessEnabled()) {
    const key = `mawee:relay-transfer:${keccak256(new TextEncoder().encode(`${hexOf(nullifier)}:${hexOf(recipient.commitment)}:${hexOf(change.commitment)}`))}`,
      id = pendingActionId(localStorage, key);
    try {
      const { recipientIndex, changeIndex } = await api.relay.transfer.mutate({
        id,
        root: hexOf(root),
        nullifier: hexOf(nullifier),
        proof: proofJson(proof),
        recipientNote: noteOutput(recipient),
        changeNote: noteOutput(change),
      });
      completePendingAction(localStorage, key, id);
      return { recipientIndex, changeIndex };
    } catch (error) {
      if (canonicalRelayRevert(error) || unsignedSponsorshipReleased(error))
        completePendingAction(localStorage, key, id);
      throw error;
    }
  }
  if (!signer) throw new Error("Connect a wallet with MON to pay gas.");
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

export async function isSpent(
  nullifierBytes: Uint8Array,
  pool: PoolDescriptor = activePool(),
): Promise<boolean> {
  return publicClient.readContract({
    address: pool.address,
    abi: maweePoolAbi,
    functionName: "isSpent",
    args: [hexOf(nullifierBytes)],
  });
}

export async function poolLeafCount(
  pool: PoolDescriptor = activePool(),
): Promise<number> {
  return publicClient.readContract({
    address: pool.address,
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
 * chunks because public Monad RPCs cap eth_getLogs spans. Four chunks are
 * fetched concurrently, with results consumed in block order. At most
 * `maxChunks` requests run per call; `scannedTo` reports how far it got.
 */
export async function fetchPoolLogs(options: {
  afterBlock: bigint;
  blockRange: number;
  maxChunks?: number;
  pool?: PoolDescriptor;
}): Promise<{ logs: PoolLog[]; scannedTo: bigint; latestBlock: bigint }> {
  const pool = options.pool ?? activePool();
  const deployBlock = BigInt(pool.deployBlock);
  const latestBlock = await publicClient.getBlockNumber();
  const step = BigInt(options.blockRange);
  const maxChunks = options.maxChunks ?? 500;
  let from =
    options.afterBlock + 1n > deployBlock
      ? options.afterBlock + 1n
      : deployBlock;
  let scannedTo = options.afterBlock;
  const logs: PoolLog[] = [];
  for (let i = 0; i < maxChunks && from <= latestBlock; ) {
    const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
    while (ranges.length < 4 && i < maxChunks && from <= latestBlock) {
      const to =
        from + step - 1n < latestBlock ? from + step - 1n : latestBlock;
      ranges.push({ fromBlock: from, toBlock: to });
      from = to + 1n;
      i += 1;
    }
    const results = await Promise.all(
      ranges.map((range) =>
        publicClient.getLogs({
          address: pool.address,
          ...range,
        }),
      ),
    );
    for (const raw of results) logs.push(...parsePoolLogs(raw));
    scannedTo = ranges[ranges.length - 1].toBlock;
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
