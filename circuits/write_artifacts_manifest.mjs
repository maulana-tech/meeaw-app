// Records the SHA-256 of every shipped proving artifact in web/public/zk, so a
// circuit rebuild that changes an existing key is visible in review.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ZK = join(import.meta.dirname, "../web/public/zk");
const MANIFEST = "artifacts-manifest.json";

const files = readdirSync(ZK)
  .filter((name) => name !== MANIFEST)
  .sort();
const artifacts = Object.fromEntries(
  files.map((name) => [
    name,
    createHash("sha256").update(readFileSync(join(ZK, name))).digest("hex"),
  ]),
);
const capacity = {
  merge: { ptauPower: 15, optimization: "O2" },
};
writeFileSync(
  join(ZK, MANIFEST),
  `${JSON.stringify({ version: 1, capacity, artifacts }, null, 2)}\n`,
);
console.log(`wrote ${MANIFEST} (${files.length} artifacts)`);
