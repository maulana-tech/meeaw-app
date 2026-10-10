import { expect } from "chai";
import { agoraConfiguration } from "../scripts/agora-readiness";
const address = `0x${"1".repeat(40)}`;
const pool = {
  chainId: 10143,
  address,
  deployBlock: 1,
  token: "0xa9012a055bd4e0edff8ce09f960291c09d5322dc",
  tokenDecimals: 6,
  depth: 20,
  role: "active",
  requestCapable: true,
  transferCapable: true,
  mintable: false,
  asset: "AUSD",
};
const legacy = {
  address: undefined,
  deployBlock: 0,
  token: undefined,
  tokenDecimals: 6,
  mintable: false,
};
const block = (chain: number, addr: string) =>
  `  - id: ${chain}\n    start_block: 0\n    contracts:\n      - name: Pool\n        address:\n          - "${addr}"\n`;
const configure = (
  pools: unknown[],
  indexer = `chains:\n${block(10143, address)}`,
) =>
  agoraConfiguration({
    chainId: 10143,
    manifest: JSON.stringify(pools),
    legacy,
    indexer,
  });
describe("Agora readiness uses application configuration rules", () => {
  it("rejects a cross-chain descriptor even if its address appears in the indexer", () => {
    expect(() => configure([{ ...pool, chainId: 143 }])).to.throw(
      "another chain",
    );
  });
  it("rejects duplicate active assets and legacy payment capabilities", () => {
    expect(() =>
      configure([pool, { ...pool, address: `0x${"2".repeat(40)}` }]),
    ).to.throw("two active");
    expect(() =>
      configure([
        { ...pool, role: "legacy" },
        { ...pool, address: `0x${"2".repeat(40)}` },
      ]),
    ).to.throw("withdrawal-only");
  });
  it("compares only the selected indexer chain", () => {
    const other = `0x${"2".repeat(40)}`;
    const result = configure(
      [pool],
      `chains:\n${block(143, other)}${block(10143, address)}`,
    );
    expect(result.missingDescriptors).to.deep.equal([]);
    expect(result.notIndexed).to.deep.equal([]);
    const missing = configure(
      [pool],
      `chains:\n${block(10143, other)}${block(143, address)}`,
    );
    expect(missing.missingDescriptors).to.deep.equal([other]);
    expect(missing.notIndexed).to.deep.equal([address]);
  });
});
