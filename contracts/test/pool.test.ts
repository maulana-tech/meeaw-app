import path from "node:path";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, toHex } from "viem";

// End-to-end parity: proofs come from the same wasm/zkey artifacts the browser
// uses (web/public/zk), and the Merkle math is the same circomlibjs Poseidon as
// web/src/lib/crypto.ts. If any of the three drift, these tests fail.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const snarkjs = require("snarkjs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPoseidon } = require("circomlibjs");

const ZK = path.join(__dirname, "../../web/public/zk");
const DEPTH = 20;
const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let poseidonFn: any;
async function H(inputs: bigint[]): Promise<bigint> {
  if (!poseidonFn) poseidonFn = await buildPoseidon();
  return poseidonFn.F.toObject(poseidonFn(inputs));
}

const b32 = (x: bigint) => toHex(x, { size: 32 });

async function merkleProof(leaves: bigint[], target: number) {
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

type SnarkProof = { pi_a: string[]; pi_b: string[][]; pi_c: string[] };
function evmProof(p: SnarkProof) {
  return {
    a: [BigInt(p.pi_a[0]), BigInt(p.pi_a[1])] as [bigint, bigint],
    b: [
      [BigInt(p.pi_b[0][1]), BigInt(p.pi_b[0][0])],
      [BigInt(p.pi_b[1][1]), BigInt(p.pi_b[1][0])],
    ] as [[bigint, bigint], [bigint, bigint]],
    c: [BigInt(p.pi_c[0]), BigInt(p.pi_c[1])] as [bigint, bigint],
  };
}

async function prove(circuit: string, input: Record<string, unknown>) {
  const { proof } = await snarkjs.groth16.fullProve(
    input,
    path.join(ZK, `${circuit}.wasm`),
    path.join(ZK, `${circuit}.zkey`),
  );
  return evmProof(proof);
}

async function makeNote(amount: bigint, ownerSecret: bigint, salt: bigint) {
  const ownerPk = await H([ownerSecret]);
  const commitment = await H([amount, ownerPk, salt]);
  const proof = await prove("deposit", {
    commitment: commitment.toString(),
    amount: amount.toString(),
    ownerPk: ownerPk.toString(),
    salt: salt.toString(),
  });
  return { amount, ownerSecret, ownerPk, salt, commitment, proof };
}

async function deployAll() {
  const [admin, payer, recipient] = await hre.viem.getWalletClients();
  const poseidon = await hre.viem.deployContract("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
  const usdc = await hre.viem.deployContract("MockUSDC");
  const dv = await hre.viem.deployContract("DepositVerifier");
  const wv = await hre.viem.deployContract("WithdrawVerifier");
  const tv = await hre.viem.deployContract("TransferVerifier");
  const pool = await hre.viem.deployContract(
    "MaweePool",
    [admin.account.address, usdc.address, dv.address, wv.address, tv.address],
    { libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": poseidon.address } },
  );
  await usdc.write.mint([payer.account.address, 1_000_000_000n]);
  await usdc.write.approve([pool.address, 2n ** 256n - 1n], { account: payer.account });
  return { admin, payer, recipient, usdc, pool };
}

async function expectRevert(promise: Promise<unknown>, error: string) {
  try {
    await promise;
  } catch (e) {
    expect(String((e as Error).message)).to.contain(error);
    return;
  }
  expect.fail(`expected revert ${error}`);
}

describe("MaweePool", () => {
  it("empty root matches the circomlibjs zero tree", async () => {
    const { pool } = await deployAll();
    const { root } = await merkleProof([], 0);
    expect(await pool.read.currentRoot()).to.equal(b32(root));
  });

  it("deposit → withdraw moves funds, and the nullifier cannot be reused", async () => {
    const { payer, recipient, usdc, pool } = await deployAll();
    const note = await makeNote(25_000_000n, 1234567n, 98765n);

    await pool.write.deposit([b32(note.commitment), note.amount, note.proof, b32(7n), "0xdeadbeef"], {
      account: payer.account,
    });
    expect(await usdc.read.balanceOf([pool.address])).to.equal(note.amount);

    const deposits = await pool.getEvents.Deposit();
    expect(deposits).to.have.length(1);
    expect(deposits[0].args.leafIndex).to.equal(0);
    expect(deposits[0].args.ciphertext).to.equal("0xdeadbeef");

    const mp = await merkleProof([note.commitment], 0);
    expect(await pool.read.currentRoot()).to.equal(b32(mp.root));

    const nullifier = await H([note.ownerSecret, 0n]);
    const to = getAddress(recipient.account.address);
    const proof = await prove("withdraw", {
      root: mp.root.toString(),
      nullifier: nullifier.toString(),
      recipient: BigInt(to).toString(),
      amount: note.amount.toString(),
      ownerSecret: note.ownerSecret.toString(),
      salt: note.salt.toString(),
      pathElements: mp.pathElements.map(String),
      pathIndices: mp.pathIndices,
    });

    await pool.write.withdraw([to, note.amount, b32(mp.root), b32(nullifier), proof]);
    expect(await usdc.read.balanceOf([to])).to.equal(note.amount);
    expect(await pool.read.isSpent([b32(nullifier)])).to.equal(true);

    await expectRevert(pool.write.withdraw([to, note.amount, b32(mp.root), b32(nullifier), proof]), "DoubleSpend");
  });

  it("rejects a withdraw proof redirected to another recipient", async () => {
    const { payer, recipient, admin, pool } = await deployAll();
    const note = await makeNote(5_000_000n, 42n, 43n);
    await pool.write.deposit([b32(note.commitment), note.amount, note.proof, b32(1n), "0x"], {
      account: payer.account,
    });
    const mp = await merkleProof([note.commitment], 0);
    const nullifier = await H([note.ownerSecret, 0n]);
    const proof = await prove("withdraw", {
      root: mp.root.toString(),
      nullifier: nullifier.toString(),
      recipient: BigInt(recipient.account.address).toString(),
      amount: note.amount.toString(),
      ownerSecret: note.ownerSecret.toString(),
      salt: note.salt.toString(),
      pathElements: mp.pathElements.map(String),
      pathIndices: mp.pathIndices,
    });
    await expectRevert(
      pool.write.withdraw([admin.account.address, note.amount, b32(mp.root), b32(nullifier), proof]),
      "InvalidProof",
    );
  });

  it("rejects a deposit whose proof does not match the paid amount", async () => {
    const { payer, pool } = await deployAll();
    const note = await makeNote(10_000_000n, 5n, 6n);
    await expectRevert(
      pool.write.deposit([b32(note.commitment), 1n, note.proof, b32(1n), "0x"], { account: payer.account }),
      "InvalidProof",
    );
  });

  it("shielded transfer splits a note into recipient + change and both are spendable", async () => {
    const { payer, recipient, usdc, pool } = await deployAll();
    const input = await makeNote(30_000_000n, 777n, 888n);
    await pool.write.deposit([b32(input.commitment), input.amount, input.proof, b32(1n), "0x"], {
      account: payer.account,
    });

    const recipientSecret = 4242n;
    const recipientPk = await H([recipientSecret]);
    const recipientAmount = 12_000_000n;
    const changeAmount = input.amount - recipientAmount;
    const recipientSalt = 11n;
    const changeSalt = 12n;
    const outR = await H([recipientAmount, recipientPk, recipientSalt]);
    const outC = await H([changeAmount, input.ownerPk, changeSalt]);

    const mp = await merkleProof([input.commitment], 0);
    const nullifier = await H([input.ownerSecret, 0n]);
    const proof = await prove("transfer", {
      root: mp.root.toString(),
      nullifier: nullifier.toString(),
      outCommitmentRecipient: outR.toString(),
      outCommitmentChange: outC.toString(),
      inAmount: input.amount.toString(),
      ownerSecret: input.ownerSecret.toString(),
      inSalt: input.salt.toString(),
      pathElements: mp.pathElements.map(String),
      pathIndices: mp.pathIndices,
      recipientPk: recipientPk.toString(),
      recipientAmount: recipientAmount.toString(),
      recipientSalt: recipientSalt.toString(),
      changeAmount: changeAmount.toString(),
      changeSalt: changeSalt.toString(),
    });

    await pool.write.transfer([
      b32(mp.root),
      b32(nullifier),
      proof,
      { commitment: b32(outR), ephemeralPk: b32(2n), ciphertext: "0x01" },
      { commitment: b32(outC), ephemeralPk: b32(3n), ciphertext: "0x02" },
    ]);
    const deposits = await pool.getEvents.Deposit({}, { fromBlock: 0n });
    expect(deposits.map((d) => d.args.leafIndex)).to.deep.equal([0, 1, 2]);

    // Recipient spends the note they received (leaf 1).
    const leaves = [input.commitment, outR, outC];
    const mp2 = await merkleProof(leaves, 1);
    expect(await pool.read.currentRoot()).to.equal(b32(mp2.root));
    const nf2 = await H([recipientSecret, 1n]);
    const to = getAddress(recipient.account.address);
    const proof2 = await prove("withdraw", {
      root: mp2.root.toString(),
      nullifier: nf2.toString(),
      recipient: BigInt(to).toString(),
      amount: recipientAmount.toString(),
      ownerSecret: recipientSecret.toString(),
      salt: recipientSalt.toString(),
      pathElements: mp2.pathElements.map(String),
      pathIndices: mp2.pathIndices,
    });
    await pool.write.withdraw([to, recipientAmount, b32(mp2.root), b32(nf2), proof2]);
    expect(await usdc.read.balanceOf([to])).to.equal(recipientAmount);
    expect(await usdc.read.balanceOf([pool.address])).to.equal(changeAmount);
  });

  it("pause blocks payments and only the admin can toggle it", async () => {
    const { admin, payer, pool } = await deployAll();
    await expectRevert(pool.write.setPaused([true], { account: payer.account }), "NotAdmin");
    await pool.write.setPaused([true], { account: admin.account });
    const note = await makeNote(1_000_000n, 9n, 10n);
    await expectRevert(
      pool.write.deposit([b32(note.commitment), note.amount, note.proof, b32(1n), "0x"], { account: payer.account }),
      "Paused",
    );
  });

  it("rejects commitments outside the BN254 scalar field", async () => {
    const { payer, pool } = await deployAll();
    const note = await makeNote(1_000_000n, 9n, 10n);
    await expectRevert(
      pool.write.deposit([b32(note.commitment + R), note.amount, note.proof, b32(1n), "0x"], {
        account: payer.account,
      }),
      "InvalidFieldElement",
    );
  });
});
