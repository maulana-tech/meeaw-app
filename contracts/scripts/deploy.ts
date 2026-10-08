// Deploy a Merge-capable pool, then write explicit review candidates. Nothing
// redirects the app or indexer; activation is a separate reviewed operation.
//
//   DEPLOYER_PRIVATE_KEY=<secret> pnpm --filter contracts exec hardhat run scripts/deploy.ts --network monadTestnet
//   Inspect .deploy-candidates/<network>-<chain>-<block>-<pool>/ before activation.
//
// ASSET=AUSD|USDT0|MUSD adds a pool for that stablecoin next to the live USDC
// pool instead of replacing it. TOKEN_ADDRESS names the token (required on
// mainnet, where it must be the canonical one); on testnet a MockStablecoin is
// deployed when it is unset.

import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { getAddress, isAddress } from "viem";
import {
  ASSETS,
  type AssetSymbol,
  MAINNET_TOKENS,
  candidateManifest,
  configuredIndexerAddresses,
  manifestForChain,
  readPublicSetting,
  renderIndexerCandidate,
  writeDeploymentCandidates,
  type CandidatePool,
} from "./deployment-config";

const ROOT = path.resolve(__dirname, "../..");
const SOURCE_ENV = path.join(ROOT, "web/.env.local");
const SOURCE_INDEXER = path.join(ROOT, "indexer/config.yaml");
const ZERO = "0x0000000000000000000000000000000000000000";
const ERC20_DECIMALS_ABI = [
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;

function publicAddress(name: string): `0x${string}` | undefined {
  const value = readPublicSetting(SOURCE_ENV, name);
  if (!value) return undefined;
  if (!isAddress(value, { strict: false })) {
    throw new Error(`${name} is not a valid public address.`);
  }
  return getAddress(value);
}

function tokenDecimals(value: string | undefined): number {
  const parsed = Number(value ?? "6");
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 18) {
    throw new Error("USDC_DECIMALS must be an integer from 0 to 18.");
  }
  return parsed;
}

function previousPool(
  chainId: number,
  indexerPools: readonly string[],
  useConfiguredEnvironment: boolean,
): CandidatePool | null {
  if (indexerPools.length > 1) {
    throw new Error(
      "Add a verified descriptor for every indexed pool before enabling pool history.",
    );
  }
  const address =
    (useConfiguredEnvironment
      ? publicAddress("NEXT_PUBLIC_MAWEE_POOL_ADDRESS")
      : undefined) ?? indexerPools[0];
  if (!address || address.toLowerCase() === ZERO) return null;
  const token = useConfiguredEnvironment
    ? publicAddress("NEXT_PUBLIC_USDC_ADDRESS")
    : undefined;
  if (!token || token.toLowerCase() === ZERO) {
    throw new Error(
      "The previous pool's USDC address is missing; no legacy candidate can be created safely.",
    );
  }
  const configuredBlock = Number(
    readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK") ?? "0",
  );
  if (!Number.isSafeInteger(configuredBlock) || configuredBlock < 0) {
    throw new Error("The previous pool's deployment block is invalid.");
  }
  return {
    chainId,
    address: address as `0x${string}`,
    deployBlock: configuredBlock,
    token,
    tokenDecimals: tokenDecimals(
      useConfiguredEnvironment
        ? readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_USDC_DECIMALS")
        : undefined,
    ),
    depth: 20,
    confirmations: 1,
    role: "legacy",
    requestCapable: false,
  };
}

function requestedAsset(): AssetSymbol {
  const asset = process.env.ASSET ?? "USDC";
  if (!(ASSETS as readonly string[]).includes(asset)) {
    throw new Error(`ASSET must be one of ${ASSETS.join(", ")}.`);
  }
  return asset as AssetSymbol;
}

