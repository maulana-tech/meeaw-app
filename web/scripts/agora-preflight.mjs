import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";

const contractsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts",
);
const require = createRequire(path.join(contractsRoot, "package.json"));
const childEnv = {
  ...process.env,
  NODE_USE_SYSTEM_CA: "1",
  MONAD_RPC_URL:
    process.env.MONAD_RPC_URL || process.env.NEXT_PUBLIC_MONAD_RPC_URL,
};
delete childEnv.DEPLOYER_PRIVATE_KEY;
delete childEnv.RELAYER_PRIVATE_KEY;
delete childEnv.MAWEE_PREFLIGHT_DEPLOYER_ADDRESS;
if (process.env.DEPLOYER_PRIVATE_KEY) {
  try {
    childEnv.MAWEE_PREFLIGHT_DEPLOYER_ADDRESS = privateKeyToAccount(
      process.env.DEPLOYER_PRIVATE_KEY,
    ).address;
  } catch {
    console.error("The configured deployer key is invalid.");
    process.exit(1);
  }
}
const result = spawnSync(
  process.execPath,
  [
    require.resolve("hardhat/internal/cli/cli"),
    "run",
    "--no-compile",
    "scripts/agora-preflight.ts",
    "--network",
    "monadTestnet",
  ],
  { cwd: contractsRoot, env: childEnv, stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
