// The stablecoins a Mawee pool can hold. Each pool holds exactly one of them
// (MaweePool.token is immutable), so supporting an asset means deploying a pool
// for it and listing that pool in the manifest with `asset` set.
//
// Mainnet addresses are Monad's canonical tokens (docs.monad.xyz, "Tokens and
// Bridges"), checked on-chain: 6 decimals and EIP-2612 permit, which the
// gasless deposit path needs. On testnet none of them exist, so pools there use
// mock tokens and the manifest address is trusted as configured.

export const ASSET_SYMBOLS = ["USDC", "AUSD", "USDT0", "MUSD"] as const;
export type AssetSymbol = (typeof ASSET_SYMBOLS)[number];

export type AssetInfo = {
  symbol: AssetSymbol;
  /** What the UI shows; USDT0 is Tether's USDT on Monad. */
  label: string;
  name: string;
  issuer: string;
  logo?: string;
  mainnetAddress: `0x${string}`;
};

export const ASSETS: Record<AssetSymbol, AssetInfo> = {
  USDC: {
    symbol: "USDC",
    label: "USDC",
    name: "USD Coin",
    issuer: "Circle",
    logo: "/stablecoins/usdc.svg",
    mainnetAddress: "0x754704bc059f8c67012fed69bc8a327a5aafb603",
  },
  AUSD: {
    symbol: "AUSD",
    label: "AUSD",
    name: "Agora USD",
    issuer: "Agora",
    mainnetAddress: "0x00000000efe302beaa2b3e6e1b18d08d69a9012a",
  },
  USDT0: {
    symbol: "USDT0",
    label: "USDT",
    name: "Tether USD",
    issuer: "Tether",
    mainnetAddress: "0xe7cd86e13ac4309349f30b3435a9d337750fc82d",
  },
  MUSD: {
    symbol: "MUSD",
    label: "mUSD",
    name: "MetaMask USD",
    issuer: "MetaMask",
    mainnetAddress: "0xaca92e438df0b2401ff60da7e4337b687a2435da",
  },
};

export const MONAD_MAINNET_CHAIN_ID = 143;
