import "server-only";
import { keccak256, toHex } from "viem";
import type { PolicyState } from "../../../features/sponsorship/types";

const MAX_UINT256 = (1n << 256n) - 1n;
function units(value: unknown, decimals: number): bigint {
  if (typeof value !== "string") throw new Error("Missing monetary bound");
  const text = value.trim();
  if (text.length > 100 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text))
    throw new Error("Invalid monetary bound");
  const [integer, fraction = ""] = text.split(".");
  if (fraction.length > decimals) throw new Error("Invalid precision");
  const amount =
    BigInt(integer) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  if (amount <= 0n || amount > MAX_UINT256)
    throw new Error("Invalid monetary bound");
  return amount;
}
function count(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string" || !/^[0-9]+$/.test(value.trim()))
    throw new Error("Invalid count");
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max)
    throw new Error("Invalid count");
  return parsed;
}
export function loadSponsorPolicy(env: Record<string, unknown>): PolicyState {
  try {
    const fields = {
      userLimit: count(env.RELAYER_USER_ACTIONS_PER_DAY, 20, 1_000_000),
      guestWalletLimit: count(env.RELAYER_GUEST_ACTIONS_PER_DAY, 20, 1_000_000),
      anonymousLimit: count(
        env.RELAYER_ANONYMOUS_ACTIONS_PER_DAY,
        100,
        1_000_000,
      ),
      globalWei: units(env.RELAYER_DAILY_BUDGET_MON, 18),
      anonymousWei: units(env.RELAYER_ANONYMOUS_BUDGET_MON, 18),
      actionWei: units(env.RELAYER_ACTION_BUDGET_MON, 18),
      balanceFloorWei: units(env.RELAYER_BALANCE_FLOOR_MON ?? "0.1", 18),
      feeCeilingWei: units(env.RELAYER_MAX_FEE_GWEI, 9),
      maxChildren: count(env.RELAYER_MAX_ACTION_STEPS, 16, 16),
    };
    if (
      fields.anonymousWei > fields.globalWei ||
      fields.actionWei > fields.globalWei
    )
      throw new Error("Invalid sub-ceiling");
    const revision = keccak256(
      toHex(
        JSON.stringify(fields, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      ),
    );
    return { ready: true, policy: { ...fields, revision } };
  } catch {
    return { ready: false, reason: "configuration" };
  }
}
