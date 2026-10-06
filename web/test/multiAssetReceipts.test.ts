import { describe, expect, it, vi } from "vitest";
import { assetPool } from "./helpers/multiAssetFixtures";
import { testAccount } from "./helpers/requestFixtures";
const mock = vi.hoisted(() => ({ pools: [] as ReturnType<typeof assetPool>[] }));
vi.mock("../src/lib/chain", () => ({ network: "eip155:31337" }));
vi.mock("../src/lib/pools", () => ({ activePool: () => mock.pools[0], resolvePool: (scope: string) => mock.pools.find(p => p.scope === scope), findPool: (scope: string) => mock.pools.find(p => p.scope === scope) }));
import { buildDisclosure } from "../src/lib/disclosure";
import { commitment, ownerPk } from "../src/lib/crypto";
import { csvActivity } from "../src/features/payments/activityRows";
import type { ActivityRow } from "../src/features/payments/activityTypes";
import { renderDisclosurePdf } from "../src/lib/disclosurePdf";
describe("scoped payment receipts", () => {
  it("keeps an AUSD receipt in its original pool while USDC is selected", async () => {
    mock.pools = [assetPool("USDC"),assetPool("AUSD")];
    const acct=testAccount(1),pool=mock.pools[1],note={scope:pool.scope,leafIndex:0,amount:20_000_000n,salt:1n,spent:false};
    const leaf=await commitment(note.amount,await ownerPk(acct.ownerSecret),note.salt);
    const bundle=await buildDisclosure({acct,scan:{scope:pool.scope,notes:[note],leaves:[leaf],claimable:note.amount},note});
    expect(bundle.pool).toBe(pool.address);expect(bundle.asset).toBe("AUSD");expect(bundle.amountLabel).toBe("20");
    const pdf=await renderDisclosurePdf(bundle);expect(pdf.output()).toContain("20 AUSD");
    const row={kind:"received",status:"confirmed",scope:pool.scope,amount:note.amount,at:"2026-10-06"} as ActivityRow;
    expect(csvActivity([row])).toContain('20,"AUSD"');
  });
});
