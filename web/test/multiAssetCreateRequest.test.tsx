// @vitest-environment happy-dom
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {expect,it,vi} from "vitest";
import {assetPool} from "./helpers/multiAssetFixtures";
const mock=vi.hoisted(()=>({create:vi.fn(),pools:[] as ReturnType<typeof assetPool>[]}));
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
vi.mock("../src/lib/pools",()=>({activePools:()=>mock.pools}));
vi.mock("../src/components/dashboard/useSelectedPool",()=>({useSelectedPool:()=>mock.pools[0]}));
vi.mock("../src/components/WalletProvider",()=>({useWallet:()=>({address:"0x01",accountUnlocked:true})}));
vi.mock("../src/features/requests/hooks/useCreateRequest",()=>({useCreateRequest:()=>({create:mock.create,isCreating:false,clearError:vi.fn()})}));
import {CreateRequestDialog} from "../src/components/dashboard/CreateRequestDialog";
it("lets an unsupported selected asset switch to an eligible AUSD request",async()=>{
  mock.pools=[assetPool("USDC",{request:false}),assetPool("AUSD",{request:true})];mock.create.mockResolvedValue({id:"r"});
  const user=userEvent.setup();render(<CreateRequestDialog open onOpenChange={vi.fn()}/>);
  expect(screen.getByText(/not enabled for this pool/)).toBeInTheDocument();
  await user.click(screen.getByRole("combobox",{name:"Payment asset"}));await user.click(await screen.findByRole("option",{name:/AUSD/}));
  await user.type(screen.getByRole("textbox",{name:/Request from/}),"bob");await user.type(screen.getByRole("textbox",{name:/Amount · AUSD/}),"20");await user.click(screen.getByRole("button",{name:"Send request"}));
  await waitFor(()=>expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({pool:mock.pools[1],amount:"20"})));
});
