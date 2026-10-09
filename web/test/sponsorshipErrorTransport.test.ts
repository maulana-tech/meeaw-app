import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { expect, it } from "vitest";
import { RelayRevertedError } from "../src/server/lib/relayOutcome.errors";
import { SponsorshipError } from "../src/server/modules/sponsorship/sponsorship.errors";
import { createTRPCRouter, publicProcedure } from "../src/server/trpc";

const hash = `0x${"a".repeat(64)}` as const;
const router = createTRPCRouter({
  paused: publicProcedure.mutation(() => {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      cause: new SponsorshipError("budget"),
    });
  }),
  reverted: publicProcedure.mutation(() => {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      cause: new RelayRevertedError(hash),
    });
  }),
});
const context = {
  ip: null,
  authToken: null,
  privyUserId: null,
  privyClaim: null,
  authError: null,
};
it("carries a safe pause reason and canonical revert outcome through the real HTTP error formatter", async () => {
  const call = async (path: string) => {
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: new Request(`http://localhost/trpc/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "null",
      }),
      router,
      createContext: () => context,
    });
    return response.json();
  };
  expect((await call("paused")).error.data.sponsorshipReason).toBe("budget");
  expect((await call("reverted")).error.data.relayOutcome).toEqual({
    state: "reverted",
    txHash: hash,
  });
});
