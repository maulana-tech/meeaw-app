import {it,expect,vi} from "vitest";
const auth=vi.hoisted(()=>({token:vi.fn().mockRejectedValue(new Error("Auth is not ready"))}));
vi.mock("@privy-io/react-auth",()=>({getAccessToken:auth.token}));
import {loadReceiptSnapshot} from "../src/features/receipts/receiptClient";
it("checks public coordinates without cookies or consulting an unready auth SDK",async()=>{
 const request=vi.fn().mockResolvedValue(new Response(JSON.stringify([{result:{data:{status:"unavailable",reason:"historical-data-unavailable"}}}]),{headers:{"content-type":"application/json"}}));
 vi.stubGlobal("fetch",request);
 try{expect(await loadReceiptSnapshot({pool:`31337:0x${"1".repeat(40)}`,blockNumber:100})).toEqual({status:"unavailable",reason:"historical-data-unavailable"});expect(request.mock.calls[0][1].credentials).toBe("omit");expect(auth.token).not.toHaveBeenCalled();expect(new Headers(request.mock.calls[0][1].headers).get("authorization")).toBeNull();}finally{vi.unstubAllGlobals();}
});
