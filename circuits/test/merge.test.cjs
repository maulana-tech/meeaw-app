// Circuit-level tests for the Merge circuit, run against the shipped browser
// artifacts in web/public/zk:
//
//   node circuits/test/merge.test.cjs
//
// Honest inputs must produce a proof that verifies; every adversarial witness
// must be rejected by the circuit's constraints during witness generation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const ZK = path.join(__dirname, "../../web/public/zk");
const WASM = path.join(ZK, "merge.wasm");
const ZKEY = path.join(ZK, "merge.zkey");
const VKEY = JSON.parse(fs.readFileSync(path.join(ZK, "verification_key_merge.json"), "utf8"));
const DEPTH = 20;
const MAX64 = (1n << 64n) - 1n;

let H;
let zeros;

before(async () => {
  const poseidon = await buildPoseidon();
  H = (xs) => poseidon.F.toObject(poseidon(xs));
  zeros = [0n];
  for (let i = 0; i < DEPTH; i++) zeros.push(H([zeros[i], zeros[i]]));
});

after(async () => {
  // snarkjs caches the bn128 curve with live worker threads; release it so the
  // process exits on its own with node:test's real exit code.
  if (globalThis.curve_bn128) await globalThis.curve_bn128.terminate();
});

function merkleProof(leaves, target) {
  let level = [...leaves];
  const pathElements = [];
  const pathIndices = [];
  let pos = target;
  for (let d = 0; d < DEPTH; d++) {
    const sibling = pos ^ 1;
    pathElements.push((sibling < level.length ? level[sibling] : zeros[d]).toString());
    pathIndices.push(pos & 1);
    const next = [];
    for (let i = 0; i < level.length; i += 2)
      next.push(H([level[i], i + 1 < level.length ? level[i + 1] : zeros[d]]));
    level = next.length ? next : [zeros[d + 1]];
    pos >>= 1;
  }
  return { root: level[0], pathElements, pathIndices };
}

/**
 * Build a merge witness. `notes` are placed at leaves 0..n-1 of one tree and
 * `use` picks the two input leaf indices. Overrides replace fields afterwards.
 */
function mergeInput({
  ownerSecret = 42n,
  notes = [
    { amount: 10_000_000n, salt: 101n },
    { amount: 15_000_000n, salt: 102n },
  ],
  use = [0, 1],
  outSalt = 103n,
  provingSecret = ownerSecret,
  overrides = {},
} = {}) {
  const pk = H([ownerSecret]);
  const leaves = notes.map((n) => H([n.amount, pk, n.salt]));
  const paths = use.map((i) => merkleProof(leaves, i));
  const amounts = use.map((i) => notes[i].amount);
  const provingPk = H([provingSecret]);
  return {
    root: paths[0].root.toString(),
    nullifierA: H([provingSecret, BigInt(use[0])]).toString(),
    nullifierB: H([provingSecret, BigInt(use[1])]).toString(),
    outCommitment: H([amounts[0] + amounts[1], provingPk, outSalt]).toString(),
    ownerSecret: provingSecret.toString(),
    amounts: amounts.map(String),
    salts: use.map((i) => notes[i].salt.toString()),
    pathElements: paths.map((p) => p.pathElements),
    pathIndices: paths.map((p) => p.pathIndices),
    outSalt: outSalt.toString(),
    ...overrides,
  };
}

async function witnessFails(input) {
  await assert.rejects(snarkjs.wtns.calculate(input, WASM, { type: "mem" }));
}

describe("merge circuit", () => {
  it("proves an honest 10 + 15 merge that verifies with public signals in order", async () => {
    const input = mergeInput();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    assert.deepEqual(publicSignals, [input.root, input.nullifierA, input.nullifierB, input.outCommitment]);
    assert.equal(await snarkjs.groth16.verify(VKEY, publicSignals, proof), true);
    // The same proof with a substituted output does not verify.
    const tampered = [...publicSignals];
    tampered[3] = H([25_000_001n, H([42n]), 103n]).toString();
    assert.equal(await snarkjs.groth16.verify(VKEY, tampered, proof), false);
  });

  it("rejects the same note used as both inputs", async () => {
    await witnessFails(mergeInput({ use: [0, 0] }));
  });

  it("rejects an owner secret that does not own the notes", async () => {
    await witnessFails(mergeInput({ provingSecret: 43n }));
  });

  it("rejects inputs proven against different roots", async () => {
    const honest = mergeInput();
    const other = mergeInput({
      notes: [
        { amount: 10_000_000n, salt: 101n },
        { amount: 15_000_000n, salt: 102n },
        { amount: 1n, salt: 999n },
      ],
    });
    await witnessFails({
      ...honest,
      pathElements: [honest.pathElements[0], other.pathElements[1]],
    });
  });

  it("rejects a sum that overflows uint64 even though each input fits", async () => {
    await witnessFails(
      mergeInput({
        notes: [
          { amount: MAX64, salt: 1n },
          { amount: 1n, salt: 2n },
        ],
      }),
    );
  });

  it("rejects an input amount above uint64", async () => {
    await witnessFails(
      mergeInput({
        notes: [
          { amount: MAX64 + 1n, salt: 1n },
          { amount: 1n, salt: 2n },
        ],
      }),
    );
  });

  it("rejects corrupted nullifiers and outputs", async () => {
    const honest = mergeInput();
    await witnessFails({ ...honest, nullifierB: "999" });
    await witnessFails({ ...honest, nullifierA: honest.nullifierB, nullifierB: honest.nullifierA });
    await witnessFails({ ...honest, outCommitment: H([25_000_001n, H([42n]), 103n]).toString() });
  });

  it("rejects non-binary path indices", async () => {
    const honest = mergeInput();
    const bad = honest.pathIndices.map((p) => [...p]);
    bad[1][0] = 2;
    await witnessFails({ ...honest, pathIndices: bad });
  });
});
