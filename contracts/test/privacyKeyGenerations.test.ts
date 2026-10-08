import { expect } from "chai";
import hre from "hardhat";
import { toHex } from "viem";
import { registryTypedData } from "../../web/src/lib/typedData";
import { deployPoolFixture, depositOwnedNote, H, makeMergeProof, makeTransferProof, output, rememberOwned } from "./helpers/poolFixture";

describe("routine privacy key generations", () => {
  it("rotates registry keys without spending notes and consumes the signed permit nonce", async () => {
    const f=await deployPoolFixture({name:"Agora USD",symbol:"AUSD"}),[owner,relayer]=await hre.viem.getWalletClients(),registry=await hre.viem.deployContract("MaweeRegistry");
    await depositOwnedNote(f,{amount:15_000_000n,ownerSecret:1001n,salt:11n});
    const old=toHex(await H([1001n]),{size:32}),next=toHex(await H([1002n]),{size:32}),view=toHex(1n,{size:32}),nextView=toHex(2n,{size:32});
    await registry.write.register(["alice",old,view],{account:owner.account});
    const before=await f.pool.read.currentRoot(),deadline=BigInt(Math.floor(Date.now()/1000)+3600),nonce=await registry.read.nonces([owner.account.address]);
    const signature=await owner.signTypedData({...registryTypedData({rotate:true,chainId:31337,registry:registry.address,owner:owner.account.address,username:"alice",notePubkey:next,viewPubkey:nextView,nonce,deadline})});
    await registry.write.setPubkeysFor([owner.account.address,"alice",next,nextView,deadline,signature],{account:relayer.account});
    expect((await registry.read.resolve(["alice"])).notePubkey).to.equal(next);
    expect(await registry.read.nonces([owner.account.address])).to.equal(nonce+1n);
    expect(await f.pool.read.currentRoot()).to.equal(before);
    expect(await f.usdc.read.balanceOf([f.pool.address])).to.equal(15_000_000n);
  });
  it("prepares old 15 plus new 5 privately, merges one owner, and pays exactly 20", async () => {
    const f=await deployPoolFixture({name:"Agora USD",symbol:"AUSD"}),other=await deployPoolFixture();
    await depositOwnedNote(f,{amount:15_000_000n,ownerSecret:1001n,salt:11n});
    await depositOwnedNote(f,{amount:5_000_000n,ownerSecret:1002n,salt:12n});
    await depositOwnedNote(other,{amount:7_000_000n,ownerSecret:1001n,salt:21n});
    let rejected=false;try{await makeMergeProof(f,{indices:[0,1],ownerSecret:1001n,outSalt:22n});}catch{rejected=true;}expect(rejected).to.equal(true);
    const moved=await makeTransferProof(f,{index:0,ownerSecret:1001n,recipientPk:await H([1002n]),recipientAmount:15_000_000n,recipientSalt:13n,changeSalt:14n});
    await f.pool.write.transfer([moved.root,moved.nullifier,moved.proof,output(moved.recipientCommitment),output(moved.changeCommitment)]);
    const index=await rememberOwned(f,BigInt(moved.recipientCommitment),{amount:15_000_000n,ownerSecret:1002n,salt:13n});
    const merged=await makeMergeProof(f,{indices:[1,index],ownerSecret:1002n,outSalt:15n});
    await f.pool.write.merge([merged.root,merged.nullifiers[0],merged.nullifiers[1],merged.proof,output(merged.outputCommitment)]);
    const funded=await rememberOwned(f,BigInt(merged.outputCommitment),{amount:20_000_000n,ownerSecret:1002n,salt:15n});
    const paid=await makeTransferProof(f,{index:funded,ownerSecret:1002n,recipientPk:await H([1003n]),recipientAmount:20_000_000n,recipientSalt:16n,changeSalt:17n});
    await f.pool.write.transfer([paid.root,paid.nullifier,paid.proof,output(paid.recipientCommitment),output(paid.changeCommitment)]);
    expect(await f.pool.read.isCommitmentInserted([paid.recipientCommitment])).to.equal(true);
    expect(await f.pool.read.isSpent([moved.nullifier])).to.equal(true);
    expect(await f.pool.read.isSpent([paid.nullifier])).to.equal(true);
    expect(await f.usdc.read.balanceOf([f.pool.address])).to.equal(20_000_000n);
    expect(await other.usdc.read.balanceOf([other.pool.address])).to.equal(7_000_000n);
  });
});
