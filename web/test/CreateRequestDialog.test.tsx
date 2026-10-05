// @vitest-environment happy-dom
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,expect,it,vi} from "vitest";
const mock=vi.hoisted(()=>({create:vi.fn(),clear:vi.fn(),success:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:mock.success})}));
vi.mock("../src/components/WalletProvider",()=>({useWallet:()=>({accountUnlocked:true,username:"alice",address:"0x2222222222222222222222222222222222222222",promptUnlock:vi.fn()})}));
vi.mock("../src/lib/pools",()=>({activePool:()=>({scope:"31337:0x1111111111111111111111111111111111111111",chainId:31337,address:"0x1111111111111111111111111111111111111111",token:"0x5555555555555555555555555555555555555555",tokenDecimals:6,requestCapable:true}),requestPool:()=>({scope:"31337:0x1111111111111111111111111111111111111111",chainId:31337,address:"0x1111111111111111111111111111111111111111",token:"0x5555555555555555555555555555555555555555",tokenDecimals:6,depth:20,confirmations:1,deployBlock:0,requestCapable:true,role:"active"})}));
vi.mock("../src/features/requests/hooks/useCreateRequest",()=>({useCreateRequest:()=>({create:mock.create,isCreating:false,error:null,clearError:mock.clear})}));
import {CreateRequestDialog} from "../src/components/dashboard/CreateRequestDialog";
describe("request creation dialog",()=>{
  beforeEach(()=>{vi.clearAllMocks();mock.create.mockResolvedValue({id:"r"});});
  it("creates a fixed USDC request from username, amount and optional note",async()=>{
    const user=userEvent.setup();render(<CreateRequestDialog open onOpenChange={mock.success}/>);
    await user.type(screen.getByRole("textbox",{name:/Request from/}),"@client");
    await user.type(screen.getByRole("textbox",{name:/Amount/}),"20.5");
    await user.type(screen.getByRole("textbox",{name:/Note/}),"Website milestone");
    await user.click(screen.getByRole("button",{name:"Send request"}));
    await waitFor(()=>expect(mock.create).toHaveBeenCalledWith({username:"@client",amount:"20.5",note:"Website milestone"}));
  });
  it("requires a positive fixed amount",async()=>{
    const user=userEvent.setup();render(<CreateRequestDialog open onOpenChange={mock.success}/>);
    await user.type(screen.getByRole("textbox",{name:/Request from/}),"client");
    await user.type(screen.getByRole("textbox",{name:/Amount/}),"0");
    await user.click(screen.getByRole("button",{name:"Send request"}));
    expect(await screen.findByText(/amount is outside the supported range/i)).toBeInTheDocument();expect(mock.create).not.toHaveBeenCalled();
  });
});
