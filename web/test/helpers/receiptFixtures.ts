import type { AssetSymbol } from "../../src/lib/assets";
import { commitment, ownerPk, merkleProof, bytesToHex, toBE32 } from "../../src/lib/crypto";
import { assetPool } from "./multiAssetFixtures";
import { testAccount } from "./requestFixtures";
import type { ReceiptV1, ReceiptV2 } from "../../src/features/receipts/receiptTypes";
import type { ReceiptChainSnapshot } from "../../src/features/receipts/receiptChainTypes";
import type { ScanResult } from "../../src/lib/notes";
export async function makeReceiptFixture(asset:AssetSymbol="AUSD") {
 const pool=assetPool(asset),account=testAccount(1),amount=20_000_000n,salt=7n,leafIndex=0;
 const pk=await ownerPk(account.ownerSecret),leaf=await commitment(amount,pk,salt),path=await merkleProof([leaf],leafIndex,pool.depth);
 const v1:ReceiptV1={version:1,pool:pool.address,network:"eip155:31337",leafIndex,commitment:leaf.toString(),commitmentHex:bytesToHex(toBE32(leaf)),root:path.root.toString(),rootHex:bytesToHex(toBE32(path.root)),amount:amount.toString(),amountLabel:"20",ownerPk:pk.toString(),salt:salt.toString(),pathElements:path.pathElements.map(String),pathIndices:path.pathIndices,username:"alice",disclosedAt:"2026-10-06T00:00:00.000Z",asset,tokenDecimals:6};
 const v2:ReceiptV2={...v1,version:2,asset,tokenDecimals:6,anchor:{blockNumber:100,blockHash:`0x${"11".repeat(32)}`,leafCount:1}};
 const scan:ScanResult={scope:pool.scope,notes:[{scope:pool.scope,leafIndex,amount,salt,spent:false}],leaves:[leaf],claimable:amount,mirrorAvailable:true,indexedAt:v1.disclosedAt,health:"healthy",snapshot:{blockNumber:100,leafCount:1}};
 const snapshot:ReceiptChainSnapshot={pool:pool.scope,chainId:31337,blockNumber:100,blockHash:v2.anchor.blockHash,root:`0x${v2.rootHex}`,leafCount:1,token:pool.token,tokenDecimals:6,headBlock:105,confirmed:true};
 return {v1,v2,pool,account,scan,snapshot};
}