async function main() {
  const asset = requestedAsset();
  const isUsdc = asset === "USDC";
  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) throw new Error("Set DEPLOYER_PRIVATE_KEY to deploy.");
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const requestedAdmin = process.env.POOL_ADMIN ?? deployer.account.address;
  if (!isAddress(requestedAdmin, { strict: false })) {
    throw new Error("POOL_ADMIN is not a valid address.");
  }
  const admin = getAddress(requestedAdmin);
  if (admin.toLowerCase() === ZERO) {
    throw new Error("POOL_ADMIN cannot be the zero address.");
  }
  console.log(
    `network=${hre.network.name} chainId=${chainId} asset=${asset} deployer=${deployer.account.address}`,
  );

  if (!fs.existsSync(SOURCE_INDEXER)) {
    throw new Error("indexer/config.yaml is required to produce a candidate.");
  }
  const sourceIndexer = fs.readFileSync(SOURCE_INDEXER, "utf8");
  // The checked-in config is a template with 0x0 placeholders; those mean
  // "nothing indexed yet", not a pool.
  const indexedPools = configuredIndexerAddresses(sourceIndexer, chainId, "Pool").filter(
    (address) => address !== ZERO,
  );
  const indexedRegistries = configuredIndexerAddresses(
    sourceIndexer,
    chainId,
    "Registry",
  );
  if (indexedRegistries.length > 1) {
    throw new Error("The selected indexer chain has multiple Registry addresses.");
  }

  const configuredChainValue = readPublicSetting(
    SOURCE_ENV,
    "NEXT_PUBLIC_MONAD_CHAIN_ID",
  );
  const configuredChain = Number(configuredChainValue ?? chainId);
  if (!Number.isSafeInteger(configuredChain) || configuredChain < 1) {
    throw new Error("NEXT_PUBLIC_MONAD_CHAIN_ID is invalid.");
  }
  const sameConfiguredChain = configuredChain === chainId;
  const priorManifest = sameConfiguredChain
    ? manifestForChain(
        readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_MAWEE_POOLS"),
        chainId,
      )
    : undefined;

  let oldPool: CandidatePool | null = null;
  if (priorManifest) {
    const descriptors = JSON.parse(priorManifest) as { address: string }[];
    const described = new Set(descriptors.map((pool) => pool.address.toLowerCase()));
    if (indexedPools.some((address) => !described.has(address.toLowerCase()))) {
      throw new Error(
        "Every indexed legacy pool must have a verified public descriptor before deployment.",
      );
    }
    if (descriptors.some((pool) => !indexedPools.includes(pool.address.toLowerCase()))) {
      throw new Error(
        "Every public pool must already be indexed before deployment; repair the pool manifest first.",
      );
    }
  } else {
    oldPool = previousPool(chainId, indexedPools, sameConfiguredChain);
    if (
      oldPool &&
      indexedPools.length > 0 &&
      !indexedPools.some((address) => address.toLowerCase() === oldPool!.address.toLowerCase())
    ) {
      throw new Error("The configured previous pool is missing from the indexer.");
    }
  }

  const previousRegistry = sameConfiguredChain
    ? publicAddress("NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS") ?? indexedRegistries[0]
    : indexedRegistries[0];
  let reuseRegistry = false;
  if (previousRegistry) {
    const code = await publicClient.getCode({ address: previousRegistry as `0x${string}` });
    if (!code || code === "0x") {
      throw new Error(
        "The configured username Registry has no code on this chain; verify the candidate source.",
      );
    }
    reuseRegistry = true;
  }

  let usdc = (isUsdc ? process.env.USDC_ADDRESS : process.env.TOKEN_ADDRESS) as
    | `0x${string}`
    | undefined;
  const configuredDecimals =
    process.env.USDC_DECIMALS ??
    (sameConfiguredChain
      ? readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_USDC_DECIMALS")
      : undefined);
  let decimals = tokenDecimals(configuredDecimals);
  let mintable = false;
  if (usdc) {
    if (!isAddress(usdc, { strict: false })) {
      throw new Error("USDC_ADDRESS is invalid.");
    }
    usdc = getAddress(usdc);
  } else if (sameConfiguredChain && isUsdc) {
    usdc = publicAddress("NEXT_PUBLIC_USDC_ADDRESS");
  }
  if (chainId === 143) {
    if (!usdc) throw new Error(`${isUsdc ? "USDC_ADDRESS" : "TOKEN_ADDRESS"} is required on mainnet.`);
    if (usdc.toLowerCase() !== MAINNET_TOKENS[asset]) {
      throw new Error(`${asset} pool must hold the canonical ${asset} token on mainnet.`);
    }
  }
  if (!isUsdc && !priorManifest && !oldPool) {
    throw new Error("Deploy the USDC pool first; other assets are added next to it.");
  }
  if (usdc) {
    if (usdc.toLowerCase() === ZERO) {
      throw new Error("USDC_ADDRESS cannot be the zero address.");
    }
    const code = await publicClient.getCode({ address: usdc });
    if (!code || code === "0x") {
      throw new Error("USDC_ADDRESS has no contract code on this chain.");
    }
    const actualDecimals = await publicClient.readContract({
      address: usdc,
      abi: ERC20_DECIMALS_ABI,
      functionName: "decimals",
    });
    if (
      !Number.isSafeInteger(actualDecimals) ||
      actualDecimals < 0 ||
      actualDecimals > 18 ||
      (configuredDecimals !== undefined && actualDecimals !== decimals)
    ) {
      throw new Error("Configured USDC decimals do not match the token contract.");
    }
    decimals = actualDecimals;
  }

  // All local manifest, indexer and token inputs have been checked before the
  // first deployment transaction is sent.
  const firstBlock = await publicClient.getBlockNumber();
  if (!usdc) {
    const mock = isUsdc
      ? await hre.viem.deployContract("MockUSDC")
      : await hre.viem.deployContract("MockStablecoin", [`Mock ${asset}`, asset]);
    usdc = mock.address;
    decimals = 6;
    mintable = true;
    console.log(`Mock ${asset}      ${usdc}`);
  }

  const poseidon = await hre.viem.deployContract(
    "poseidon-solidity/PoseidonT3.sol:PoseidonT3",
  );
  const depositVerifier = await hre.viem.deployContract("DepositVerifier");
  const withdrawVerifier = await hre.viem.deployContract("WithdrawVerifier");
  const transferVerifier = await hre.viem.deployContract("TransferVerifier");
  const mergeVerifier = await hre.viem.deployContract("MergeVerifier");
  const registry = reuseRegistry
    ? await (
        hre.viem.getContractAt as unknown as (
          name: string,
          address: `0x${string}`,
        ) => Promise<{ address: `0x${string}` }>
      )("MaweeRegistry", previousRegistry as `0x${string}`)
    : await hre.viem.deployContract("MaweeRegistry");
  const pool = await hre.viem.deployContract(
    "MaweePool",
    [
      admin,
      usdc,
      depositVerifier.address,
      withdrawVerifier.address,
      transferVerifier.address,
      mergeVerifier.address,
    ],
    {
      libraries: {
        "poseidon-solidity/PoseidonT3.sol:PoseidonT3": poseidon.address,
      },
    },
  );
  const deployBlock = await publicClient.getBlockNumber();
  const newPool: CandidatePool = {
    chainId,
    address: pool.address,
    deployBlock: Number(deployBlock),
    token: usdc,
    tokenDecimals: decimals,
    depth: 20,
    confirmations: 1,
    role: "active",
    asset,
    transferCapable:true,
    requestCapable:true,
    ...(!isUsdc?{mintable}:{}),
  };
  const manifest = candidateManifest({
    chainId,
    priorManifest,
    previousPool: oldPool,
    newPool,
    confirmations: 1,
  });
  const knownPools = [
    ...manifest.map((entry) => entry.address.toLowerCase()),
    ...indexedPools.map((address) => address.toLowerCase()),
  ];
  const candidateIndexer = renderIndexerCandidate(
    sourceIndexer,
    chainId,
    // Keep the configured start block: older pools stay indexed, whether they
    // remain active (other assets) or become withdrawal-only (same asset).
    null,
    { Pool: [...new Set(knownPools)], Registry: registry.address },
  );

  const output = writeDeploymentCandidates({
    root: ROOT,
    network: hre.network.name,
    chainId,
    deployBlock: Number(deployBlock),
    pool: pool.address,
    manifest,
    webValues: {
      NEXT_PUBLIC_MONAD_CHAIN_ID: String(chainId),
      NEXT_PUBLIC_MONAD_RPC_URL:
        readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_MONAD_RPC_URL") ?? "",
      NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS: registry.address,
      // These single-pool variables describe the USDC pool, which an added
      // asset leaves in place.
      ...(isUsdc
        ? {
            NEXT_PUBLIC_MAWEE_POOL_ADDRESS: pool.address,
            NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK: deployBlock.toString(),
            NEXT_PUBLIC_USDC_ADDRESS: usdc,
            NEXT_PUBLIC_USDC_MINTABLE: String(mintable),
          }
        : {
            NEXT_PUBLIC_MAWEE_POOL_ADDRESS:
              readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_MAWEE_POOL_ADDRESS") ?? "",
            NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK:
              readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK") ?? "",
            NEXT_PUBLIC_USDC_ADDRESS:
              readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_USDC_ADDRESS") ?? "",
            NEXT_PUBLIC_USDC_MINTABLE:
              readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_USDC_MINTABLE") ?? "false",
          }),
      NEXT_PUBLIC_USDC_DECIMALS: String(decimals),
      NEXT_PUBLIC_POOL_DEPTH: "20",
      NEXT_PUBLIC_MAWEE_POOLS: JSON.stringify(manifest),
      NEXT_PUBLIC_PRIVY_APP_ID:
        readPublicSetting(SOURCE_ENV, "NEXT_PUBLIC_PRIVY_APP_ID") ?? "",
    },
    indexerConfig: candidateIndexer,
  });

  console.log(
    `MaweePool candidate ${pool.address}; Registry ${reuseRegistry ? "reused" : "deployed"} ${registry.address}`,
  );
  console.log(
    `Wrote review candidates to ${path.relative(ROOT, output.directory)}. Live application/indexer settings were not changed.`,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Deployment candidate generation failed.",
  );
  process.exitCode = 1;
});
