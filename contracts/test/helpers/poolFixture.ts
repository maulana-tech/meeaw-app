import path from "node:path";
import { expect } from "chai";
import hre from "hardhat";
import { type Hex, toHex } from "viem";

// Shared pool fixture for merge and request-settlement tests. Proofs come from
// the shipped browser artifacts (web/public/zk) and are verified on-chain by the
// generated verifiers, so a drift between circuit, prover and contract fails.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPoseidon } = require("circomlibjs");

const ZK = path.join(__dirname, "../../../web/public/zk");
export const DEPTH = 20;
export const FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let poseidonFn: any;
export async function H(inputs: bigint[]): Promise<bigint> {
  if (!poseidonFn) poseidonFn = await buildPoseidon();
  return poseidonFn.F.toObject(poseidonFn(inputs));
}

export const b32 = (x: bigint): Hex => toHex(x, { size: 32 });

export type EvmProof = {
  a: [bigint, bigint];
  b: [[bigint, bigint], [bigint, bigint]];
  c: [bigint, bigint];
};

type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
function evmProof(p: SnarkProof): EvmProof {
  return {
    a: [BigInt(p.pi_a[0]), BigInt(p.pi_a[1])],
    b: [
      [BigInt(p.pi_b[0][1]), BigInt(p.pi_b[0][0])],
      [BigInt(p.pi_b[1][1]), BigInt(p.pi_b[1][0])],
    ],
    c: [BigInt(p.pi_c[0]), BigInt(p.pi_c[1])],
  };
}

export async function prove(circuit: string, input: Record<string, unknown>): Promise<EvmProof> {
  const { proof } = await snarkjs.groth16.fullProve(
    input,
    path.join(ZK, `${circuit}.wasm`),
    path.join(ZK, `${circuit}.zkey`),
  );
  return evmProof(proof);
}

export async function merkleProof(leaves: bigint[], target: number) {
  const zeros = [0n];
  for (let i = 0; i < DEPTH; i++) zeros.push(await H([zeros[i], zeros[i]]));
  let level = [...leaves];
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let pos = target;
  for (let d = 0; d < DEPTH; d++) {
    const sibling = pos ^ 1;
    pathElements.push(sibling < level.length ? level[sibling] : zeros[d]);
    pathIndices.push(pos & 1);
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(await H([level[i], i + 1 < level.length ? level[i + 1] : zeros[d]]));
    }
    level = next.length ? next : [zeros[d + 1]];
    pos >>= 1;
  }
  return { root: level[0], pathElements, pathIndices };
}

export async function expectRevert(promise: Promise<unknown>, error: string) {
  try {
    await promise;
  } catch (e) {
    expect(String((e as Error).message)).to.contain(error);
    return;
  }
  expect.fail(`expected revert ${error}`);
}

type OwnedNote = { amount: bigint; ownerSecret: bigint; salt: bigint };

