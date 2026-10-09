import { pathToFileURL } from "node:url";
import { MongoClient } from "mongodb";

const max = (1n << 256n) - 1n;
function units(value, decimals) {
  if (
    typeof value !== "string" ||
    value.trim().length > 100 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value.trim())
  )
    throw Error("Invalid sponsorship policy");
  const [whole, fraction = ""] = value.trim().split(".");
  if (fraction.length > decimals) throw Error("Invalid sponsorship policy");
  const parsed =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"));
  if (parsed <= 0n || parsed > max) throw Error("Invalid sponsorship policy");
  return parsed;
}
function count(value, fallback, ceiling) {
  if (value === undefined || value === "") return fallback;
  if (!/^[0-9]+$/.test(value.trim())) throw Error("Invalid sponsorship policy");
  const n = Number(value.trim());
  if (!Number.isSafeInteger(n) || n < 1 || n > ceiling)
    throw Error("Invalid sponsorship policy");
  return n;
}
function format(value) {
  const n = BigInt(value);
  return `${n / 10n ** 18n}.${(n % 10n ** 18n).toString().padStart(18, "0")}`;
}
function policy(env) {
  try {
    const global = units(env.RELAYER_DAILY_BUDGET_MON, 18),
      anonymous = units(env.RELAYER_ANONYMOUS_BUDGET_MON, 18),
      action = units(env.RELAYER_ACTION_BUDGET_MON, 18),
      floor = units(env.RELAYER_BALANCE_FLOOR_MON ?? "0.1", 18),
      fee = units(env.RELAYER_MAX_FEE_GWEI, 9);
    const user = count(env.RELAYER_USER_ACTIONS_PER_DAY, 20, 1_000_000),
      guest = count(env.RELAYER_GUEST_ACTIONS_PER_DAY, 20, 1_000_000),
      shared = count(env.RELAYER_ANONYMOUS_ACTIONS_PER_DAY, 100, 1_000_000),
      steps = count(env.RELAYER_MAX_ACTION_STEPS, 16, 16);
    if (anonymous > global || action > global)
      throw Error("Invalid sponsorship policy");
    return {
      global,
      anonymous,
      action,
      floor,
      fee,
      user,
      guest,
      shared,
      steps,
    };
  } catch {
    return null;
  }
}
export async function operatorBudgetSnapshot(db, chainId, env = process.env) {
  const active = { $objectToArray: { $ifNull: ["$actions", {}] } };
  const currentDay = {
    $dateToString: { format: "%Y-%m-%d", date: "$$NOW", timezone: "UTC" },
  };
  const doc = await db
    .collection("sponsorship_ledgers")
    .aggregate([
      { $match: { _id: `chain:${chainId}` } },
      {
        $project: {
          _id: 0,
          chainId: 1,
          bootstrapState: "$bootstrap.state",
          day: currentDay,
          used: { $cond: [{ $eq: ["$day", currentDay] }, "$usedWeiStr", "0"] },
          anonymousUsed: {
            $cond: [{ $eq: ["$day", currentDay] }, "$anonymousUsedWeiStr", "0"],
          },
          held: "$reservedWeiStr",
          anonymousHeld: "$anonymousReservedWeiStr",
          pendingActions: {
            $size: {
              $filter: {
                input: active,
                as: "a",
                cond: { $in: ["$$a.v.phase", ["active", "paused"]] },
              },
            },
          },
          unresolved: {
            $sum: {
              $map: {
                input: active,
                as: "a",
                in: {
                  $size: {
                    $filter: {
                      input: { $objectToArray: "$$a.v.children" },
                      as: "c",
                      cond: {
                        $in: ["$$c.v.phase", ["signing", "signed", "unknown"]],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    ])
    .next();
  const bounds = policy(env),
    used = BigInt(doc?.used ?? "0"),
    held = BigInt(doc?.held ?? "0");
  return {
    chainId,
    policyConfigured: Boolean(bounds),
    baseline: doc?.bootstrapState ?? "initializing",
    day: doc?.day ?? null,
    usedMon: format(used),
    heldMon: format(held),
    availableBudgetMon: bounds
      ? format(bounds.global > used + held ? bounds.global - used - held : 0n)
      : null,
    anonymousUsedMon: format(doc?.anonymousUsed ?? "0"),
    anonymousHeldMon: format(doc?.anonymousHeld ?? "0"),
    pendingActions: doc?.pendingActions ?? 0,
    unresolved: doc?.unresolved ?? 0,
    caps: bounds
      ? {
          dailyMon: format(bounds.global),
          anonymousMon: format(bounds.anonymous),
          actionMon: format(bounds.action),
          balanceFloorMon: format(bounds.floor),
          feeCeilingWei: bounds.fee.toString(),
          userActions: bounds.user,
          guestActions: bounds.guest,
          anonymousActions: bounds.shared,
          maxSteps: bounds.steps,
        }
      : null,
  };
}
async function main() {
  const chainId = Number(process.env.NEXT_PUBLIC_MONAD_CHAIN_ID ?? 143);
  if (![143, 10143, 31337].includes(chainId) || !process.env.MONGODB_URI)
    throw Error(
      "Configure the chain and database before reading sponsorship status.",
    );
  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  try {
    await client.connect();
    console.log(
      JSON.stringify(
        await operatorBudgetSnapshot(client.db(), chainId),
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      "Relayer budget status could not be read. Check configuration and database availability.",
    );
    process.exitCode = 1;
  });
}
