import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  poolScopeSchema,
  requestIdSchema,
} from "../../../features/requests/validation";
import {
  signedTransferSchema,
  transferSubmissionSchema,
} from "../../../features/transfers/validation";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { isSponsorshipError } from "../sponsorship/sponsorship.errors";
import {
  recoveryBatch,
  resumeTransfer,
  submitTransfer,
  transferEvidence,
  transferStatus,
} from "./transferOperations";
import {
  TransferConflictError,
  TransferNotFoundError,
  TransferRejectedError,
  TransferUnavailableError,
} from "./transfers.errors";
import {
  createTransfer,
  getTransfer,
  listTransfers,
  pendingTransfer,
} from "./transfers.service";
export function mapTransferError(e: unknown): never {
  if (isSponsorshipError(e))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: e.message,
      cause: e,
    });
  if (e instanceof TransferNotFoundError)
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  if (e instanceof TransferConflictError)
    throw new TRPCError({ code: "CONFLICT", message: e.message });
  if (e instanceof TransferRejectedError)
    throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
  if (e instanceof TransferUnavailableError)
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
  if (e instanceof TRPCError) throw e;
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "The transfer could not be processed. Try again.",
  });
}
export const transferIdInput = z.strictObject({ id: requestIdSchema });
export const transfersRouter = createTRPCRouter({
  recoveryBatch: protectedProcedure
    .input(
      z.strictObject({
        ids: z.array(requestIdSchema).min(1).max(20),
        cursor: z.string().max(64).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      recoveryBatch(ctx.privyUserId, input).catch(mapTransferError),
    ),
  create: protectedProcedure
    .input(z.strictObject({ record: signedTransferSchema }))
    .mutation(({ ctx, input }) =>
      createTransfer(ctx.privyUserId, input.record).catch(mapTransferError),
    ),
  get: protectedProcedure
    .input(transferIdInput)
    .query(({ ctx, input }) =>
      getTransfer(ctx.privyUserId, input.id).catch(mapTransferError),
    ),
  pending: protectedProcedure
    .input(z.strictObject({ pool: poolScopeSchema.optional() }).optional())
    .query(({ ctx, input }) =>
      pendingTransfer(ctx.privyUserId, input?.pool).catch(mapTransferError),
    ),
  status: protectedProcedure
    .input(transferIdInput)
    .query(({ ctx, input }) =>
      transferStatus(ctx.privyUserId, input.id).catch(mapTransferError),
    ),
  evidence: protectedProcedure
    .input(
      z.strictObject({
        id: requestIdSchema,
        afterStep: z.number().int().min(-1).max(4096).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      transferEvidence(ctx.privyUserId, input.id, input.afterStep).catch(
        mapTransferError,
      ),
    ),
  submit: protectedProcedure
    .input(z.strictObject({ submission: transferSubmissionSchema }))
    .mutation(({ ctx, input }) =>
      submitTransfer(ctx.privyUserId, input.submission).catch(mapTransferError),
    ),
  resume: protectedProcedure
    .input(transferIdInput)
    .mutation(({ ctx, input }) =>
      resumeTransfer(ctx.privyUserId, input.id).catch(mapTransferError),
    ),
  list: protectedProcedure
    .input(
      z.strictObject({
        direction: z.enum(["sent", "received", "all"]),
        cursor: z.string().max(200).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listTransfers(ctx.privyUserId, input).catch(mapTransferError),
    ),
});
