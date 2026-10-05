import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTRPCContext } from "../../../../server/context";
import { appRouter } from "../../../../server/root";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ req }),
    onError: ({ path, error }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`[trpc] ${path}:`, error.cause ?? error);
      }
    },
  });

export { handler as GET, handler as POST };
