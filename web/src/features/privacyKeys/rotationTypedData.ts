import { getAddress } from "viem";
import type { RotationIntent } from "./types";

export function rotationTypedData(intent: Omit<RotationIntent, "signature">) {
  const [chain, address] = intent.registry.split(":");
  const chainId = Number(chain);
  if (!Number.isSafeInteger(chainId) || chainId < 1)
    throw new Error("Invalid privacy registry chain");
  return {
    domain: {
      name: "Mawee Privacy Key Rotation",
      version: "1",
      chainId,
      verifyingContract: getAddress(address),
    },
    primaryType: "PrivacyKeyRotation" as const,
    types: {
      PrivacyKeyRotation: [
        { name: "id", type: "string" },
        { name: "owner", type: "address" },
        { name: "username", type: "string" },
        { name: "expectedRevision", type: "uint64" },
        { name: "from", type: "uint32" },
        { name: "to", type: "uint32" },
        { name: "oldNotePubkey", type: "bytes32" },
        { name: "oldViewPubkey", type: "bytes32" },
        { name: "newNotePubkey", type: "bytes32" },
        { name: "newViewPubkey", type: "bytes32" },
        { name: "deadline", type: "uint256" },
      ],
    } as const,
    message: {
      id: intent.id,
      owner: getAddress(intent.owner),
      username: intent.username,
      expectedRevision: BigInt(intent.expectedRevision),
      from: intent.from,
      to: intent.to,
      oldNotePubkey: intent.oldKeys.notePubkey,
      oldViewPubkey: intent.oldKeys.viewPubkey,
      newNotePubkey: intent.newKeys.notePubkey,
      newViewPubkey: intent.newKeys.viewPubkey,
      deadline: BigInt(intent.deadline),
    },
  };
}
