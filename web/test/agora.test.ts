import { describe, expect, it } from "vitest";
import {
  AGORA_DEPLOYMENTS,
  agoraAusdToken,
  agoraFundingUrl,
  isAgoraAusdPool,
} from "../src/lib/agora";
import { assetPool } from "./helpers/multiAssetFixtures";

describe("official Agora AUSD identification", () => {
  it("pins official deployments and refuses other chains", () => {
    expect(agoraAusdToken(10143)).toBe(
      "0xa9012a055bd4e0edff8ce09f960291c09d5322dc",
    );
    expect(agoraAusdToken(143)).toBe(
      "0x00000000efe302beaa2b3e6e1b18d08d69a9012a",
    );
    expect(agoraAusdToken(31337)).toBeUndefined();
  });
  it("never identifies a token from its symbol alone", () => {
    const pool = { ...assetPool("AUSD"), chainId: 10143, mintable: false };
    expect(isAgoraAusdPool(pool)).toBe(false);
    expect(isAgoraAusdPool({ ...pool, token: AGORA_DEPLOYMENTS[10143] })).toBe(
      true,
    );
    expect(
      isAgoraAusdPool({
        ...pool,
        asset: "USDC",
        token: AGORA_DEPLOYMENTS[10143],
      }),
    ).toBe(false);
    expect(
      isAgoraAusdPool({
        ...pool,
        tokenDecimals: 18,
        token: AGORA_DEPLOYMENTS[10143],
      }),
    ).toBe(false);
  });
  it("offers faucet documentation only for an active official testnet pool", () => {
    const pool = {
      ...assetPool("AUSD"),
      chainId: 10143,
      token: AGORA_DEPLOYMENTS[10143],
      mintable: false,
    };
    expect(agoraFundingUrl(pool)).toBe(
      "https://docs.agora.finance/developer/contract-deployments",
    );
    expect(agoraFundingUrl({ ...pool, role: "legacy" })).toBeNull();
    expect(agoraFundingUrl({ ...pool, mintable: true })).toBeNull();
    expect(
      agoraFundingUrl({ ...pool, chainId: 143, token: AGORA_DEPLOYMENTS[143] }),
    ).toBeNull();
    expect(agoraFundingUrl(assetPool("AUSD"))).toBeNull();
  });
});
