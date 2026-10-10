import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context";
import {
  RelayNotSubmittedError,
  RelayRevertedError,
} from "./lib/relayOutcome.errors";
import { isSponsorshipError } from "./modules/sponsorship/sponsorship.errors";

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const cause =
      error.cause instanceof RelayNotSubmittedError
        ? error.cause.original
        : error.cause;
    return {
      ...shape,
      data: {
        ...shape.data,
        relayNotSubmitted: error.cause instanceof RelayNotSubmittedError,
        sponsorshipReason: isSponsorshipError(cause) ? cause.reason : null,
        sponsorshipReleased: isSponsorshipError(cause) && cause.released,
        relayOutcome:
          error.cause instanceof RelayRevertedError
            ? { state: "reverted" as const, txHash: error.cause.txHash }
            : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.privyUserId || !ctx.privyClaim) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ctx.authError
        ? "Your Privy session is invalid or expired."
        : "Sign in with Privy to continue.",
    });
  }
  return next({
    ctx: {
      ...ctx,
      privyUserId: ctx.privyUserId,
      privyClaim: ctx.privyClaim,
    },
  });
});
