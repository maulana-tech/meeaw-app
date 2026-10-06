import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { poolScopeSchema } from "../../../features/requests/validation";
import { publicPoolActivity } from "./activityEvidence";
import { createTRPCRouter, publicProcedure } from "../../trpc";
import { DepositIndexGapError, UnknownPoolError } from "./deposits.errors";
import {
  depositOutput,
  listDepositsInput,
  poolSnapshotInput,
  poolSnapshotOutput,
  poolStatsInput,
  poolStatsOutput,
} from "./deposits.schema";
import {
  getPoolSnapshot,
  getPoolStats,
  listDeposits,
} from "./deposits.service";

function mapError(e: unknown): never {
  if (e instanceof DepositIndexGapError) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message });
  }
  if (e instanceof UnknownPoolError) {
    throw new TRPCError({ code: "NOT_FOUND", message: e.message });
  }
  throw e;
}

export const depositsRouter = createTRPCRouter({
  activity:publicProcedure.input(z.strictObject({pool:poolScopeSchema,cursor:z.string().max(200).optional()})).query(({input})=>publicPoolActivity(input).catch(mapError)),
  snapshot: publicProcedure
    .input(poolSnapshotInput)
    .output(poolSnapshotOutput)
    .query(({ input }) =>
      getPoolSnapshot(
        input?.afterLeafIndex ?? -1,
        input?.spentAfterBlock ?? 0,
        input?.pool,
      ).catch(mapError),
    ),
  stats: publicProcedure
    .input(poolStatsInput)
    .output(poolStatsOutput)
    .query(({ input }) => getPoolStats(input?.pool).catch(mapError)),
  list: publicProcedure
    .input(listDepositsInput)
    .output(depositOutput.array())
    .query(({ input }) => listDeposits(input?.since ?? -1).catch(mapError)),
});
