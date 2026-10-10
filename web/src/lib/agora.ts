import type { PoolDescriptor } from "../features/requests/types";

export const AGORA_DEPLOYMENTS: Readonly<Record<number, `0x${string}`>> = {
  10143: "0xa9012a055bd4e0edff8ce09f960291c09d5322dc",
  143: "0x00000000efe302beaa2b3e6e1b18d08d69a9012a",
};
export const AGORA_DEPLOYMENT_DOCS =
  "https://docs.agora.finance/developer/contract-deployments";
export const AGORA_TESTNET_FAUCET =
  "0xd236c18d274e54faccc3dd9dda4b27965a73ee6c";

export function agoraAusdToken(chainId: number): `0x${string}` | undefined {
  return AGORA_DEPLOYMENTS[chainId];
}
export function isAgoraAusdPool(pool: PoolDescriptor): boolean {
  const token = agoraAusdToken(pool.chainId);
  return (
    !!token &&
    pool.asset === "AUSD" &&
    pool.tokenDecimals === 6 &&
    pool.token.toLowerCase() === token
  );
}
export function agoraFundingUrl(pool: PoolDescriptor): string | null {
  return pool.chainId === 10143 &&
    pool.role === "active" &&
    !pool.mintable &&
    isAgoraAusdPool(pool)
    ? AGORA_DEPLOYMENT_DOCS
    : null;
}
