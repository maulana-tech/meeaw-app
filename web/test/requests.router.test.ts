import {describe,expect,it} from "vitest";
import {requestsRouter} from "../src/server/modules/requests/requests.router";
describe("requests router authentication",()=>{
  it("does not expose envelopes or counts to anonymous callers",async()=>{
    const caller=requestsRouter.createCaller({ip:null,authToken:null,privyUserId:null,privyClaim:null,authError:null});
    await expect(caller.pendingCount()).rejects.toMatchObject({code:"UNAUTHORIZED"});
    await expect(caller.listReceived()).rejects.toMatchObject({code:"UNAUTHORIZED"});
    await expect(caller.get({id:"00000000-0000-4000-8000-000000000001"})).rejects.toMatchObject({code:"UNAUTHORIZED"});
  });
});
