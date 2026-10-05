// @vitest-environment happy-dom
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({pay:vi.fn(),operation:null as null}));
vi.mock("../src/components/WalletProvider",()=>({useWallet:()=>({accountUnlocked:true,promptUnlock:vi.fn()})}));
vi.mock("../src/features/requests/hooks/useRequestPayment",()=>({useRequestPayment:()=>({operation:state.operation,working:false,error:null,pay:state.pay,refresh:vi.fn()})}));
vi.mock("../src/lib/pools",()=>({requestPool:()=>({scope:"31337:0x1111111111111111111111111111111111111111",requestCapable:true,role:"active"}),findPool:()=>({scope:"31337:0x1111111111111111111111111111111111111111",role:"active",requestCapable:true,chainId:31337,address:"0x1111111111111111111111111111111111111111",deployBlock:0,token:"0x5555555555555555555555555555555555555555",tokenDecimals:6,depth:20,confirmations:1})}));
vi.mock("../src/components/dashboard/useMyNotes",()=>({useMyNotes:()=>({claimable:25_000_000n,loading:false,refreshing:false,stale:false,error:null,indexedAt:"2026-10-05T00:00:00.000Z",notes:[],refresh:vi.fn()})}));
import {PayRequestDialog} from "../src/components/dashboard/PayRequestDialog";
describe("fixed private balance payment dialog",()=>{
  it("blocks a second send while a stored operation is being reconciled",async()=>{
    const record={record:{id:"r",pool:"31337:0x1111111111111111111111111111111111111111",requester:{username:"client"},addressee:{username:"alice"},status:"pending",operationId:"op",revision:0},amount:20_000_000n,note:"Design work",unreadable:false};
    render(<PayRequestDialog request={record as never} open onOpenChange={vi.fn()} operation={state.operation as never} working={false} error={null} onPay={state.pay}/>);
    expect(screen.getByText("Private Mawee balance")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(/Checking the existing private payment/);
    expect(screen.queryByRole("button",{name:/Pay 20 USDC/})).not.toBeInTheDocument();
  });
});
