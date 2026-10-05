// @vitest-environment happy-dom
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({rows:[] as unknown[],count:2,unlock:vi.fn(),pay:vi.fn(),cancel:vi.fn(),decline:vi.fn()}));
vi.mock("../src/components/WalletProvider",()=>({useWallet:()=>({address:"0x1111111111111111111111111111111111111111",username:"alice",accountUnlocked:true,promptUnlock:state.unlock})}));
vi.mock("../src/features/requests/hooks/useRequests",()=>({useRequests:()=>({rows:state.rows,count:state.count,isLoading:false,error:null,hasNext:false,loadMore:vi.fn(),hasPrevious:false,previousPage:vi.fn(),refresh:vi.fn()})}));
vi.mock("../src/features/requests/hooks/useRequestPayment",()=>({useRequestPayment:()=>({operation:null,working:false,error:null,pay:state.pay,refresh:vi.fn()})}));
vi.mock("../src/features/requests/hooks/useCreateRequest",()=>({useCreateRequest:()=>({create:vi.fn(),isCreating:false,error:null,clearError:vi.fn()})}));
vi.mock("../src/lib/pools",()=>({requestPool:()=>({scope:"31337:0x1111111111111111111111111111111111111111",requestCapable:true,role:"active",tokenDecimals:6}),activePool:()=>({scope:"31337:0x1111111111111111111111111111111111111111",chainId:31337,address:"0x1111111111111111111111111111111111111111",token:"0x5555555555555555555555555555555555555555",tokenDecimals:6,depth:20,requestCapable:true,role:"active",deployBlock:0,confirmations:1}),findPool:()=>({scope:"31337:0x1111111111111111111111111111111111111111",requestCapable:true,role:"active",tokenDecimals:6})}));
vi.mock("../src/components/dashboard/useMyNotes",()=>({useMyNotes:()=>({claimable:25_000_000n,loading:false,refreshing:false,stale:false,error:null,indexedAt:"2026-10-05T00:00:00.000Z",notes:[],refresh:vi.fn()})}));
import {RequestsDashboard} from "../src/components/dashboard/RequestsDashboard";
function received(id:string,status="pending"){return {record:{id,pool:"31337:0x1111111111111111111111111111111111111111",requester:{username:"client",wallet:"0x2222222222222222222222222222222222222222"},addressee:{username:"alice"},status,operationId:null,revision:0},amount:20_000_000n,note:"Design work",unreadable:false};}
describe("payment requests page",()=>{
  beforeEach(()=>{state.rows=[received("request-a")];state.count=2;});
  it("opens Received and lets the user switch to Sent",async()=>{
    const user=userEvent.setup();render(<RequestsDashboard onCreate={()=>{}}/>);
    expect(screen.getByRole("tab",{name:/Received/})).toHaveAttribute("aria-selected","true");
    await user.click(screen.getByRole("tab",{name:"Sent"}));
    expect(screen.getByRole("tab",{name:"Sent"})).toHaveAttribute("aria-selected","true");
  });
  it("shows an accessible unlock state without revealing a locked amount",()=>{
    state.rows=[{...received("locked"),amount:null,note:null}];
    render(<RequestsDashboard onCreate={()=>{}}/>);
    expect(screen.getByText("Unlock to view amount")).toBeInTheDocument();
    expect(screen.queryByText("20 USDC")).not.toBeInTheDocument();
  });
  it("keeps payment progress visible on the request row",()=>{
    const row=received("pending");row.record.operationId="op-123";state.rows=[row];
    render(<RequestsDashboard onCreate={()=>{}}/>);
    expect(screen.getByText("Payment is being checked")).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/Review/})).not.toBeInTheDocument();
  });
});
