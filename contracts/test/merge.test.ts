import { expect } from "chai";
import hre from "hardhat";
import { getAddress, type Hex, toHex } from "viem";
import {
  b32,
  deployPoolFixture,
  depositOwnedNote,
  expectRevert,
  H,
  makeMergeProof,
  merkleProof,
  output,
  type PoolFixture,
  prove,
  rememberOwned,
  syncLeaves,
} from "./helpers/poolFixture";

const OWNER = 42n;

async function twoNotes(f: PoolFixture) {
  await depositOwnedNote(f, { amount: 10_000_000n, ownerSecret: OWNER, salt: 101n });
  await depositOwnedNote(f, { amount: 15_000_000n, ownerSecret: OWNER, salt: 102n });
}

async function spentFlags(f: PoolFixture, nullifiers: readonly Hex[]) {
  return Promise.all(nullifiers.map((n) => f.pool.read.isSpent([n])));
}

/**
 * `pendingAdmin`, `paused`, `nextIndex` and `currentRootIndex` share one storage
 * slot (20 + 1 + 4 + 4 bytes). Locate it by its current contents so the test
 * does not hard-code the compiler's layout.
 */
async function treeSlot(f: PoolFixture, nextIndex: number, rootIndex: number) {
  for (let slot = 0; slot < 64; slot++) {
    const raw = await f.publicClient.getStorageAt({ address: f.pool.address, slot: toHex(slot) });
    const v = BigInt(raw ?? "0x0");
    if (((v >> 168n) & 0xffffffffn) === BigInt(nextIndex) && ((v >> 200n) & 0xffffffffn) === BigInt(rootIndex))
      return { slot, value: v };
  }
  throw new Error("tree slot not found");
}

