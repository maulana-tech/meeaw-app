export class DepositIndexGapError extends Error {
  constructor(onChainCount: number, mirroredCount: number) {
    super(
      `deposit index gap detected: on-chain leaf_count=${onChainCount}, mirrored=${mirroredCount}`,
    );
    this.name = "DepositIndexGapError";
  }
}

/** The requested pool is not in this deployment's manifest. */
export class UnknownPoolError extends Error {
  constructor() {
    super("Unknown pool.");
    this.name = "UnknownPoolError";
  }
}
