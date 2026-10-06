import { createSignedTransfer } from "../../src/features/transfers/transferCrypto";
import type { AssetSymbol } from "../../src/lib/assets";
import type { PoolDescriptor } from "../../src/lib/pools";
import {
  testAccount,
  testParticipant,
  testPool,
  testSigner,
} from "./requestFixtures";
export function assetPool(
  asset: AssetSymbol,
  flags: { transfer?: boolean; request?: boolean } = {},
): PoolDescriptor {
  const index = ["USDC", "AUSD", "USDT0", "MUSD"].indexOf(asset) + 1,
    address = `0x${String(index).repeat(40)}` as `0x${string}`;
  return {
    ...testPool,
    address,
    scope: `31337:${address}`,
    token: `0x${String(index + 5).repeat(40)}`,
    asset,
    mintable: true,
    transferCapable: flags.transfer ?? true,
    requestCapable: flags.request ?? asset === "USDC",
  };
}
export async function makeAssetTransfer(asset: AssetSymbol) {
  const sender = testAccount(1),
    recipient = testAccount(2),
    signer = testSigner(1),
    pool = assetPool(asset);
  const signed = await createSignedTransfer({
    id: "00000000-0000-4000-8000-0000000000a1",
    pool,
    sender: await testParticipant("alice", 1),
    recipient: await testParticipant("bob", 2),
    account: sender,
    signer,
    amount: 20_000_000n,
    note: "Lunch",
    createdAt: new Date().toISOString(),
  });
  const record = {
    ...signed,
    status: "pending" as const,
    revision: 0,
    operationId: signed.id,
    updatedAt: signed.createdAt,
    receipt: null,
  };
  return { record, pool, sender, recipient, signer };
}
