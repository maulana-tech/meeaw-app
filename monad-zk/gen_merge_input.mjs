import { buildPoseidon } from "circomlibjs";
import { writeFileSync } from "fs";

const poseidon = await buildPoseidon();
const F = poseidon.F;
const DEPTH = 20;
const H = (arr) => F.toObject(poseidon(arr));

// Two notes owned by the same secret at leaves 0 and 1: 10 + 15 USDC → 25 USDC.
const ownerSecret = 555555555555n;
const ownerPk = H([ownerSecret]);
const notes = [
  { amount: 10000000n, salt: 101n },
  { amount: 15000000n, salt: 102n },
];
const outSalt = 103n;
const leaves = notes.map((n) => H([n.amount, ownerPk, n.salt]));

const zeros = [0n];
for (let i = 0; i < DEPTH; i++) zeros.push(H([zeros[i], zeros[i]]));

function merkleProof(target) {
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

const proofs = [merkleProof(0), merkleProof(1)];
const outAmount = notes[0].amount + notes[1].amount;
const input = {
  root: proofs[0].root.toString(),
  nullifierA: H([ownerSecret, 0n]).toString(),
  nullifierB: H([ownerSecret, 1n]).toString(),
  outCommitment: H([outAmount, ownerPk, outSalt]).toString(),
  ownerSecret: ownerSecret.toString(),
  amounts: notes.map((n) => n.amount.toString()),
  salts: notes.map((n) => n.salt.toString()),
  pathElements: proofs.map((p) => p.pathElements),
  pathIndices: proofs.map((p) => p.pathIndices),
  outSalt: outSalt.toString(),
};
writeFileSync("input_merge.json", JSON.stringify(input, null, 2));
console.log("root          =", input.root);
console.log("outCommitment =", input.outCommitment);
