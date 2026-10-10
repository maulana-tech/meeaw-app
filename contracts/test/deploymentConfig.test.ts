import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {expect} from "chai";
import type {Hex} from "viem";
import {candidateManifest,confirmedDeploymentBlock,renderIndexerCandidate,writeDeploymentCandidates} from "../scripts/deployment-config";

const a=(c:string):Hex=>`0x${c.repeat(40)}` as Hex;
describe("reviewable pool deployment candidates",()=>{
  it("records the creation receipt block instead of a cached chain head",()=>{
    const receipt={status:"success" as const,contractAddress:a("1"),blockNumber:69837052n};
    expect(confirmedDeploymentBlock(receipt,a("1"))).to.equal(69837052);
    expect(()=>confirmedDeploymentBlock({...receipt,status:"reverted"},a("1"))).to.throw("receipt");
    expect(()=>confirmedDeploymentBlock(receipt,a("2"))).to.throw("receipt");
  });
  it("keeps every prior same-chain pool withdrawal-only and makes the new pool active",()=>{
    const legacy=[{chainId:10143,address:a("1"),deployBlock:50,token:a("2"),tokenDecimals:6,depth:20,confirmations:2,role:"active",requestCapable:false}];
    const manifest=candidateManifest({chainId:10143,priorManifest:JSON.stringify(legacy),newPool:{chainId:10143,address:a("3"),deployBlock:200,token:a("2"),tokenDecimals:6},confirmations:1});
    expect(manifest).to.have.length(2);
    expect(manifest[0]).to.include({address:a("1"),role:"legacy",requestCapable:false,confirmations:2});
    expect(manifest[1]).to.include({address:a("3"),role:"active",requestCapable:true});
  });
  it("replaces only the same-asset pool when another stablecoin gets its own pool",()=>{
    const usdc={chainId:10143,address:a("1"),deployBlock:50,token:a("2"),tokenDecimals:6,depth:20,confirmations:1,role:"active",requestCapable:true};
    const ausd=candidateManifest({chainId:10143,priorManifest:JSON.stringify([usdc]),newPool:{chainId:10143,address:a("3"),deployBlock:200,token:a("4"),tokenDecimals:6,asset:"AUSD",mintable:true},confirmations:1});
    expect(ausd[0]).to.include({address:a("1"),role:"active",requestCapable:true,asset:"USDC"});
    expect(ausd[1]).to.include({address:a("3"),role:"active",requestCapable:false,asset:"AUSD",mintable:true});
    const ausd2=candidateManifest({chainId:10143,priorManifest:JSON.stringify(ausd),newPool:{chainId:10143,address:a("5"),deployBlock:300,token:a("4"),tokenDecimals:6,asset:"AUSD"},confirmations:1});
    expect(ausd2.map((p)=>[p.address,p.role])).to.deep.equal([[a("1"),"active"],[a("3"),"legacy"],[a("5"),"active"]]);
    expect(()=>candidateManifest({chainId:10143,newPool:{chainId:10143,address:a("3"),deployBlock:2,token:a("4"),tokenDecimals:6,asset:"DAI"},confirmations:1})).to.throw();
  });
  it("keeps the env-described USDC pool active when a first non-USDC pool is added",()=>{
    const previousPool={chainId:10143,address:a("1"),deployBlock:50,token:a("2"),tokenDecimals:6};
    const manifest=candidateManifest({chainId:10143,previousPool,newPool:{chainId:10143,address:a("3"),deployBlock:200,token:a("4"),tokenDecimals:6,asset:"MUSD"},confirmations:1});
    expect(manifest.map((p)=>[p.asset,p.role,p.requestCapable])).to.deep.equal([["USDC","active",true],["MUSD","active",false]]);
  });
  it("can leave the indexer start block alone",()=>{
    const yaml=`chains:\n  - id: 10143\n    start_block: 90\n    contracts:\n      - name: Pool\n        address:\n          - "${a("1")}"\n      - name: Registry\n        address:\n          - "${a("4")}"\n`;
    const rendered=renderIndexerCandidate(yaml,10143,null,{Pool:[a("1"),a("3")],Registry:a("4")});
    expect(rendered).to.contain("start_block: 90");
    expect(rendered).to.contain(a("3"));
  });
  it("replaces the 0x0 template placeholder instead of indexing it",()=>{
    const zero="0x0000000000000000000000000000000000000000";
    const yaml=`chains:\n  - id: 10143\n    start_block: 0\n    contracts:\n      - name: Pool\n        address:\n          - "${zero}"\n      - name: Registry\n        address:\n          - "${zero}"\n`;
    const rendered=renderIndexerCandidate(yaml,10143,null,{Pool:[a("3"),a("1")],Registry:a("4")});
    expect(rendered).to.not.contain(`- "${zero}"`);
    expect(rendered).to.contain(`- "${a("1")}"`);
    expect(rendered).to.contain(`- "${a("3")}"`);
    expect(rendered).to.contain(`- "${a("4")}"`);
  });
  it("preserves Pool and Registry addresses while emitting candidate files only",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"mawee-candidate-"));
    try{
      const pool=a("3"),registry=a("4"),oldPool=a("1");
      const existing="NEXT_PUBLIC_MAWEE_POOL_ADDRESS=keep\n";
      const yaml=`chains:\n  - id: 10143\n    start_block: 90\n    contracts:\n      - name: Pool\n        address:\n          - \"${oldPool}\"\n      - name: Registry\n        address:\n          - \"${registry}\"\n`;
      fs.writeFileSync(path.join(root,"web.env.local"),existing);
      fs.writeFileSync(path.join(root,"indexer.config.yaml"),yaml);
      const manifest=candidateManifest({chainId:10143,newPool:{chainId:10143,address:pool as `0x${string}`,deployBlock:100,token:a("2") as `0x${string}`,tokenDecimals:6},confirmations:1,priorManifest:JSON.stringify([{chainId:10143,address:oldPool,deployBlock:50,token:a("2"),tokenDecimals:6,depth:20,role:"active",requestCapable:false}])});
      const candidateYaml=renderIndexerCandidate(yaml,10143,100n,{Pool:[oldPool,pool],Registry:registry});
      const result=writeDeploymentCandidates({root,network:"test",chainId:10143,deployBlock:100,pool:pool as `0x${string}`,manifest,webValues:{NEXT_PUBLIC_MONAD_CHAIN_ID:"10143",NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS:registry,NEXT_PUBLIC_MAWEE_POOL_ADDRESS:pool,NEXT_PUBLIC_MAWEE_POOLS:JSON.stringify(manifest)},indexerConfig:candidateYaml});
      expect(fs.readFileSync(path.join(root,"web.env.local"),"utf8")).to.equal(existing);
      expect(fs.readFileSync(path.join(root,"indexer.config.yaml"),"utf8")).to.equal(yaml);
      expect(fs.readFileSync(result.webEnv,"utf8")).to.contain(`\"${oldPool}\"`);
      expect(fs.readFileSync(result.webEnv,"utf8")).to.contain(`\"${pool}\"`);
      expect(fs.readFileSync(result.indexerConfig,"utf8")).to.contain(oldPool);
      expect(fs.readFileSync(result.indexerConfig,"utf8")).to.contain(pool);
      expect(fs.readFileSync(result.indexerConfig,"utf8")).to.contain(registry);
      expect(fs.readFileSync(result.indexerConfig,"utf8")).to.contain("start_block: 100");
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
  it("rejects cross-chain manifests and output files that already exist",()=>{
    expect(()=>candidateManifest({chainId:143,priorManifest:JSON.stringify([{chainId:10143,address:a("1"),deployBlock:1,token:a("2"),tokenDecimals:6,depth:20,role:"active",requestCapable:false}]),newPool:{chainId:143,address:a("3"),deployBlock:2,token:a("2"),tokenDecimals:6},confirmations:1})).to.throw();
    expect(()=>candidateManifest({chainId:143,newPool:{chainId:143,address:a("3"),deployBlock:2,token:a("2"),tokenDecimals:19},confirmations:1})).to.throw();
  });
  it("changes only the selected chain in a multi-chain indexer candidate",()=>{
    const old=a("1"),added=a("3"),registry10143=a("4"),pool143=a("5"),registry143=a("6");
    const yaml=`chains:\n  - id: 10143\n    start_block: 90\n    contracts:\n      - name: Pool\n        address:\n          - "${old}"\n      - name: Registry\n        address:\n          - "${registry10143}"\n  - id: 143\n    start_block: 800\n    contracts:\n      - name: Pool\n        address:\n          - "${pool143}"\n      - name: Registry\n        address:\n          - "${registry143}"\n`;
    const rendered=renderIndexerCandidate(yaml,10143,100n,{Pool:[old,added],Registry:registry10143});
    expect(rendered).to.contain(`- id: 10143\n    start_block: 100`);
    expect(rendered).to.contain(`- id: 143\n    start_block: 800`);
    expect(rendered).to.contain(`- "${added}"`);
    expect(rendered).to.contain(`- "${pool143}"`);
    expect(rendered).to.contain(`- "${registry143}"`);
  });
});
