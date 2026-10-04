// Deploys Poseidon, the three Groth16 verifiers, MaweeRegistry and MaweePool,
// then writes the resulting addresses into web/.env.local.
//
//   DEPLOYER_PRIVATE_KEY=0x… pnpm --filter contracts deploy:testnet
//
// USDC_ADDRESS selects the pool asset. When it is unset on testnet, a
// MockUSDC (anyone can mint) is deployed so the demo can be funded freely.
import fs from "node:fs";
import path from "node:path";
import hre from "hardhat";

const ENV_FILE = path.join(__dirname, "../../web/.env.local");

function upsertEnv(file: string, values: Record<string, string>) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n") : [];
  for (const [key, value] of Object.entries(values)) {
    const i = lines.findIndex((l) => l.startsWith(`${key}=`));
    if (i >= 0) lines[i] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(file, `${lines.filter((l, i) => l || i < lines.length - 1).join("\n")}\n`);
}

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  if (!deployer) throw new Error("Set DEPLOYER_PRIVATE_KEY to deploy.");
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const admin = (process.env.POOL_ADMIN as `0x${string}` | undefined) ?? deployer.account.address;
  console.log(`network=${hre.network.name} chainId=${chainId} deployer=${deployer.account.address}`);

  let usdc = process.env.USDC_ADDRESS as `0x${string}` | undefined;
  let usdcDecimals = process.env.USDC_DECIMALS ?? "6";
  let usdcMintable = "false";
  if (!usdc) {
    if (chainId === 143) throw new Error("USDC_ADDRESS is required on mainnet.");
    const mock = await hre.viem.deployContract("MockUSDC");
    usdc = mock.address;
    usdcDecimals = "6";
    usdcMintable = "true";
    console.log(`MockUSDC        ${usdc}`);
  }

  const poseidon = await hre.viem.deployContract("poseidon-solidity/PoseidonT3.sol:PoseidonT3");
  const depositVerifier = await hre.viem.deployContract("DepositVerifier");
  const withdrawVerifier = await hre.viem.deployContract("WithdrawVerifier");
  const transferVerifier = await hre.viem.deployContract("TransferVerifier");
  const registry = await hre.viem.deployContract("MaweeRegistry");
  const pool = await hre.viem.deployContract(
    "MaweePool",
    [admin, usdc, depositVerifier.address, withdrawVerifier.address, transferVerifier.address],
    { libraries: { "poseidon-solidity/PoseidonT3.sol:PoseidonT3": poseidon.address } },
  );
  const deployBlock = await publicClient.getBlockNumber();

  console.log(`PoseidonT3      ${poseidon.address}`);
  console.log(`MaweeRegistry   ${registry.address}`);
  console.log(`MaweePool       ${pool.address} (admin ${admin})`);

  upsertEnv(ENV_FILE, {
    NEXT_PUBLIC_MONAD_CHAIN_ID: String(chainId),
    NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS: registry.address,
    NEXT_PUBLIC_MAWEE_POOL_ADDRESS: pool.address,
    NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK: deployBlock.toString(),
    NEXT_PUBLIC_USDC_ADDRESS: usdc,
    NEXT_PUBLIC_USDC_DECIMALS: usdcDecimals,
    NEXT_PUBLIC_USDC_MINTABLE: usdcMintable,
  });
  console.log(`wrote ${path.relative(process.cwd(), ENV_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