describe("MaweePool.merge", () => {
  it("merges 10 and 15 without tokens leaving the pool", async () => {
    const f = await deployPoolFixture();
    await twoNotes(f);
    const m = await makeMergeProof(f, { indices: [0, 1], ownerSecret: OWNER, outSalt: 103n });
    await f.pool.write.merge([m.root, m.nullifiers[0], m.nullifiers[1], m.proof, output(m.outputCommitment)]);

    expect(await f.usdc.read.balanceOf([f.pool.address])).to.equal(25_000_000n);
    expect(await spentFlags(f, m.nullifiers)).to.deep.equal([true, true]);
    expect(await f.pool.read.isCommitmentInserted([m.outputCommitment])).to.equal(true);

    const deposits = await f.pool.getEvents.Deposit({}, { fromBlock: 0n });
    expect(deposits.map((d) => d.args.leafIndex)).to.deep.equal([0, 1, 2]);
    expect(deposits[2].args.commitment).to.equal(m.outputCommitment);
    expect(deposits[2].args.ciphertext).to.equal("0x1234");
    const spends = await f.pool.getEvents.Spend({}, { fromBlock: 0n });
    expect(spends.map((s) => s.args.nullifier)).to.deep.equal([...m.nullifiers]);
  });

  it("produces an output the owner can withdraw in full", async () => {
    const f = await deployPoolFixture();
    await twoNotes(f);
    const m = await makeMergeProof(f, { indices: [0, 1], ownerSecret: OWNER, outSalt: 103n });
    await f.pool.write.merge([m.root, m.nullifiers[0], m.nullifiers[1], m.proof, output(m.outputCommitment)]);
    const index = await rememberOwned(f, BigInt(m.outputCommitment), {
      amount: m.outputAmount,
      ownerSecret: OWNER,
      salt: 103n,
    });
    const mp = await merkleProof(await syncLeaves(f), index);
    const nullifier = await H([OWNER, BigInt(index)]);
    const to = getAddress(f.relayer.account.address);
    const proof = await prove("withdraw", {
      root: mp.root.toString(),
      nullifier: nullifier.toString(),
      recipient: BigInt(to).toString(),
      amount: m.outputAmount.toString(),
      ownerSecret: OWNER.toString(),
      salt: "103",
      pathElements: mp.pathElements.map(String),
      pathIndices: mp.pathIndices,
    });
    await f.pool.write.withdraw([to, m.outputAmount, b32(mp.root), b32(nullifier), proof]);
    expect(await f.usdc.read.balanceOf([to])).to.equal(25_000_000n);
    expect(await f.usdc.read.balanceOf([f.pool.address])).to.equal(0n);
  });

  it("rejects the same nullifier twice before verifying", async () => {
    const f = await deployPoolFixture();
    await twoNotes(f);
    const m = await makeMergeProof(f, { indices: [0, 1], ownerSecret: OWNER, outSalt: 103n });
    await expectRevert(
      f.pool.write.merge([m.root, m.nullifiers[0], m.nullifiers[0], m.proof, output(m.outputCommitment)]),
      "DuplicateNullifier",
    );
  });

  it("rejects an unknown root", async () => {
    const f = await deployPoolFixture();
    await twoNotes(f);
    const m = await makeMergeProof(f, { indices: [0, 1], ownerSecret: OWNER, outSalt: 103n });
    await expectRevert(
      f.pool.write.merge([b32(123n), m.nullifiers[0], m.nullifiers[1], m.proof, output(m.outputCommitment)]),
      "UnknownRoot",
    );
  });

  it("rejects corrupted nullifiers, another owner's nullifier and altered outputs, keeping inputs unspent", async () => {
    const f = await deployPoolFixture();
    await twoNotes(f);
    await depositOwnedNote(f, { amount: 5_000_000n, ownerSecret: 77n, salt: 201n });
    const m = await makeMergeProof(f, { indices: [0, 1], ownerSecret: OWNER, outSalt: 103n });
    const otherOwnersNullifier = b32(await H([77n, 2n]));
    const alteredOutput = b32(await H([26_000_000n, await H([OWNER]), 103n]));
    for (const args of [
      [m.root, m.nullifiers[0], b32(999n), m.proof, output(m.outputCommitment)],
      [m.root, m.nullifiers[0], otherOwnersNullifier, m.proof, output(m.outputCommitment)],
      [m.root, m.nullifiers[0], m.nullifiers[1], m.proof, output(alteredOutput)],
      [m.root, m.nullifiers[1], m.nullifiers[0], m.proof, output(m.outputCommitment)],
    ] as const) {
      await expectRevert(f.pool.write.merge([...args]), "InvalidProof");
    }
    expect(await spentFlags(f, [...m.nullifiers, otherOwnersNullifier])).to.deep.equal([false, false, false]);
    expect(await f.usdc.read.balanceOf([f.pool.address])).to.equal(30_000_000n);
  });

  it("rejects merging an already spent input", async () => {
    const f = await deployPoolFixture();
    await twoNotes(f);
    await depositOwnedNote(f, { amount: 1_000_000n, ownerSecret: OWNER, salt: 104n });
    const first = await makeMergeProof(f, { indices: [0, 1], ownerSecret: OWNER, outSalt: 105n });
    const second = await makeMergeProof(f, { indices: [1, 2], ownerSecret: OWNER, outSalt: 106n });
    await f.pool.write.merge([
      first.root,
      first.nullifiers[0],
      first.nullifiers[1],
      first.proof,
      output(first.outputCommitment),
    ]);
    await expectRevert(
      f.pool.write.merge([
        second.root,
        second.nullifiers[0],
        second.nullifiers[1],
        second.proof,
        output(second.outputCommitment),
      ]),
      "DoubleSpend",
    );
    expect(await f.pool.read.isSpent([second.nullifiers[1]])).to.equal(false);
  });

  it("is blocked while paused", async () => {
    const f = await deployPoolFixture();
    await twoNotes(f);
    const m = await makeMergeProof(f, { indices: [0, 1], ownerSecret: OWNER, outSalt: 103n });
    await f.pool.write.setPaused([true], { account: f.admin.account });
    await expectRevert(
      f.pool.write.merge([m.root, m.nullifiers[0], m.nullifiers[1], m.proof, output(m.outputCommitment)]),
      "Paused",
    );
  });

  it("rolls back both nullifiers when the tree is full", async () => {
    const f = await deployPoolFixture();
    await twoNotes(f);
    const m = await makeMergeProof(f, { indices: [0, 1], ownerSecret: OWNER, outSalt: 103n });
    const { slot, value } = await treeSlot(f, 2, 2);
    const full = (value & ~(0xffffffffn << 168n)) | (BigInt(2 ** 20) << 168n);
    await hre.network.provider.send("hardhat_setStorageAt", [f.pool.address, toHex(slot), toHex(full, { size: 32 })]);
    expect(await f.pool.read.nextIndex()).to.equal(2 ** 20);
    await expectRevert(
      f.pool.write.merge([m.root, m.nullifiers[0], m.nullifiers[1], m.proof, output(m.outputCommitment)]),
      "TreeFull",
    );
    expect(await spentFlags(f, m.nullifiers)).to.deep.equal([false, false]);
    expect(await f.pool.read.isCommitmentInserted([m.outputCommitment])).to.equal(false);
  });
});
