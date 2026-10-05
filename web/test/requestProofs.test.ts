import path from "node:path";
import {describe,expect,it} from "vitest";
import {decryptNote,ownerPk,commitment,toBE32,viewPubkey} from "../src/lib/crypto";
import {hexToBytes} from "viem";
import {buildMergeSubmission,buildPaymentSubmission} from "../src/features/requests/requestProofs";
import {makeRequestFixture,testSigner} from "./helpers/requestFixtures";
import type {ScanResult} from "../src/lib/notes";
describe("request browser proof construction",()=>{
  it("merges two owned notes with actual browser artifacts",async()=>{
    const f=await makeRequestFixture(),pk=await ownerPk(f.addressee.ownerSecret);
    const leaves=[await commitment(10_000_000n,pk,1n),await commitment(15_000_000n,pk,2n)];
    const scan:ScanResult={scope:f.pool.scope,notes:[{scope:f.pool.scope,leafIndex:0,amount:10_000_000n,salt:1n,spent:false},{scope:f.pool.scope,leafIndex:1,amount:15_000_000n,salt:2n,spent:false}],leaves,claimable:25_000_000n,mirrorAvailable:true,indexedAt:new Date().toISOString(),health:"healthy"};
    const op={id:f.record.id,requestId:f.record.id,pool:f.pool.scope,phase:"preparing" as const,completedMerges:0,nextStep:0,txHash:null,updatedAt:new Date().toISOString()};
    const submission=await buildMergeSubmission({record:f.record,operation:op,account:f.addressee,scan,inputIndices:[0,1],signer:testSigner(2),artifactRoot:path.resolve("public/zk")});
    const decoded=decryptNote(f.addressee.viewSk,hexToBytes(submission.outputs[0].ephemeralPk),hexToBytes(submission.outputs[0].ciphertext));
    expect(decoded?.amount).toBe(25_000_000n);expect(submission.nullifiers).toHaveLength(2);
    expect(submission.proof.a).toHaveLength(2);
  },30000);
  it("uses the request's exact salt and amount for the recipient output",async()=>{
    const f=await makeRequestFixture(),pk=await ownerPk(f.addressee.ownerSecret);
    const scan:ScanResult={scope:f.pool.scope,notes:[{scope:f.pool.scope,leafIndex:0,amount:25_000_000n,salt:1n,spent:false}],leaves:[await commitment(25_000_000n,pk,1n)],claimable:25_000_000n,mirrorAvailable:true,indexedAt:new Date().toISOString(),health:"healthy"};
    const operation={id:f.record.id,requestId:f.record.id,pool:f.pool.scope,phase:"preparing" as const,completedMerges:0,nextStep:0,txHash:null,updatedAt:new Date().toISOString()};
    const s=await buildPaymentSubmission({record:f.record,payload:f.payload,operation,account:f.addressee,scan,inputIndex:0,signer:testSigner(2),pool:f.pool,artifactRoot:path.resolve("public/zk")});
    expect(s.outputs[0].commitment).toBe(f.record.recipientCommitment);
    expect(decryptNote(f.requester.viewSk,hexToBytes(s.outputs[0].ephemeralPk),hexToBytes(s.outputs[0].ciphertext))).toEqual({amount:20_000_000n,salt:BigInt(f.payload.salt)});
    expect(decryptNote(f.addressee.viewSk,hexToBytes(s.outputs[1].ephemeralPk),hexToBytes(s.outputs[1].ciphertext))?.amount).toBe(5_000_000n);
    await expect(buildPaymentSubmission({record:f.record,payload:f.payload,operation,account:f.outsider,scan,inputIndex:0,signer:testSigner(2)})).rejects.toThrow();
  },30000);
});
