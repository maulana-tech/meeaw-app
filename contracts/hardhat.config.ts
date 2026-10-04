import "@nomicfoundation/hardhat-viem";
import type { HardhatUserConfig } from "hardhat/config";

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = deployerKey ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    monadTestnet: {
      url: process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts,
    },
    monad: {
      url: process.env.MONAD_RPC_URL || "https://rpc.monad.xyz",
      chainId: 143,
      accounts,
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
  },
  mocha: { timeout: 300_000 },
};

export default config;
