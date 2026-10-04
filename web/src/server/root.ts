import type { inferRouterOutputs } from "@trpc/server";
import { depositsRouter } from "./modules/deposits/deposits.router";
import { paymentLinksRouter } from "./modules/paymentLinks/paymentLinks.router";
import { usernamesRouter } from "./modules/usernames/usernames.router";
import { walletsRouter } from "./modules/wallets/wallets.router";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  deposits: depositsRouter,
  usernames: usernamesRouter,
  paymentLinks: paymentLinksRouter,
  wallets: walletsRouter,
});

export type AppRouter = typeof appRouter;

export type RouterOutputs = inferRouterOutputs<AppRouter>;
