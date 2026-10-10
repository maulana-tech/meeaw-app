import "server-only";
import type { Hex } from "viem";
import type { Principal } from "../../../features/sponsorship/types";
import type { Context } from "../../context";
export function principalFromContext(
  ctx: Context,
  verifiedPayer?: Hex,
): Principal {
  if (
    ctx.privyUserId &&
    ctx.privyClaim?.user_id === ctx.privyUserId &&
    !ctx.authError
  )
    return { kind: "user", key: ctx.privyUserId };
  if (verifiedPayer)
    return { kind: "guest-wallet", key: verifiedPayer.toLowerCase() };
  return { kind: "anonymous", key: "shared" };
}
