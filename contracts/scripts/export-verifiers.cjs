// Regenerates the Groth16 Solidity verifiers from the proving keys the web app
// ships in web/public/zk, so on-chain verification always matches the browser
// prover. Run after rebuilding circuits.
const fs = require("node:fs");
const path = require("node:path");
const snarkjs = require("snarkjs");

const ZK = path.join(__dirname, "../../web/public/zk");
const OUT = path.join(__dirname, "../src/verifiers");
const CIRCUITS = [
  ["deposit", "DepositVerifier"],
  ["withdraw", "WithdrawVerifier"],
  ["transfer", "TransferVerifier"],
];

async function main() {
  const templates = {
    groth16: fs.readFileSync(
      path.join(path.dirname(require.resolve("snarkjs")), "../templates/verifier_groth16.sol.ejs"),
      "utf8",
    ),
  };
  fs.mkdirSync(OUT, { recursive: true });
  for (const [circuit, name] of CIRCUITS) {
    const source = await snarkjs.zKey.exportSolidityVerifier(
      path.join(ZK, `${circuit}.zkey`),
      templates,
    );
    fs.writeFileSync(
      path.join(OUT, `${name}.sol`),
      source.replace(/contract Groth16Verifier/, `contract ${name}`),
    );
    console.log(`wrote ${name}.sol`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
