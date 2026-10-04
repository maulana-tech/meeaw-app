// Request errors carry user-safe messages only: never plaintext, envelopes,
// signatures or other record contents.

export class RequestNotFoundError extends Error {
  constructor() {
    // Nonparticipants and missing records get the same answer.
    super("Request not found.");
    this.name = "RequestNotFoundError";
  }
}

export class RequestConflictError extends Error {
  constructor(message = "This request changed. Refresh and try again.") {
    super(message);
    this.name = "RequestConflictError";
  }
}

export class RequestRejectedError extends Error {
  constructor(message = "This request is invalid.") {
    super(message);
    this.name = "RequestRejectedError";
  }
}

export class RequestRateLimitedError extends Error {
  constructor() {
    super("Too many requests. Try again in a few minutes.");
    this.name = "RequestRateLimitedError";
  }
}

export class RequestUnavailableError extends Error {
  constructor(message = "Payment requests are not available right now.") {
    super(message);
    this.name = "RequestUnavailableError";
  }
}
