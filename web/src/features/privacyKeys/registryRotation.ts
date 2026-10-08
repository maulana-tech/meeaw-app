import { encodeFunctionData, type Hex } from "viem";
import { maweeRegistryAbi } from "../../lib/abi";
import type { Signer } from "../../lib/chain";
import { registryTypedData } from "../../lib/typedData";
import type { RotationIntent, RotationOperation } from "./types";

export type RegistryAuthorization = NonNullable<
  RotationOperation["registryAuthorization"]
>;
export function registryAuthorizationTypedData(
  intent: RotationIntent,
  authorization: Pick<RegistryAuthorization, "nonce" | "deadline">,
) {
  const [chainId, registry] = intent.registry.split(":");
  return registryTypedData({
    rotate: true,
    chainId: Number(chainId),
    registry: registry as Hex,
    owner: intent.owner,
    username: intent.username,
    ...intent.newKeys,
    nonce: BigInt(authorization.nonce),
    deadline: BigInt(authorization.deadline),
  });
}
export function registryRotationCalldata(
  intent: RotationIntent,
  authorization: RegistryAuthorization,
): Hex {
  return encodeFunctionData({
    abi: maweeRegistryAbi,
    functionName: "setPubkeysFor",
    args: [
      intent.owner,
      intent.username,
      intent.newKeys.notePubkey,
      intent.newKeys.viewPubkey,
      BigInt(authorization.deadline),
      authorization.signature,
    ],
  });
}
export async function submitRegistryRotationWallet(
  signer: Signer,
  operation: RotationOperation,
  authorization: RegistryAuthorization,
  onSubmitted: (hash: Hex) => Promise<void>,
): Promise<Hex> {
  if (
    signer.address.toLowerCase() !== operation.intent.owner.toLowerCase() ||
    !operation.registryAuthorization ||
    operation.registryAuthorization.signature !== authorization.signature ||
    operation.registryAuthorization.nonce !== authorization.nonce ||
    operation.registryAuthorization.deadline !== authorization.deadline
  )
    throw new Error(
      "Registry rotation must be authorized for this wallet before submission",
    );
  const [chainId, registry] = operation.intent.registry.split(":");
  if ((await signer.walletClient.getChainId()) !== Number(chainId))
    throw new Error("Wallet is connected to a different registry chain");
  const hash = await signer.walletClient.sendTransaction({
    account: signer.walletClient.account ?? signer.address,
    chain: signer.walletClient.chain,
    to: registry as Hex,
    data: registryRotationCalldata(operation.intent, authorization),
  });
  await onSubmitted(hash);
  return hash;
}
