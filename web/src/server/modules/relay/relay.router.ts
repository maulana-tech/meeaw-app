import { TRPCError } from "@trpc/server";
import { usdcMintable } from "../../../lib/chain";
import { rateLimit } from "../../lib/rateLimit";
import { relayerConfigured } from "../../lib/relayer";
import {
  RelayNotSubmittedError,
  RelayRevertedError,
} from "../../lib/relayOutcome.errors";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import { isSponsorshipError } from "../sponsorship/sponsorship.errors";
import {
  RelayerUnavailableError,
  RelayRateLimitedError,
  RelayRejectedError,
} from "./relay.errors";
import {
  depositInput,
  depositOutput,
  mintTestUsdcInput,
  registerInput,
  statusOutput,
  transferInput,
  transferOutput,
  txOutput,
  withdrawInput,
} from "./relay.schema";
import {
  relayDeposit,
  relayMintTestUsdc,
  relayRegister,
  relayTransfer,
  relayWithdraw,
} from "./relay.service";

const MINUTE = 60_000;

function limit(key: string, max: number, windowMs: number): void {
  const result = rateLimit(key, max, windowMs);
  if (!result.ok) throw new RelayRateLimitedError(result.retryAfterMs);
}

function mapError(error: unknown): never {
  if (error instanceof RelayNotSubmittedError) {
    const original = error.original;
    const code =
      original instanceof RelayRateLimitedError
        ? "TOO_MANY_REQUESTS"
        : original instanceof RelayRejectedError
          ? "BAD_REQUEST"
          : isSponsorshipError(original) ||
              original instanceof RelayerUnavailableError
            ? "PRECONDITION_FAILED"
            : "INTERNAL_SERVER_ERROR";
    throw new TRPCError({
      code,
      message:
        original instanceof RelayRateLimitedError ||
        original instanceof RelayRejectedError ||
        original instanceof RelayerUnavailableError ||
        isSponsorshipError(original)
          ? original.message
          : "The transaction could not be submitted. Try again.",
      cause: error,
    });
  }
  if (error instanceof RelayRevertedError)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
      cause: error,
    });
  if (isSponsorshipError(error))
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
      cause: error,
    });
  if (error instanceof RelayRateLimitedError) {
    throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
  }
  if (error instanceof RelayerUnavailableError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
    });
  }
  if (error instanceof RelayRejectedError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  throw error;
}

// New unsigned ordinary calls are simulated before admission. Canonical mined
// reverts still consume native budget; retries recover the original bytes.
export const relayRouter = createTRPCRouter({
  status: publicProcedure.output(statusOutput).query(() => ({
    enabled: relayerConfigured(),
    testUsdcMintable: relayerConfigured() && usdcMintable,
  })),

  register: protectedProcedure
    .input(registerInput)
    .output(txOutput)
    .mutation(async ({ ctx, input }) => {
      try {
        limit(`relay:register:${ctx.privyUserId}`, 5, 10 * MINUTE);
        return await relayRegister(ctx.privyUserId, input, ctx);
      } catch (error) {
        mapError(error);
      }
    }),

  deposit: publicProcedure
    .input(depositInput)
    .output(depositOutput)
    .mutation(async ({ ctx, input }) => {
      try {
        try {
          limit(`relay:deposit:${ctx.ip ?? "unknown"}`, 20, 10 * MINUTE);
        } catch (error) {
          throw new RelayNotSubmittedError(error);
        }
        return await relayDeposit(input, ctx);
      } catch (error) {
        mapError(error);
      }
    }),

  withdraw: publicProcedure
    .input(withdrawInput)
    .output(txOutput)
    .mutation(async ({ ctx, input }) => {
      try {
        limit(`relay:withdraw:${ctx.ip ?? "unknown"}`, 30, 10 * MINUTE);
        return await relayWithdraw(input, ctx);
      } catch (error) {
        mapError(error);
      }
    }),

  transfer: publicProcedure
    .input(transferInput)
    .output(transferOutput)
    .mutation(async ({ ctx, input }) => {
      try {
        limit(`relay:transfer:${ctx.ip ?? "unknown"}`, 20, 10 * MINUTE);
        return await relayTransfer(input, ctx);
      } catch (error) {
        mapError(error);
      }
    }),

  mintTestUsdc: protectedProcedure
    .input(mintTestUsdcInput)
    .output(txOutput)
    .mutation(async ({ ctx, input }) => {
      try {
        limit(`relay:mint:${ctx.privyUserId}`, 3, 60 * MINUTE);
        return await relayMintTestUsdc(
          ctx.privyUserId,
          input.pool,
          input.id,
          ctx,
        );
      } catch (error) {
        mapError(error);
      }
    }),
});
