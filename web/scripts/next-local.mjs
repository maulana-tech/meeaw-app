import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [command, ...args] = process.argv.slice(2);
if (command !== "build" && command !== "start") {
  throw new Error("Use next-local.mjs build or start.");
}

const require = createRequire(import.meta.url);
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const declarationPath = path.join(webRoot, "next-env.d.ts");
const declarationBefore = command === "build" && fs.existsSync(declarationPath)
  ? fs.readFileSync(declarationPath, "utf8")
  : null;
const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), command, ...args],
  {
    cwd: webRoot,
    stdio: "inherit",
    env: { ...process.env, MAWEE_BUILD_TARGET: "local" },
  },
);

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  if (declarationBefore !== null && fs.existsSync(declarationPath)) {
    const generated = fs.readFileSync(declarationPath, "utf8");
    const localReference = declarationBefore.replaceAll(
      "./.next/types/routes.d.ts",
      "./.next-local/types/routes.d.ts",
    );
    if (generated.trimEnd() === localReference.trimEnd()) {
      fs.writeFileSync(declarationPath, declarationBefore);
    }
  }
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
