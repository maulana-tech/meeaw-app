import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { findPool } from "../../../lib/pools";
import { RelayConflictError } from "../../lib/relayJournal";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { isSponsorshipError } from "./sponsorship.errors";
import { actionReference, withdrawBatchInput } from "./sponsorship.schema";
import {
  cancelSponsorship,
  sponsorshipStatus,
  withdrawBatches,
} from "./sponsorship.service";

async function mapped<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isSponsorshipError(error))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: error.message,
        cause: error,
      });
    if (error instanceof RelayConflictError)
      throw new TRPCError({ code: "CONFLICT", message: error.message });
    throw error;
  }
}
export const sponsorshipRouter = createTRPCRouter({
  availability: publicProcedure.query(({ ctx }) =>
    mapped(() => sponsorshipStatus(ctx)),
  ),
  myQuota: protectedProcedure.query(({ ctx }) =>
    mapped(() => sponsorshipStatus(ctx)),
  ),
  admitWithdrawBatch: protectedProcedure
    .input(withdrawBatchInput)
    .mutation(({ ctx, input }) =>
      mapped(async () => {
        if (!findPool(input.pool)) throw new RelayConflictError();
        return (await withdrawBatches()).admit(ctx, input);
      }),
    ),
  finishWithdrawBatch: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      mapped(async () => {
        await (await withdrawBatches()).finish(ctx, input.id);
      }),
    ),
  cancelUnsigned: protectedProcedure
    .input(actionReference)
    .mutation(({ ctx, input }) =>
      mapped(() => cancelSponsorship(ctx, input.actionId)),
    ),
});
