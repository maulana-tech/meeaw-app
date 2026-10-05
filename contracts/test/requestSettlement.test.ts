import { expect } from "chai";
import {
  b32,
  deployPoolFixture,
  depositOwnedNote,
  expectRevert,
  H,
  makeMergeProof,
  makeTransferProof,
  output,
  rememberOwned,
  prove,
} from "./helpers/poolFixture";

// A payment request has one immutable recipient commitment. The pool's
// commitment uniqueness is what guarantees a request is paid at most once,
// even if two valid proofs are produced from different notes.
describe("request settlement uniqueness", () => {
  const PAYER = 900n;
  const REQUESTER = 4242n;

  it("consolidates 10 + 15 private USDC, pays a fixed 20 USDC request, and returns 5 USDC privately", async () => {
    const f=await deployPoolFixture();
    await depositOwnedNote(f,{amount:10_000_000n,ownerSecret:PAYER,salt:101n});
    await depositOwnedNote(f,{amount:15_000_000n,ownerSecret:PAYER,salt:102n});
    const merged=await makeMergeProof(f,{indices:[0,1],ownerSecret:PAYER,outSalt:103n});
    expect(merged.outputAmount).to.equal(25_000_000n);
    await f.pool.write.merge([merged.root,merged.nullifiers[0],merged.nullifiers[1],merged.proof,output(merged.outputCommitment)]);
    const mergedIndex=await rememberOwned(f,BigInt(merged.outputCommitment),{amount:merged.outputAmount,ownerSecret:PAYER,salt:103n});
    expect(mergedIndex).to.equal(2);

    const requestSalt=777n,requestCommitment=await H([20_000_000n,await H([REQUESTER]),requestSalt]);
    const payment=await makeTransferProof(f,{index:mergedIndex,ownerSecret:PAYER,recipientPk:await H([REQUESTER]),recipientAmount:20_000_000n,recipientSalt:requestSalt,changeSalt:104n});
    expect(payment.recipientCommitment).to.equal(b32(requestCommitment));
    await f.pool.write.transfer([payment.root,payment.nullifier,payment.proof,output(payment.recipientCommitment),output(payment.changeCommitment)]);

    expect(await f.pool.read.isSpent([merged.nullifiers[0]])).to.equal(true);
    expect(await f.pool.read.isSpent([merged.nullifiers[1]])).to.equal(true);
    expect(await f.pool.read.isSpent([payment.nullifier])).to.equal(true);
    const delivered=await f.pool.read.isCommitmentInserted([b32(requestCommitment)]);
    expect(delivered).to.equal(true);
    expect(await f.usdc.read.balanceOf([f.pool.address])).to.equal(25_000_000n);
    const deposits=await f.pool.getEvents.Deposit({}, {fromBlock:0n});
    expect(deposits.filter(e=>e.args.commitment===b32(requestCommitment))).to.have.length(1);
  });

  it("lets only one of two independently valid payments reach the same commitment", async () => {
    const f = await deployPoolFixture();
    await depositOwnedNote(f, { amount: 30_000_000n, ownerSecret: PAYER, salt: 1n });
    await depositOwnedNote(f, { amount: 50_000_000n, ownerSecret: PAYER, salt: 2n });
    const requesterPk = await H([REQUESTER]);
    const pay = (index: number, changeSalt: bigint) =>
      makeTransferProof(f, {
        index,
        ownerSecret: PAYER,
        recipientPk: requesterPk,
        recipientAmount: 20_000_000n,
        recipientSalt: 777n,
        changeSalt,
      });
    const first = await pay(0, 11n);
    const second = await pay(1, 12n);
    expect(first.recipientCommitment).to.equal(second.recipientCommitment);

    await f.pool.write.transfer([
      first.root,
      first.nullifier,
      first.proof,
      output(first.recipientCommitment),
      output(first.changeCommitment),
    ]);
    await expectRevert(
      f.pool.write.transfer([
        second.root,
        second.nullifier,
        second.proof,
        output(second.recipientCommitment),
        output(second.changeCommitment),
      ]),
      "DuplicateCommitment",
    );

    // The rejected payment keeps its funds: its input note stays unspent (the
    // payer can still use it) and its change note was never inserted.
    expect(await f.pool.read.isSpent([second.nullifier])).to.equal(false);
    expect(await f.pool.read.isCommitmentInserted([second.changeCommitment])).to.equal(false);
    expect(await f.usdc.read.balanceOf([f.pool.address])).to.equal(80_000_000n);
    const deposits = await f.pool.getEvents.Deposit({}, { fromBlock: 0n });
    expect(deposits.filter((d) => d.args.commitment === first.recipientCommitment)).to.have.length(1);
  });

  it("rejects a direct deposit that repeats an inserted commitment", async () => {
    const f = await deployPoolFixture();
    const { commitment } = await depositOwnedNote(f, { amount: 5_000_000n, ownerSecret: 1n, salt: 2n });
    const ownerPk = await H([1n]);
    const proof = await prove("deposit", {
      commitment: commitment.toString(),
      amount: "5000000",
      ownerPk: ownerPk.toString(),
      salt: "2",
    });
    await expectRevert(
      f.pool.write.deposit([b32(commitment), 5_000_000n, proof, b32(1n), "0x"], { account: f.payer.account }),
      "DuplicateCommitment",
    );
    expect(await f.usdc.read.balanceOf([f.pool.address])).to.equal(5_000_000n);
  });

  it("still allows an exact payment with a zero-value change note", async () => {
    const f = await deployPoolFixture();
    await depositOwnedNote(f, { amount: 20_000_000n, ownerSecret: PAYER, salt: 3n });
    const t = await makeTransferProof(f, {
      index: 0,
      ownerSecret: PAYER,
      recipientPk: await H([REQUESTER]),
      recipientAmount: 20_000_000n,
      recipientSalt: 778n,
      changeSalt: 13n,
    });
    expect(t.changeAmount).to.equal(0n);
    await f.pool.write.transfer([
      t.root,
      t.nullifier,
      t.proof,
      output(t.recipientCommitment),
      output(t.changeCommitment),
    ]);
    expect(await f.pool.read.isCommitmentInserted([t.recipientCommitment])).to.equal(true);
    expect(await f.pool.read.isCommitmentInserted([t.changeCommitment])).to.equal(true);
  });
});
