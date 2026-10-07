import type { inferRouterOutputs } from "@trpc/server";
import { depositsRouter } from "./modules/deposits/deposits.router";
import { paymentLinksRouter } from "./modules/paymentLinks/paymentLinks.router";
import { receiptsRouter } from "./modules/receipts/receipts.router";
import { relayRouter } from "./modules/relay/relay.router";
import { requestsRouter } from "./modules/requests/requests.router";
import { transfersRouter } from "./modules/transfers/transfers.router";
import { usernamesRouter } from "./modules/usernames/usernames.router";
import { walletsRouter } from "./modules/wallets/wallets.router";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  receipts: receiptsRouter,
  deposits: depositsRouter,
  usernames: usernamesRouter,
  paymentLinks: paymentLinksRouter,
  wallets: walletsRouter,
  relay: relayRouter,
  requests: requestsRouter,
  transfers: transfersRouter,
});

export type AppRouter = typeof appRouter;

export type RouterOutputs = inferRouterOutputs<AppRouter>;
