import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const contractsRoot = path.resolve(webRoot, "../contracts");
const require = createRequire(path.join(contractsRoot, "package.json"));
const preflight = spawnSync(
  process.execPath,
  ["--use-system-ca", "scripts/agora-preflight.mjs"],
  { cwd: webRoot, env: process.env, encoding: "utf8" },
);
let report;
try {
  report = JSON.parse(preflight.stdout);
} catch {
  console.error("Agora deployment preflight could not be read.");
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
if (preflight.status !== 0) process.exit(preflight.status ?? 1);
if (report.configurationReady) {
  console.log(
    "An official AUSD pool is already active; no deployment was sent.",
  );
  process.exit(0);
}
if (!report.readyToDeploy) {
  console.error("Resolve the preflight checks before deployment.");
  process.exit(1);
}
const childEnv = {
  ...process.env,
  NODE_USE_SYSTEM_CA: "1",
  TOKEN_PROFILE: "agora-ausd",
  MONAD_RPC_URL:
    process.env.MONAD_RPC_URL || process.env.NEXT_PUBLIC_MONAD_RPC_URL,
};
delete childEnv.RELAYER_PRIVATE_KEY;
const result = spawnSync(
  process.execPath,
  [
    require.resolve("hardhat/internal/cli/cli"),
    "run",
    "--no-compile",
    "scripts/deploy.ts",
    "--network",
    "monadTestnet",
  ],
  { cwd: contractsRoot, env: childEnv, stdio: "inherit" },
);
process.exitCode = result.status ?? 1;
