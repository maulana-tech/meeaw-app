import "server-only";
import type { UnavailableReason } from "../../../features/sponsorship/types";
export class SponsorshipError extends Error {
  constructor(readonly reason: UnavailableReason) {
    super("Gas sponsorship is temporarily unavailable.");
    this.name = "SponsorshipError";
  }
}
export function isSponsorshipError(error: unknown): error is SponsorshipError {
  return error instanceof SponsorshipError;
}
