import { rateLimit } from "../../lib/rateLimit";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import { receiptChainInput, receiptChainOutput } from "./receipts.schema";
import { getReceiptChainSnapshot } from "./receipts.service";
export const receiptsRouter = createTRPCRouter({
  chainSnapshot: publicProcedure
    .input(receiptChainInput)
    .output(receiptChainOutput)
    .query(({ ctx, input }) => {
      if (!rateLimit(`receipt-snapshot:${ctx.ip ?? "unknown"}`, 20, 60000).ok)
        return { status: "unavailable" as const, reason: "rate-limited" };
      return getReceiptChainSnapshot(input);
    }),
});
