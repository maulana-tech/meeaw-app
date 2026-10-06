export class TransferNotFoundError extends Error {
  constructor() {
    super("Not found");
    this.name = "TransferNotFoundError";
  }
}
export class TransferConflictError extends Error {
  constructor(
    message = "This transfer is already in progress. Reopen it to continue.",
  ) {
    super(message);
    this.name = "TransferConflictError";
  }
}
export class TransferRejectedError extends Error {
  constructor(message = "The transfer details are invalid.") {
    super(message);
    this.name = "TransferRejectedError";
  }
}
export class TransferUnavailableError extends Error {
  constructor(message = "Private sending is temporarily unavailable.") {
    super(message);
    this.name = "TransferUnavailableError";
  }
}
