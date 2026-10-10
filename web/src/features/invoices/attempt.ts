import {
  canonicalRelayRevert,
  unsignedSponsorshipReleased,
} from "../sponsorship/pendingAction";

export function invoiceRetrySafe(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "relayNotSubmitted" in error.data &&
    error.data.relayNotSubmitted === true
  )
    return true;
  if (canonicalRelayRevert(error) || unsignedSponsorshipReleased(error))
    return true;
  let cause = error;
  for (let depth = 0; depth < 6; depth++) {
    if (!cause || typeof cause !== "object") return false;
    if ("code" in cause && cause.code === 4001) return true;
    if (
      "code" in cause &&
      cause.code === "MAWEE_CONFIRMED_REVERT" &&
      "txHash" in cause &&
      typeof cause.txHash === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(cause.txHash)
    )
      return true;
    cause = "cause" in cause ? cause.cause : null;
  }
  return false;
}
