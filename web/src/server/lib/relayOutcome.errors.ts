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
