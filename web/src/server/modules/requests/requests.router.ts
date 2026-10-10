import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { isSponsorshipError } from "../sponsorship/sponsorship.errors";
import {
  beginPayment,
  paymentStatus,
  submitConsolidation,
  submitPayment,
} from "./requestOperations";
import {
  RequestConflictError,
  RequestNotFoundError,
  RequestRateLimitedError,
  RequestRejectedError,
  RequestUnavailableError,
} from "./requests.errors";
import {
  beginPaymentInput,
  createRequestInput,
  listRequestsInput,
  paymentOperationOutput,
  paymentRequestOutput,
  pendingCountOutput,
  requestIdInput,
  requestPageOutput,
  requestTransitionInput,
  submitPaymentInput,
} from "./requests.schema";
import {
  cancelRequest,
  createRequest,
  declineRequest,
  getRequest,
  listReceived,
  listSent,
  pendingCount,
} from "./requests.service";

// Errors map to fixed messages; nothing from the record or its envelopes is
// echoed back or logged.
export function mapRequestError(e: unknown): never {
  if (isSponsorshipError(e))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: e.message,
      cause: e,
    });
  if (e instanceof RequestNotFoundError)
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  if (e instanceof RequestConflictError)
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  if (e instanceof RequestRejectedError)
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  if (e instanceof RequestRateLimitedError)
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: e.message });
  if (e instanceof RequestUnavailableError)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
  if (e instanceof TRPCError) throw e;
  console.error(
    "[requests] unexpected failure",
    e instanceof Error ? e.name : typeof e,
  );
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Something went wrong. Try again.",
  });
}

export const requestsRouter = createTRPCRouter({
  beginPayment: protectedProcedure
    .input(beginPaymentInput)
    .output(paymentOperationOutput)
    .mutation(({ ctx, input }) =>
      beginPayment(ctx.privyUserId, input).catch(mapRequestError),
    ),
  submitConsolidation: protectedProcedure
    .input(submitPaymentInput)
    .output(paymentOperationOutput)
    .mutation(({ ctx, input }) =>
      submitConsolidation(ctx.privyUserId, input).catch(mapRequestError),
    ),
  submitPayment: protectedProcedure
    .input(submitPaymentInput)
    .output(paymentOperationOutput)
    .mutation(({ ctx, input }) =>
      submitPayment(ctx.privyUserId, input).catch(mapRequestError),
    ),
  paymentStatus: protectedProcedure
    .input(requestIdInput)
    .output(paymentOperationOutput.nullable())
    .query(({ ctx, input }) =>
      paymentStatus(ctx.privyUserId, input).catch(mapRequestError),
    ),
  create: protectedProcedure
    .input(createRequestInput)
    .output(paymentRequestOutput)
    .mutation(({ ctx, input }) =>
      createRequest(ctx.privyUserId, input).catch(mapRequestError),
    ),
  listReceived: protectedProcedure
    .input(listRequestsInput)
    .output(requestPageOutput)
    .query(({ ctx, input }) =>
      listReceived(ctx.privyUserId, input).catch(mapRequestError),
    ),
  listSent: protectedProcedure
    .input(listRequestsInput)
    .output(requestPageOutput)
    .query(({ ctx, input }) =>
      listSent(ctx.privyUserId, input).catch(mapRequestError),
    ),
  pendingCount: protectedProcedure
    .output(pendingCountOutput)
    .query(({ ctx }) => pendingCount(ctx.privyUserId).catch(mapRequestError)),
  get: protectedProcedure
    .input(requestIdInput)
    .output(paymentRequestOutput)
    .query(({ ctx, input }) =>
      getRequest(ctx.privyUserId, input).catch(mapRequestError),
    ),
  decline: protectedProcedure
    .input(requestTransitionInput)
    .output(paymentRequestOutput)
    .mutation(({ ctx, input }) =>
      declineRequest(ctx.privyUserId, input).catch(mapRequestError),
    ),
  cancel: protectedProcedure
    .input(requestTransitionInput)
    .output(paymentRequestOutput)
    .mutation(({ ctx, input }) =>
      cancelRequest(ctx.privyUserId, input).catch(mapRequestError),
    ),
});
