import { TRPCError } from "@trpc/server";
import type { Hex } from "viem";
import { z } from "zod";
import {
  invoiceHash,
  invoiceId,
  invoiceInput,
  invoiceToken,
} from "../../../features/invoices/input";
import { rateLimit } from "../../lib/rateLimit";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "../../trpc";
import {
  checkInvoicePayment,
  confirmInvoicePayment,
  createInvoice,
  getInvoice,
  getPublicInvoice,
  listInvoices,
  voidInvoice,
} from "./invoices.service";

function mapError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  console.error(
    "[invoices] operation failed",
    error instanceof Error ? error.name : typeof error,
  );
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Invoice could not be processed. Try again.",
  });
}
function publicLimit(ip: string | null, kind: string) {
  if (
    !rateLimit(
      `invoices:${kind}:${ip ?? "unknown"}`,
      kind === "confirm" ? 30 : 120,
      60_000,
    ).ok
  )
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Check this invoice again shortly.",
    });
}
export const invoicesRouter = createTRPCRouter({
  checkPayment: publicProcedure
    .input(
      z
        .object({ token: invoiceToken, txHash: invoiceHash.optional() })
        .strict(),
    )
    .mutation(({ ctx, input }) => {
      publicLimit(ctx.ip, "confirm");
      return checkInvoicePayment(
        input.token,
        input.txHash as Hex | undefined,
      ).catch(mapError);
    }),
  create: protectedProcedure
    .input(invoiceInput)
    .mutation(({ ctx, input }) =>
      createInvoice(ctx.privyUserId, input).catch(mapError),
    ),
  list: protectedProcedure
    .input(z.object({ cursor: invoiceId.optional() }).strict().default({}))
    .query(({ ctx, input }) =>
      listInvoices(ctx.privyUserId, input.cursor).catch(mapError),
    ),
  get: protectedProcedure
    .input(z.object({ id: invoiceId }).strict())
    .query(({ ctx, input }) =>
      getInvoice(ctx.privyUserId, input.id).catch(mapError),
    ),
  void: protectedProcedure
    .input(z.object({ id: invoiceId }).strict())
    .mutation(({ ctx, input }) =>
      voidInvoice(ctx.privyUserId, input.id).catch(mapError),
    ),
  publicGet: publicProcedure
    .input(z.object({ token: invoiceToken }).strict())
    .query(({ ctx, input }) => {
      publicLimit(ctx.ip, "read");
      return getPublicInvoice(input.token).catch(mapError);
    }),
  confirmPayment: publicProcedure
    .input(z.object({ token: invoiceToken, txHash: invoiceHash }).strict())
    .mutation(({ ctx, input }) => {
      publicLimit(ctx.ip, "confirm");
      return confirmInvoicePayment(input.token, input.txHash as Hex).catch(
        mapError,
      );
    }),
});
