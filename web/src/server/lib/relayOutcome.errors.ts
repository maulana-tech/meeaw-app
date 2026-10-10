import "server-only";
import type { Hex } from "viem";
export class RelayRevertedError extends Error {
  constructor(readonly txHash: Hex) {
    super(
      "The transaction reverted. Refresh your balance before starting a new attempt.",
    );
    this.name = "RelayRevertedError";
  }
}
export class RelayNotSubmittedError extends Error {
  constructor(readonly original: unknown) {
    super("The relay request was rejected before submission.");
    this.name = "RelayNotSubmittedError";
  }
}
