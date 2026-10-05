import fs from "node:fs";
import path from "node:path";
import type { Hex } from "viem";

export type CandidatePool = Readonly<{
  chainId: number;
  address: Hex;
  deployBlock: number;
  token: Hex;
  tokenDecimals: number;
  depth?: 20;
  confirmations?: number;
  role?: "active" | "legacy";
  requestCapable?: boolean;
}>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_POOLS = 8;
const MAX_CONFIRMATIONS = 64;

function validAddress(value: unknown): value is string {
  return typeof value === "string" && ADDRESS.test(value);
}

function validatePool(pool: CandidatePool, chainId: number): void {
  if (
    pool.chainId !== chainId ||
    !validAddress(pool.address) ||
    !validAddress(pool.token) ||
    !Number.isSafeInteger(pool.deployBlock) ||
    pool.deployBlock < 0 ||
    !Number.isSafeInteger(pool.tokenDecimals) ||
    pool.tokenDecimals < 0 ||
    pool.tokenDecimals > 18
  ) {
    throw new Error("Deployment pool descriptor is invalid.");
  }
}

function confirmations(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_CONFIRMATIONS
  ) {
    throw new Error("Pool confirmation setting is invalid.");
  }
  return value as number;
}

export function candidateManifest(input: {
  chainId: number;
  priorManifest?: string;
  previousPool?: CandidatePool | null;
  newPool: CandidatePool;
  confirmations: number;
}) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1) {
    throw new Error("Deployment chain is invalid.");
  }
  validatePool(input.newPool, input.chainId);
  const activeConfirmations = confirmations(input.confirmations);

  let prior: unknown = [];
  if (input.priorManifest) {
    try {
      prior = JSON.parse(input.priorManifest);
    } catch {
      throw new Error(
        "Existing public pool manifest is invalid. Refuse deployment until it is repaired.",
      );
    }
  }
  if (!Array.isArray(prior) || prior.length > MAX_POOLS) {
    throw new Error("Existing public pool manifest is not supported.");
  }

  const normalized: CandidatePool[] = prior.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Existing pool entry is invalid.");
    }
    const pool = entry as Record<string, unknown>;
    const allowed = new Set([
      "chainId",
      "address",
      "deployBlock",
      "token",
      "tokenDecimals",
      "depth",
      "confirmations",
      "role",
      "requestCapable",
    ]);
    if (Object.keys(pool).some((key) => !allowed.has(key))) {
      throw new Error("Existing pool manifest contains unsupported data.");
    }
    if (
      !Number.isSafeInteger(pool.chainId) ||
      pool.chainId !== input.chainId ||
      !validAddress(pool.address) ||
      !validAddress(pool.token) ||
      !Number.isSafeInteger(pool.deployBlock) ||
      (pool.deployBlock as number) < 0 ||
      !Number.isSafeInteger(pool.tokenDecimals) ||
      (pool.tokenDecimals as number) < 0 ||
      (pool.tokenDecimals as number) > 18 ||
      pool.depth !== 20 ||
      !["active", "legacy"].includes(pool.role as string) ||
      typeof pool.requestCapable !== "boolean"
    ) {
      throw new Error(
        "Existing public pool manifest cannot be retained safely.",
      );
    }
    return {
      chainId: input.chainId,
      address: pool.address.toLowerCase() as Hex,
      deployBlock: pool.deployBlock as number,
      token: pool.token.toLowerCase() as Hex,
      tokenDecimals: pool.tokenDecimals as number,
      depth: 20,
      confirmations: confirmations(pool.confirmations ?? 1),
      role: "legacy",
      requestCapable: false,
    };
  });

  if (input.previousPool) {
    validatePool(input.previousPool, input.chainId);
    const oldAddress = input.previousPool.address.toLowerCase();
    if (
      oldAddress !== ZERO &&
      oldAddress !== input.newPool.address.toLowerCase() &&
      !normalized.some((pool) => pool.address.toLowerCase() === oldAddress)
    ) {
      normalized.push({
        ...input.previousPool,
        address: oldAddress as Hex,
        token: input.previousPool.token.toLowerCase() as Hex,
        depth: 20,
        confirmations: confirmations(input.previousPool.confirmations ?? 1),
        role: "legacy",
        requestCapable: false,
      });
    }
  }

  const active: CandidatePool = {
    ...input.newPool,
    address: input.newPool.address.toLowerCase() as Hex,
    token: input.newPool.token.toLowerCase() as Hex,
    depth: 20,
    confirmations: activeConfirmations,
    role: "active",
    requestCapable: true,
  };
  const manifest = [
    ...normalized.filter(
      (pool) => pool.address.toLowerCase() !== active.address.toLowerCase(),
    ),
    active,
  ];
  const addresses = manifest.map((pool) => pool.address.toLowerCase());
  if (
    manifest.length > MAX_POOLS ||
    new Set(addresses).size !== addresses.length
  ) {
    throw new Error("Pool history needs an explicit migration plan before deployment.");
  }
  return manifest;
}

