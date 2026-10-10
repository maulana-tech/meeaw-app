import { expect } from "chai";
import type { Hex } from "viem";

const { deploymentAsset, deploymentToken } =
  require("../scripts/deployment-config") as {
    deploymentAsset: (asset?: string, profile?: string) => string;
    deploymentToken: (input: {
      asset: string;
      chainId: number;
      profile?: string;
      token?: string;
    }) => Hex | undefined;
  };
const token = "0xa9012a055bd4e0edff8ce09f960291c09d5322dc";
describe("official Agora deployment profile", () => {
  it("defaults the explicit profile to AUSD without changing ordinary deployments", () => {
    expect(deploymentAsset(undefined, "agora-ausd")).to.equal("AUSD");
    expect(deploymentAsset()).to.equal("USDC");
    expect(deploymentAsset("MUSD")).to.equal("MUSD");
    expect(() => deploymentAsset("USDC", "agora-ausd")).to.throw("AUSD");
    expect(() => deploymentAsset(undefined, "unknown")).to.throw(
      "TOKEN_PROFILE",
    );
  });
  it("pins the official token so an unset address cannot deploy a mock", () => {
    expect(
      deploymentToken({ asset: "AUSD", chainId: 10143, profile: "agora-ausd" }),
    ).to.equal(token);
    expect(
      deploymentToken({ asset: "AUSD", chainId: 143, profile: "agora-ausd" }),
    ).to.equal("0x00000000efe302beaa2b3e6e1b18d08d69a9012a");
    expect(() =>
      deploymentToken({ asset: "AUSD", chainId: 31337, profile: "agora-ausd" }),
    ).to.throw("chain");
    expect(() =>
      deploymentToken({
        asset: "AUSD",
        chainId: 10143,
        profile: "agora-ausd",
        token: `0x${"1".repeat(40)}`,
      }),
    ).to.throw("canonical");
    expect(deploymentToken({ asset: "AUSD", chainId: 10143 })).to.equal(
      undefined,
    );
  });
});
