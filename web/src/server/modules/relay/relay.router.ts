import { TRPCError } from "@trpc/server";
import { usdcMintable } from "../../../lib/chain";
import { rateLimit } from "../../lib/rateLimit";
import { relayerConfigured } from "../../lib/relayer";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import {
  RelayerUnavailableError,
  RelayRateLimitedError,
  RelayRejectedError,
} from "./relay.errors";
import {
  depositInput,
  depositOutput,
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

// Every call is simulated before it is sent (see relayWrite), so a request
// that would revert never costs gas. Rate limits bound the remaining cost of
// valid-but-spammy traffic.
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
        return await relayRegister(ctx.privyUserId, input);
      } catch (error) {
        mapError(error);
      }
    }),

  deposit: publicProcedure
    .input(depositInput)
    .output(depositOutput)
    .mutation(async ({ ctx, input }) => {
      try {
        limit(`relay:deposit:${ctx.ip ?? "unknown"}`, 20, 10 * MINUTE);
        return await relayDeposit(input);
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
        return await relayWithdraw(input);
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
        return await relayTransfer(input);
      } catch (error) {
        mapError(error);
      }
    }),

  mintTestUsdc: protectedProcedure
    .output(txOutput)
    .mutation(async ({ ctx }) => {
      try {
        limit(`relay:mint:${ctx.privyUserId}`, 3, 60 * MINUTE);
        return await relayMintTestUsdc(ctx.privyUserId);
      } catch (error) {
        mapError(error);
      }
    }),
});