export function deploymentOutputPaths(
  root: string,
  input: { network: string; chainId: number; deployBlock: number; pool: Hex },
) {
  if (!/^[a-zA-Z0-9_-]+$/.test(input.network)) {
    throw new Error("Deployment network name is invalid.");
  }
  const directory = path.resolve(
    root,
    ".deploy-candidates",
    `${input.network}-${input.chainId}-${input.deployBlock}-${input.pool.slice(2).toLowerCase()}`,
  );
  const base = path.resolve(root) + path.sep;
  if (!directory.startsWith(base)) {
    throw new Error("Deployment candidates must stay in the project.");
  }
  return {
    directory,
    manifest: path.join(directory, "pool-manifest.candidate.json"),
    webEnv: path.join(directory, "web.env.candidate"),
    indexerConfig: path.join(directory, "indexer.config.candidate.yaml"),
  };
}

export function mergePoolAddresses(previous: readonly string[], newAddress: Hex) {
  const addresses = [...previous.map((address) => address.toLowerCase()), newAddress.toLowerCase()];
  if (addresses.some((address) => !/^0x[0-9a-f]{40}$/.test(address))) {
    throw new Error("Indexer contains an invalid pool address.");
  }
  return [...new Set(addresses)];
}

/** Read only Pool/Registry contract addresses from the requested chain. */
export function configuredIndexerAddresses(
  source: string,
  chainId: number,
  contract: string,
) {
  const found: string[] = [];
  let activeChain: number | null = null;
  let name: string | null = null;
  for (const line of source.split("\n")) {
    const chain = line.match(/^\s*- id:\s*(\d+)\s*$/);
    if (chain) {
      activeChain = Number(chain[1]);
      name = null;
      continue;
    }
    const contractName = line.match(/^\s*- name:\s*(\w+)\s*$/);
    if (contractName) {
      name = contractName[1];
      continue;
    }
    const address = line.match(/^\s*-\s*"(0x[0-9a-fA-F]{40})"\s*$/);
    if (address && activeChain === chainId && name === contract) {
      found.push(address[1].toLowerCase());
    }
  }
  return [...new Set(found)];
}

/** Keep only descriptors for the chain selected by this application build. */
export function manifestForChain(
  previousManifest: string | undefined,
  chainId: number,
): string | undefined {
  if (!previousManifest) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(previousManifest);
  } catch {
    throw new Error(
      "Existing public pool manifest is invalid. Refuse deployment until it is repaired.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Existing public pool manifest is invalid.");
  }
  const retained = parsed.filter(
    (row) =>
      row && typeof row === "object" && (row as Record<string, unknown>).chainId === chainId,
  );
  return retained.length ? JSON.stringify(retained) : undefined;
}

