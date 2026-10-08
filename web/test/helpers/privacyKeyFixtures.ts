import type { Hex } from "viem";
import { derivePrivacyAccount } from "../../src/features/privacyKeys/keyDerivation";
import { rotationTypedData } from "../../src/features/privacyKeys/rotationTypedData";
import type {
  PrivacyKeyState,
  PublicKeyPair,
  RegistryScope,
  RotationIntent,
} from "../../src/features/privacyKeys/types";
import { bytesToHex } from "../../src/lib/crypto";
import { accountPubkeys } from "../../src/lib/notes";
import { testSigner } from "./requestFixtures";

export async function makePrivacyFixture() {
  const root = new Uint8Array(32).fill(7),
    signer = testSigner(1);
  const owner = signer.address.toLowerCase() as Hex,
    registry: RegistryScope = `31337:0x${"4".repeat(40)}`,
    username = "alice";
  const accounts = new Map(
    [0, 1].map((id) => [id, derivePrivacyAccount(root, id)]),
  );
  const keys: PublicKeyPair[] = [];
  for (const account of accounts.values()) {
    const pair = await accountPubkeys(account);
    keys.push({
      notePubkey: `0x${bytesToHex(pair.notePubkey)}`,
      viewPubkey: `0x${bytesToHex(pair.viewPubkey)}`,
    });
  }
  const evidence = {
    block: 10,
    blockHash: `0x${"1".repeat(64)}` as Hex,
    txHash: null,
  };
  const state: PrivacyKeyState = {
    version: 1,
    owner,
    registry,
    username,
    revision: 1,
    activeGeneration: 0,
    generations: [{ id: 0, ...keys[0], evidence }],
    pending: null,
  };
  const rotatedState: PrivacyKeyState = {
    ...state,
    revision: 2,
    activeGeneration: 1,
    generations: [
      ...state.generations,
      { id: 1, ...keys[1], evidence: { ...evidence, block: 20 } },
    ],
  };
  const approval: Omit<RotationIntent, "signature"> = {
    version: 1,
    id: "00000000-0000-4000-8000-000000000001",
    owner,
    registry,
    username,
    expectedRevision: 1,
    from: 0,
    to: 1,
    oldKeys: keys[0],
    newKeys: keys[1],
    deadline: "4102444800",
  };
  const signApproval = async (): Promise<RotationIntent> => ({
    ...approval,
    signature: await signer.walletClient.signTypedData({
      ...rotationTypedData(approval),
      account: signer.walletClient.account ?? signer.address,
    }),
  });
  return {
    root,
    signer,
    owner,
    registry,
    username,
    accounts,
    keys,
    state,
    rotatedState,
    approval,
    signApproval,
  };
}
