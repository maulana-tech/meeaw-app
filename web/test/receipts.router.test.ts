import {describe,it,expect,vi} from "vitest";
const mock=vi.hoisted(()=>({read:vi.fn().mockResolvedValue({status:"unavailable",reason:"historical-data-unavailable"})}));
vi.mock("../src/server/modules/receipts/receipts.service",()=>({getReceiptChainSnapshot:mock.read}));
import {receiptsRouter} from "../src/server/modules/receipts/receipts.router";
describe("receipt public query",()=>{
 it("requires no authentication and forbids disclosure data",async()=>{
  const caller=receiptsRouter.createCaller({ip:"receipt-router",authToken:null,privyUserId:null,privyClaim:null,authError:null});
  const input={pool:`31337:0x${"1".repeat(40)}` as const,blockNumber:100};
  expect(await caller.chainSnapshot(input)).toEqual({status:"unavailable",reason:"historical-data-unavailable"});
  for(const key of ["salt","amount","ownerPk","pathElements","rpcUrl","filename"])await expect(caller.chainSnapshot({...input,[key]:"PRIVATE_MARKER"})).rejects.toMatchObject({code:"BAD_REQUEST"});
  expect(mock.read).toHaveBeenCalledTimes(1);expect(JSON.stringify(mock.read.mock.calls)).not.toContain("PRIVATE_MARKER");
 });
});
