import "server-only";
import { createHash } from "node:crypto";
import type { ActionKind } from "../../../features/sponsorship/types";
import { RelayConflictError } from "../../lib/relayJournal";

function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && value.startsWith("0x"))
    return value.toLowerCase();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => [key, canonical(v)]),
    );
  return value;
}
const fields: Partial<Record<ActionKind, string[]>> = {
  withdraw: ["pool", "nullifier", "recipient", "amount"],
  deposit: [
    "pool",
    "payer",
    "commitment",
    "amount",
    "ephemeralPk",
    "ciphertext",
    "deadline",
    "signature",
    "permit",
  ],
  register: [
    "owner",
    "username",
    "notePubkey",
    "viewPubkey",
    "deadline",
    "signature",
  ],
  rotation: [
    "owner",
    "username",
    "notePubkey",
    "viewPubkey",
    "deadline",
    "signature",
  ],
  "legacy-transfer": ["pool", "nullifier", "recipientNote", "changeNote"],
  faucet: ["id", "pool", "recipient", "amount"],
};
export function ordinaryBusinessIdentity(
  kind: ActionKind,
  input: Record<string, unknown>,
) {
  const keys = fields[kind];
  if (!keys || keys.some((key) => input[key] === undefined))
    throw new RelayConflictError();
  const hash = createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          kind,
          ...Object.fromEntries(keys.map((key) => [key, input[key]])),
        }),
      ),
    )
    .digest("hex");
  return {
    actionId: `${kind}:${hash}${(kind === "withdraw" || kind === "legacy-transfer") && typeof input.id === "string" ? `:${input.id}` : ""}`,
    businessDigest: `0x${hash}` as `0x${string}`,
    childId: "one",
  };
}
