import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../../trpc";
import { isSponsorshipError } from "../sponsorship/sponsorship.errors";
import {
  bootstrapPrivacyKeysInput,
  cashoutCaptureInput,
  cashoutFinishInput,
  markPrivacyRotationInput,
  privacyKeyStateSchema,
  privacyRotationIdInput,
  rotationIntentSchema,
  rotationOperationSchema,
  submitPrivacyRotationInput,
} from "./privacyKeys.schema";
import {
  admitCashout,
  bootstrapPrivacyKeyState,
  cancelCashout,
  dispatchCashout,
  finishCashout,
  getPrivacyKeyState,
  getVerifiedPrivacyKeyState,
  preparePrivacyRotation,
} from "./privacyKeys.service";
import {
  abortPrivacyRotation,
  markPrivacyRotationSubmitted,
  privacyRotationStatus,
  reconcilePrivacyRotation,
  submitPrivacyRotation,
} from "./rotationOperations";
export const privacyKeysRouter = createTRPCRouter({
  dispatchCashout: protectedProcedure
    .input(cashoutFinishInput)
    .mutation(({ ctx, input }) => dispatchCashout(ctx.privyUserId, input)),
  cancelCashout: protectedProcedure
    .input(cashoutFinishInput.pick({ operationId: true }))
    .mutation(({ ctx, input }) => cancelCashout(ctx.privyUserId, input)),
  admitCashout: protectedProcedure
    .input(cashoutCaptureInput)
    .mutation(({ ctx, input }) => admitCashout(ctx.privyUserId, input)),
  finishCashout: protectedProcedure
    .input(cashoutFinishInput)
    .mutation(({ ctx, input }) => finishCashout(ctx.privyUserId, input)),
  abort: protectedProcedure
    .input(privacyRotationIdInput)
    .output(rotationOperationSchema)
    .mutation(({ ctx, input }) =>
      abortPrivacyRotation(ctx.privyUserId, input.id),
    ),
  verifiedState: protectedProcedure
    .output(privacyKeyStateSchema.nullable())
    .query(async ({ ctx }) =>
      privacyKeyStateSchema
        .nullable()
        .parse(await getVerifiedPrivacyKeyState(ctx.privyUserId)),
    ),
  status: protectedProcedure
    .input(privacyRotationIdInput)
    .output(rotationOperationSchema)
    .query(({ ctx, input }) =>
      privacyRotationStatus(ctx.privyUserId, input.id),
    ),
  reconcile: protectedProcedure
    .input(privacyRotationIdInput)
    .output(rotationOperationSchema)
    .mutation(({ ctx, input }) =>
      reconcilePrivacyRotation(ctx.privyUserId, input.id),
    ),
  submit: protectedProcedure
    .input(submitPrivacyRotationInput)
    .output(rotationOperationSchema)
    .mutation(({ ctx, input }) =>
      submitPrivacyRotation(ctx.privyUserId, input).catch((error) => {
        if (isSponsorshipError(error))
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
            cause: error,
          });
        throw error;
      }),
    ),
  markSubmitted: protectedProcedure
    .input(markPrivacyRotationInput)
    .output(rotationOperationSchema)
    .mutation(({ ctx, input }) =>
      markPrivacyRotationSubmitted(ctx.privyUserId, input),
    ),
  state: protectedProcedure
    .output(privacyKeyStateSchema.nullable())
    .query(async ({ ctx }) =>
      privacyKeyStateSchema
        .nullable()
        .parse(await getPrivacyKeyState(ctx.privyUserId)),
    ),
  bootstrap: protectedProcedure
    .input(bootstrapPrivacyKeysInput)
    .output(privacyKeyStateSchema)
    .mutation(({ ctx, input }) =>
      bootstrapPrivacyKeyState(ctx.privyUserId, input).then((state) =>
        privacyKeyStateSchema.parse(state),
      ),
    ),
  prepare: protectedProcedure
    .input(rotationIntentSchema)
    .output(rotationOperationSchema)
    .mutation(({ ctx, input }) =>
      preparePrivacyRotation(ctx.privyUserId, input),
    ),
});
