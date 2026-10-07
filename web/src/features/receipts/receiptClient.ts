import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "../../server/root";
import type { LoadReceiptSnapshot } from "./receiptChainTypes";

const client = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      fetch: (url, options) => fetch(url, { ...options, credentials: "omit" }),
    }),
  ],
});
// This read-only query must work before auth is ready and send no user identity.
export const loadReceiptSnapshot: LoadReceiptSnapshot = (input) =>
  client.receipts.chainSnapshot.query(input);
