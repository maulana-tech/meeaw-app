import {expect} from "chai";
import {deployPoolFixture,depositOwnedNote,makeMergeProof,makeTransferProof,rememberOwned,output,H,expectRevert} from "./helpers/poolFixture";
describe("independent payment assets",()=>{
 it("consolidates AUSD and sends 20 while USDC input stays unspent",async()=>{
   const ausd=await deployPoolFixture({name:"Agora USD",symbol:"AUSD"}),usdc=await deployPoolFixture(),sender=1001n,recipient=1002n;
   await depositOwnedNote(ausd,{amount:10_000_000n,ownerSecret:sender,salt:101n});await depositOwnedNote(ausd,{amount:15_000_000n,ownerSecret:sender,salt:102n});
   await depositOwnedNote(usdc,{amount:25_000_000n,ownerSecret:sender,salt:801n});
   const merge=await makeMergeProof(ausd,{indices:[0,1],ownerSecret:sender,outSalt:103n});
   await ausd.pool.write.merge([merge.root,...merge.nullifiers,merge.proof,output(merge.outputCommitment)]);
   const index=await rememberOwned(ausd,BigInt(merge.outputCommitment),{amount:merge.outputAmount,ownerSecret:sender,salt:103n});
   const payment=await makeTransferProof(ausd,{index,ownerSecret:sender,recipientPk:await H([recipient]),recipientAmount:20_000_000n,recipientSalt:777n,changeSalt:104n});
   await expectRevert(usdc.pool.write.transfer([payment.root,payment.nullifier,payment.proof,output(payment.recipientCommitment),output(payment.changeCommitment)]),"UnknownRoot");
   await ausd.pool.write.transfer([payment.root,payment.nullifier,payment.proof,output(payment.recipientCommitment),output(payment.changeCommitment)]);
   expect(payment.changeAmount).to.equal(5_000_000n);expect(await ausd.usdc.read.symbol()).to.equal("AUSD");
   expect(await usdc.pool.read.isSpent([`0x${(await H([sender,0n])).toString(16).padStart(64,"0")}`])).to.equal(false);
   expect(await ausd.pool.read.isCommitmentInserted([payment.recipientCommitment])).to.equal(true);
 });
});
