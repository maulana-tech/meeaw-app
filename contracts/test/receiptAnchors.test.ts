import {expect} from "chai";
import hre from "hardhat";
import fs from "node:fs/promises";
import path from "node:path";
import {deployPoolFixture,depositOwnedNote,makeTransferProof,output,H,b32,merkleProof} from "./helpers/poolFixture";
describe("historical receipt anchors",()=>{
 it("keeps anchored inclusion after the root ring expires and the note is spent",async()=>{
  const f=await deployPoolFixture({name:"Agora USD",symbol:"AUSD"}),other=await deployPoolFixture();
  const ownerSecret=1001n,salt=1n,amount=20_000_000n;
  const first=await depositOwnedNote(f,{amount,ownerSecret,salt});
  const block=await f.publicClient.getBlock({blockTag:"latest"}),oldRoot=await f.pool.read.currentRoot(),proof=await merkleProof(f.leaves,0);
  const abi=(await hre.artifacts.readArtifact("MaweePool")).abi;
  for(let i=0;i<31;i++)await depositOwnedNote(f,{amount:1_000_000n,ownerSecret,salt:BigInt(i+2)});
  expect(await f.pool.read.isKnownRoot([oldRoot])).to.equal(false);
  const read=(name:string)=>f.publicClient.readContract({address:f.pool.address,abi,functionName:name,blockNumber:block.number});
  expect(await read("currentRoot")).to.equal(oldRoot);expect(await read("nextIndex")).to.equal(1);
  expect(await other.pool.read.currentRoot()).not.to.equal(oldRoot);
  const payment=await makeTransferProof(f,{index:0,ownerSecret,recipientPk:await H([1002n]),recipientAmount:10_000_000n,recipientSalt:901n,changeSalt:902n});
  await f.pool.write.transfer([payment.root,payment.nullifier,payment.proof,output(payment.recipientCommitment),output(payment.changeCommitment)]);
  expect(await f.pool.read.isSpent([payment.nullifier])).to.equal(true);
  expect(await read("currentRoot")).to.equal(oldRoot);expect(await read("nextIndex")).to.equal(1);
  const pool={scope:`31337:${f.pool.address.toLowerCase()}`,chainId:31337,address:f.pool.address.toLowerCase(),token:f.usdc.address.toLowerCase(),asset:"AUSD",tokenDecimals:6,depth:20,confirmations:1,deployBlock:0,role:"active",mintable:true,requestCapable:true,transferCapable:true};
  const bundle={version:2,pool:pool.address,network:"eip155:31337",leafIndex:first.leafIndex,commitmentHex:b32(first.commitment).slice(2),commitment:first.commitment.toString(),rootHex:oldRoot.slice(2),root:BigInt(oldRoot).toString(),amount:amount.toString(),amountLabel:"20",ownerPk:(await H([ownerSecret])).toString(),salt:salt.toString(),pathElements:proof.pathElements.map(String),pathIndices:proof.pathIndices,username:"local-test",disclosedAt:"2026-10-06T00:00:00.000Z",asset:"AUSD",tokenDecimals:6,anchor:{blockNumber:Number(block.number),blockHash:block.hash,leafCount:1}};
  const snapshot={pool:pool.scope,chainId:31337,blockNumber:Number(block.number),blockHash:block.hash,root:oldRoot,leafCount:1,token:pool.token,tokenDecimals:6,headBlock:Number((await f.publicClient.getBlock({blockTag:"latest"})).number),confirmed:true};
  const target=path.resolve(__dirname,"../../.superpowers/sdd/2026-10-06-receipt-verification/real-chain-receipt.json");
  if(process.env.RECEIPT_WRITE_EVIDENCE==="1"){
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,JSON.stringify({pool,bundle,snapshot},null,2));
  }
 });
});
