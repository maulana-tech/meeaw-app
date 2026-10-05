// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from "vitest";
import {maweePoolAbi} from "../src/lib/abi";
import {relayerAddress,relayerConfigured,relayWrite} from "../src/server/lib/relayer";
const HASH=`0x${"11".repeat(32)}` as const;
beforeEach(()=>{vi.stubEnv("RELAYER_PRIVATE_KEY","");});
describe("relayer configuration",()=>{
  it("never submits without a configured key",async()=>{
    expect(relayerConfigured()).toBe(false);expect(relayerAddress()).toBeNull();
    await expect(relayWrite({address:"0x2222222222222222222222222222222222222222",abi:maweePoolAbi,functionName:"withdraw",args:["0x3333333333333333333333333333333333333333",1n,HASH,HASH,{a:[1n,2n],b:[[3n,4n],[5n,6n]],c:[7n,8n]}]})).rejects.toThrow("not configured");
  });
  it("derives only the public address from its local signing key",()=>{
    vi.stubEnv("RELAYER_PRIVATE_KEY",`0x${"11".repeat(32)}`);
    expect(relayerConfigured()).toBe(true);
    expect(relayerAddress()?.toLowerCase()).toBe("0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a");
  });
});
