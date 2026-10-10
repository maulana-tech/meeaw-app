import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";
import { hashStruct, parseAbi, isAddress } from "viem";
import { agoraAusdToken, AGORA_TESTNET_FAUCET } from "../../web/src/lib/agora";
import { env } from "../../web/src/env";
import { agoraConfiguration } from "./agora-readiness";

async function main() {
  const checks: Array<{ name: string; ok: boolean; [key: string]: unknown }> =
    [];
  const check = (
    name: string,
    ok: boolean,
    details: Record<string, unknown> = {},
  ) => checks.push({ ...details, name, ok });
  const token = agoraAusdToken(10143)!;
  const client = await hre.viem.getPublicClient();
  const abi = parseAbi([
    "function symbol() view returns(string)",
    "function decimals() view returns(uint8)",
    "function nonces(address) view returns(uint256)",
    "function DOMAIN_SEPARATOR() view returns(bytes32)",
    "function eip712Domain() view returns(bytes1,string,string,uint256,address,bytes32,uint256[])",
  ]);
  try {
    const chainId = await client.getChainId();
    check(
      "Monad testnet",
      chainId === 10143 && env.NEXT_PUBLIC_MONAD_CHAIN_ID === 10143,
      { chainId },
    );
    if (chainId !== 10143 || env.NEXT_PUBLIC_MONAD_CHAIN_ID !== 10143)
      throw new Error("WrongNetwork");
    const code = await client.getCode({ address: token });
    check("Official token contract", !!code && code !== "0x", { token });
    const [symbol, decimals, domain, separator, nonce, faucetCode] =
      await Promise.all([
        client.readContract({ address: token, abi, functionName: "symbol" }),
        client.readContract({ address: token, abi, functionName: "decimals" }),
        client.readContract({
          address: token,
          abi,
          functionName: "eip712Domain",
        }),
        client.readContract({
          address: token,
          abi,
          functionName: "DOMAIN_SEPARATOR",
        }),
        client.readContract({
          address: token,
          abi,
          functionName: "nonces",
          args: ["0x0000000000000000000000000000000000000000"],
        }),
        client.getCode({ address: AGORA_TESTNET_FAUCET }),
      ]);
    check("AUSD token precision", symbol === "AUSD" && decimals === 6, {
      symbol,
      decimals,
    });
    const [
      fields,
      name,
      version,
      domainChain,
      verifyingContract,
      salt,
      extensions,
    ] = domain;
    const expected = hashStruct({
      data: { name, version, chainId: domainChain, verifyingContract },
      primaryType: "EIP712Domain",
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" },
        ],
      },
    });
    check(
      "Permit domain and nonce",
      fields === "0x0f" &&
        domainChain === 10143n &&
        verifyingContract.toLowerCase() === token &&
        extensions.length === 0 &&
        salt === `0x${"0".repeat(64)}` &&
        expected.toLowerCase() === separator.toLowerCase() &&
        nonce >= 0n,
      { domainName: name, version },
    );
    check(
      "Published Agora faucet contract",
      !!faucetCode && faucetCode !== "0x",
      { address: AGORA_TESTNET_FAUCET },
    );
    const coverage = agoraConfiguration({
      chainId,
      manifest: env.NEXT_PUBLIC_MAWEE_POOLS,
      legacy: {
        address: env.NEXT_PUBLIC_MAWEE_POOL_ADDRESS,
        deployBlock: env.NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK,
        token: env.NEXT_PUBLIC_USDC_ADDRESS,
        tokenDecimals: env.NEXT_PUBLIC_USDC_DECIMALS,
        mintable: env.NEXT_PUBLIC_USDC_MINTABLE,
      },
      indexer: fs.readFileSync(
        path.resolve(__dirname, "../../indexer/config.yaml"),
        "utf8",
      ),
    });
    check(
      "Manifest and indexer coverage",
      coverage.missingDescriptors.length === 0 &&
        coverage.notIndexed.length === 0,
      {
        missingDescriptors: coverage.missingDescriptors,
        notIndexed: coverage.notIndexed,
      },
    );
    const active = coverage.pools.find(
      (pool) => pool.asset === "AUSD" && pool.role === "active",
    );
    check(
      "Official AUSD active pool",
      !!active &&
        active.token.toLowerCase() === token &&
        active.tokenDecimals === 6 &&
        active.mintable === false,
      { pool: active?.address ?? null },
    );
    if (active?.token.toLowerCase() === token) {
      const poolAbi = parseAbi([
        "function token() view returns(address)",
        "function mergeVerifier() view returns(address)",
      ]);
      const [heldToken, verifier] = await Promise.all([
        client.readContract({
          address: active.address,
          abi: poolAbi,
          functionName: "token",
        }),
        client.readContract({
          address: active.address,
          abi: poolAbi,
          functionName: "mergeVerifier",
        }),
      ]);
      const verifierCode = await client.getCode({ address: verifier });
      check(
        "Official pool on-chain binding",
        heldToken.toLowerCase() === token &&
          !!verifierCode &&
          verifierCode !== "0x",
      );
    }
    const deployer = process.env.MAWEE_PREFLIGHT_DEPLOYER_ADDRESS;
    check("Explicit deployer configured", !!deployer && isAddress(deployer));
    if (deployer && isAddress(deployer)) {
      const [balance, fees] = await Promise.all([
        client.getBalance({ address: deployer }),
        client.estimateFeesPerGas(),
      ]);
      check("Deployer has testnet MON", balance > 0n, {
        address: deployer,
        balanceWei: balance.toString(),
      });
      const reserve = 30_000_000n * fees.maxFeePerGas;
      check("Deployment fee reserve", balance >= reserve, {
        reserveWei: reserve.toString(),
      });
    }
  } catch (error) {
    check("Preflight completed", false, {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
  }
  const readyToDeploy = checks.every(
    (item) => item.name === "Official AUSD active pool" || item.ok,
  );
  const configurationReady = checks.every(
    (item) =>
      [
        "Explicit deployer configured",
        "Deployer has testnet MON",
        "Deployment fee reserve",
      ].includes(item.name) || item.ok,
  );
  console.log(
    JSON.stringify(
      { readOnly: true, readyToDeploy, configurationReady, checks },
      null,
      2,
    ),
  );
  if (!readyToDeploy && !configurationReady) process.exitCode = 1;
}
void main().catch(() => {
  console.error("Agora preflight could not run.");
  process.exitCode = 1;
});