export async function deployPoolFixture() {
  const [admin, payer, relayer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();
  const poseidon = await hre.viem.deployContract("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
  const usdc = await hre.viem.deployContract("MockUSDC");
  const dv = await hre.viem.deployContract("DepositVerifier");
  const wv = await hre.viem.deployContract("WithdrawVerifier");
  const tv = await hre.viem.deployContract("TransferVerifier");
  const mv = await hre.viem.deployContract("MergeVerifier");
  const pool = await hre.viem.deployContract(
    "MaweePool",
    [admin.account.address, usdc.address, dv.address, wv.address, tv.address, mv.address],
    { libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": poseidon.address } },
  );
  await usdc.write.mint([payer.account.address, 10n ** 15n]);
  await usdc.write.approve([pool.address, 2n ** 256n - 1n], { account: payer.account });
  return {
    admin,
    payer,
    relayer,
    publicClient,
    usdc,
    pool,
    /** Realized leaves in index order, mirrored from Deposit events. */
    leaves: [] as bigint[],
    /** Witness data for notes the tests own, by leaf index. */
    owned: new Map<number, OwnedNote>(),
  };
}

export type PoolFixture = Awaited<ReturnType<typeof deployPoolFixture>>;

/** Refresh `f.leaves` from the chain, the same source the browser scans. */
export async function syncLeaves(f: PoolFixture): Promise<bigint[]> {
  const events = await f.pool.getEvents.Deposit({}, { fromBlock: 0n });
  const leaves: bigint[] = [];
  for (const e of events) leaves[Number(e.args.leafIndex)] = BigInt(e.args.commitment as Hex);
  f.leaves = leaves;
  return leaves;
}

/** Track an output note this test owns (merge output, transfer change). */
export async function rememberOwned(f: PoolFixture, commitment: bigint, note: OwnedNote) {
  const leaves = await syncLeaves(f);
  const index = leaves.indexOf(commitment);
  if (index < 0) throw new Error("output commitment not found on-chain");
  f.owned.set(index, note);
  return index;
}

export async function depositOwnedNote(
  f: PoolFixture,
  note: { amount: bigint; ownerSecret: bigint; salt: bigint },
): Promise<{ leafIndex: number; commitment: bigint }> {
  const ownerPk = await H([note.ownerSecret]);
  const commitment = await H([note.amount, ownerPk, note.salt]);
  const proof = await prove("deposit", {
    commitment: commitment.toString(),
    amount: note.amount.toString(),
    ownerPk: ownerPk.toString(),
    salt: note.salt.toString(),
  });
  await f.pool.write.deposit([b32(commitment), note.amount, proof, b32(1n), "0x01"], {
    account: f.payer.account,
  });
  const leafIndex = await rememberOwned(f, commitment, note);
  return { leafIndex, commitment };
}

export async function makeMergeProof(
  f: PoolFixture,
  opts: { indices: readonly [number, number]; ownerSecret: bigint; outSalt: bigint },
): Promise<{
  root: Hex;
  nullifiers: readonly [Hex, Hex];
  proof: EvmProof;
  outputCommitment: Hex;
  outputAmount: bigint;
}> {
  const leaves = await syncLeaves(f);
  const notes = opts.indices.map((i) => {
    const n = f.owned.get(i);
    if (!n) throw new Error(`leaf ${i} is not owned by this fixture`);
    return n;
  });
  const ownerPk = await H([opts.ownerSecret]);
  const paths = await Promise.all(opts.indices.map((i) => merkleProof(leaves, i)));
  const nullifiers = await Promise.all(
    opts.indices.map((i) => H([opts.ownerSecret, BigInt(i)])),
  );
  const outputAmount = notes[0].amount + notes[1].amount;
  const outputCommitment = await H([outputAmount, ownerPk, opts.outSalt]);
  const proof = await prove("merge", {
    root: paths[0].root.toString(),
    nullifierA: nullifiers[0].toString(),
    nullifierB: nullifiers[1].toString(),
    outCommitment: outputCommitment.toString(),
    ownerSecret: opts.ownerSecret.toString(),
    amounts: notes.map((n) => n.amount.toString()),
    salts: notes.map((n) => n.salt.toString()),
    pathElements: paths.map((p) => p.pathElements.map(String)),
    pathIndices: paths.map((p) => p.pathIndices),
    outSalt: opts.outSalt.toString(),
  });
  return {
    root: b32(paths[0].root),
    nullifiers: [b32(nullifiers[0]), b32(nullifiers[1])] as const,
    proof,
    outputCommitment: b32(outputCommitment),
    outputAmount,
  };
}

export async function makeTransferProof(
  f: PoolFixture,
  opts: {
    index: number;
    ownerSecret: bigint;
    recipientPk: bigint;
    recipientAmount: bigint;
    recipientSalt: bigint;
    changeSalt: bigint;
  },
): Promise<{
  root: Hex;
  nullifier: Hex;
  proof: EvmProof;
  recipientCommitment: Hex;
  changeCommitment: Hex;
  changeAmount: bigint;
}> {
  const leaves = await syncLeaves(f);
  const input = f.owned.get(opts.index);
  if (!input) throw new Error(`leaf ${opts.index} is not owned by this fixture`);
  const ownerPk = await H([opts.ownerSecret]);
  const changeAmount = input.amount - opts.recipientAmount;
  const recipientCommitment = await H([opts.recipientAmount, opts.recipientPk, opts.recipientSalt]);
  const changeCommitment = await H([changeAmount, ownerPk, opts.changeSalt]);
  const mp = await merkleProof(leaves, opts.index);
  const nullifier = await H([opts.ownerSecret, BigInt(opts.index)]);
  const proof = await prove("transfer", {
    root: mp.root.toString(),
    nullifier: nullifier.toString(),
    outCommitmentRecipient: recipientCommitment.toString(),
    outCommitmentChange: changeCommitment.toString(),
    inAmount: input.amount.toString(),
    ownerSecret: opts.ownerSecret.toString(),
    inSalt: input.salt.toString(),
    pathElements: mp.pathElements.map(String),
    pathIndices: mp.pathIndices,
    recipientPk: opts.recipientPk.toString(),
    recipientAmount: opts.recipientAmount.toString(),
    recipientSalt: opts.recipientSalt.toString(),
    changeAmount: changeAmount.toString(),
    changeSalt: opts.changeSalt.toString(),
  });
  return {
    root: b32(mp.root),
    nullifier: b32(nullifier),
    proof,
    recipientCommitment: b32(recipientCommitment),
    changeCommitment: b32(changeCommitment),
    changeAmount,
  };
}

export const output = (commitment: Hex, ciphertext: Hex = "0x1234") => ({
  commitment,
  ephemeralPk: b32(7n),
  ciphertext,
});
