export class RelayerUnavailableError extends Error {
  constructor() {
    super("Gasless transactions are not available right now.");
    this.name = "RelayerUnavailableError";
  }
}

export class RelayRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayRejectedError";
  }
}

export class RelayRateLimitedError extends Error {
  constructor(public retryAfterMs: number) {
    super("Too many requests. Please wait a moment and try again.");
    this.name = "RelayRateLimitedError";
  }
}
