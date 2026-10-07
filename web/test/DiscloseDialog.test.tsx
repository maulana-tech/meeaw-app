// @vitest-environment happy-dom
import {render,screen,waitFor,act} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {describe,it,expect,vi} from "vitest";
import type {PoolDescriptor} from "../src/lib/pools";
import type {LocalAccount,ScanResult} from "../src/lib/notes";
const mock=vi.hoisted(()=>({pool:null as PoolDescriptor|null,account:null as LocalAccount|null,scan:null as ScanResult|null,query:vi.fn(),pdf:vi.fn(),json:vi.fn(),unlocked:true}));
vi.mock("../src/lib/pools",async original=>({...await original<typeof import("../src/lib/pools")>(),resolvePool:()=>mock.pool,findPool:()=>mock.pool}));
vi.mock("../src/lib/notes",()=>({getAccount:()=>mock.account,scanMyNotes:async()=>mock.scan}));
vi.mock("../src/components/WalletProvider",()=>({useWallet:()=>({username:"alice",address:"0x01",accountUnlocked:mock.unlocked})}));
vi.mock("../src/features/receipts/receiptClient",()=>({loadReceiptSnapshot:mock.query}));
vi.mock("../src/lib/disclosurePdf",()=>({downloadDisclosurePdf:mock.pdf}));
vi.mock("../src/features/receipts/downloadReceiptJson",()=>({downloadReceiptJson:mock.json}));
import {makeReceiptFixture} from "./helpers/receiptFixtures";
import {DiscloseDialog} from "../src/components/dashboard/DiscloseDialog";
describe("receipt download dialog",()=>{
 it("does not download a prepared receipt after the account object changes",async()=>{vi.clearAllMocks();const f=await makeReceiptFixture();mock.pool=f.pool;mock.account=f.account;mock.scan=f.scan;mock.unlocked=true;mock.query.mockResolvedValue({status:"available",snapshot:f.snapshot});render(<DiscloseDialog open onClose={vi.fn()} leafIndex={0} pool={f.pool}/>);const download=await screen.findByRole("button",{name:/JSON/});mock.account={...f.account};await userEvent.setup().click(download);expect(mock.json).not.toHaveBeenCalled();});
 it("offers matching PDF and JSON after verification",async()=>{const f=await makeReceiptFixture();mock.pool=f.pool;mock.account=f.account;mock.scan=f.scan;mock.query.mockResolvedValue({status:"available",snapshot:f.snapshot});render(<DiscloseDialog open onClose={vi.fn()} leafIndex={0} pool={f.pool}/>);expect(await screen.findByRole("button",{name:/JSON/})).toBeEnabled();expect(screen.getByRole("button",{name:/PDF/})).toBeEnabled();});
 it("invalidates delayed preparation when locked",async()=>{const f=await makeReceiptFixture();mock.pool=f.pool;mock.account=f.account;mock.scan=f.scan;mock.unlocked=true;let resolve!:(value:unknown)=>void;mock.query.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=render(<DiscloseDialog open onClose={vi.fn()} leafIndex={0} pool={f.pool}/>);await waitFor(()=>expect(mock.query).toHaveBeenCalled());mock.account=null;mock.unlocked=false;view.rerender(<DiscloseDialog open onClose={vi.fn()} leafIndex={0} pool={f.pool}/>);await act(async()=>resolve({status:"available",snapshot:f.snapshot}));expect(screen.queryByRole("button",{name:/JSON/})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:/PDF/})).not.toBeInTheDocument();mock.unlocked=true;});
});
