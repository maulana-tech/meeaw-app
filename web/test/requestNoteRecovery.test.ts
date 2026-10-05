import {describe,expect,it} from "vitest";
import {recoverPaidRequestOutputs,recoverRequestNote} from "../src/features/requests/requestNoteRecovery";
import {makeRequestFixture} from "./helpers/requestFixtures";
import {fromBE,hexToBytes} from "../src/lib/crypto";
import type {ScanResult} from "../src/lib/notes";
import {openRequest} from "../src/features/requests/requestCrypto";
describe("owned request output recovery",()=>{
  it("reconstructs only an owned matching leaf and preserves spent checks",async()=>{
    const f=await makeRequestFixture();const scan:ScanResult={scope:f.pool.scope,leaves:[fromBE(hexToBytes(f.record.recipientCommitment))],notes:[],claimable:0n,mirrorAvailable:true,indexedAt:new Date().toISOString(),health:"healthy"};
    const recovered=await recoverRequestNote({record:f.record,payload:f.payload,scan,account:f.requester,isSpent:async()=>true});
    expect(recovered).toMatchObject({amount:20_000_000n,leafIndex:0,spent:true});
    expect(await recoverRequestNote({record:f.record,payload:f.payload,scan,account:f.addressee,isSpent:async()=>false})).toBeNull();
  });
  it("restores a paid request note after indexed ciphertext loss",async()=>{
    const f=await makeRequestFixture(),commit=fromBE(hexToBytes(f.record.recipientCommitment));
    expect(await openRequest(f.record,f.requester,f.pool)).toMatchObject({amount:"20000000",note:"Dinner 🍜"});
    const scan:ScanResult={scope:f.pool.scope,leaves:[commit],notes:[],claimable:0n,mirrorAvailable:true,indexedAt:new Date().toISOString(),health:"healthy"};
    const direct=await recoverRequestNote({record:f.record,payload:f.payload,scan,account:f.requester,isSpent:async()=>false});
    expect(direct?.amount).toBe(20_000_000n);
    const paid={...f.record,status:"paid" as const,revision:1,operationId:f.record.id,updatedAt:f.record.createdAt,receipt:{txHash:`0x${"11".repeat(32)}` as const,leafIndex:0,block:25}};
    expect(paid.status).toBe("paid");expect(paid.pool).toBe(f.pool.scope);expect(paid.receipt?.leafIndex).toBe(0);
    const signed={version:paid.version,id:paid.id,pool:paid.pool,requester:paid.requester,addressee:paid.addressee,createdAt:paid.createdAt,recipientCommitment:paid.recipientCommitment,requesterEnvelope:paid.requesterEnvelope,addresseeEnvelope:paid.addresseeEnvelope,signature:paid.signature};
    expect(await openRequest(signed as typeof f.record,f.requester,f.pool)).toEqual(f.payload);
    const recovered=await recoverPaidRequestOutputs(f.requester,f.pool,scan,async()=>({items:[paid],nextCursor:null}),async()=>false);
    expect(recovered.claimable).toBe(20_000_000n);
    expect(recovered.notes).toContainEqual(expect.objectContaining({leafIndex:0,amount:20_000_000n,salt:BigInt(f.payload.salt),spent:false}));
  });
});