/** Update only the requested Envio chain and preserve its other chain entries. */
export function renderIndexerCandidate(
  source: string,
  chainId: number,
  startBlock: bigint,
  addresses: { Pool: readonly string[]; Registry: string },
): string {
  const lines = source.split("\n");
  const configuredPools: string[] = [];
  const poolLines: number[] = [];
  const registryLines: number[] = [];
  let activeChain: number | null = null;
  let targetChains = 0;
  let targetStartBlocks = 0;
  let name: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const chain = line.match(/^(\s*- id:\s*)(\d+)\s*$/);
    if (chain) {
      activeChain = Number(chain[2]);
      name = null;
      if (activeChain === chainId) targetChains += 1;
      continue;
    }
    if (activeChain !== chainId) continue;

    const start = line.match(/^(\s*start_block:\s*)\d+\s*$/);
    if (start) {
      lines[index] = `${start[1]}${startBlock}`;
      targetStartBlocks += 1;
      continue;
    }
    const contract = line.match(/^\s*- name:\s*(\w+)\s*$/);
    if (contract) {
      name = contract[1];
      continue;
    }
    const address = line.match(/^(\s*-\s*)"(0x[0-9a-fA-F]{40})"\s*$/);
    if (!address) continue;
    if (name === "Pool") {
      configuredPools.push(address[2].toLowerCase());
      poolLines.push(index);
    } else if (name === "Registry") {
      registryLines.push(index);
      lines[index] = `${address[1]}"${addresses.Registry.toLowerCase()}"`;
    }
  }

  if (targetChains !== 1 || targetStartBlocks !== 1) {
    throw new Error("Indexer config must have one target chain and start block.");
  }
  if (!poolLines.length || registryLines.length !== 1) {
    throw new Error("Indexer config must have Pool addresses and one Registry address.");
  }
  const allPools = mergePoolAddresses(configuredPools, addresses.Pool[0] as Hex);
  for (const address of addresses.Pool.slice(1)) {
    const normalized = address.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
      throw new Error("Indexer contains an invalid pool address.");
    }
    if (!allPools.includes(normalized)) allPools.push(normalized);
  }
  const missing = allPools.filter((address) => !configuredPools.includes(address));
  const lastPoolLine = poolLines[poolLines.length - 1];
  const indentation = lines[lastPoolLine].match(/^(\s*-\s*)/)?.[1];
  if (!indentation) throw new Error("Indexer Pool address formatting is invalid.");
  lines.splice(
    lastPoolLine + 1,
    0,
    ...missing.map((address) => `${indentation}"${address}"`),
  );
  return lines.join("\n");
}

/** Read only allowlisted public variables; never stringify the full env file. */
export function readPublicSetting(
  file: string,
  key: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!/^NEXT_PUBLIC_[A-Z0-9_]+$/.test(key)) {
    throw new Error("Only NEXT_PUBLIC_* values can enter a candidate.");
  }
  if (environment[key]) return environment[key];
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const found = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`));
    if (found) {
      const raw = found[1];
      return raw.length > 1 &&
        ((raw.startsWith('"') && raw.endsWith('"')) ||
          (raw.startsWith("'") && raw.endsWith("'")))
        ? raw.slice(1, -1)
        : raw;
    }
  }
  return undefined;
}

/** Write public review files exclusively; never edit live app/indexer config. */
export function writeDeploymentCandidates(input: {
  root: string;
  network: string;
  chainId: number;
  deployBlock: number;
  pool: Hex;
  manifest: readonly CandidatePool[];
  webValues: Readonly<Record<string, string>>;
  indexerConfig: string;
}) {
  const targets = deploymentOutputPaths(input.root, input);
  const resolvedRoot = fs.realpathSync(input.root);
  const resolvedTargets = path.resolve(targets.directory);
  const relative = path.relative(resolvedRoot, resolvedTargets);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Candidate output must be a separate folder inside the project.");
  }
  const allowed = new Set([
    "NEXT_PUBLIC_MONAD_CHAIN_ID",
    "NEXT_PUBLIC_MONAD_RPC_URL",
    "NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS",
    "NEXT_PUBLIC_MAWEE_POOL_ADDRESS",
    "NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK",
    "NEXT_PUBLIC_USDC_ADDRESS",
    "NEXT_PUBLIC_USDC_DECIMALS",
    "NEXT_PUBLIC_USDC_MINTABLE",
    "NEXT_PUBLIC_POOL_DEPTH",
    "NEXT_PUBLIC_MAWEE_POOLS",
    "NEXT_PUBLIC_PRIVY_APP_ID",
  ]);
  for (const [key, value] of Object.entries(input.webValues)) {
    if (!allowed.has(key) || /[\r\n]/.test(value)) {
      throw new Error("Only single-line public web configuration can be staged.");
    }
  }

  const parent = path.dirname(targets.directory);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.lstatSync(parent).isSymbolicLink() || fs.existsSync(targets.directory)) {
    throw new Error("Candidate output already exists or uses a symbolic link.");
  }
  fs.mkdirSync(targets.directory, { recursive: false });
  const envText = Object.entries(input.webValues)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
    .concat("\n");
  fs.writeFileSync(targets.manifest, `${JSON.stringify(input.manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  fs.writeFileSync(targets.webEnv, envText, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(targets.indexerConfig, input.indexerConfig, {
    flag: "wx",
    mode: 0o600,
  });
  return targets;
}
