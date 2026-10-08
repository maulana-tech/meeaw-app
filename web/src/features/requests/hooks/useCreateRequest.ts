"use client";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { useWallet } from "../../../components/WalletProvider";
import { getAccount } from "../../../lib/notes";
import { activePool } from "../../../lib/pools";
import { api } from "../../../trpc/client";
import { trpc } from "../../../trpc/react";
import { createSignedRequest } from "../requestCrypto";
import type { PaymentRequest, PoolDescriptor } from "../types";
import { parseRequestAmount, validateRequestNote } from "../validation";

const publicKey = (value: string) =>
  value.startsWith("0x") ? value : `0x${value}`;
export type NewRequestInput = {
  username: string;
  amount: string;
  note: string;
  pool?: PoolDescriptor;
  isCurrent?: () => boolean;
};
export function useCreateRequest() {
  const wallet = useWallet(),
    cache = trpc.useUtils();
  const identity = useRef(wallet.address);
  identity.current = wallet.address;
  const mutation = useMutation({
    mutationFn: async (input: NewRequestInput): Promise<PaymentRequest> => {
      const me = wallet.username;
      if (!me || !wallet.address)
        throw new Error("Claim your @username before creating a request.");
      const account = getAccount();
      if (!account)
        throw new Error("Unlock your account before creating a request.");
      const pool = input.pool ?? activePool();
      if (pool.role !== "active" || !pool.requestCapable)
        throw new Error("Requests are not enabled for this asset yet.");
      const owner = wallet.address;
      const current = () =>
        identity.current === owner &&
        getAccount() === account &&
        (input.isCurrent?.() ?? true);
      const username = input.username.trim().replace(/^@/, "").toLowerCase();
      if (!/^[a-z0-9_]{3,32}$/.test(username))
        throw new Error("Enter a valid @username.");
      if (username === me.toLowerCase())
        throw new Error("Choose another user to request payment from.");
      const signer = await wallet.getSigner();
      if (signer.address.toLowerCase() !== wallet.address.toLowerCase())
        throw new Error("Your wallet changed. Refresh and try again.");
      const [requester, addressee] = await Promise.all([
        api.usernames.resolve.query({ username: me }),
        api.usernames.resolve.query({ username }),
      ]);
      if (
        !requester ||
        requester.owner.toLowerCase() !== wallet.address.toLowerCase()
      )
        throw new Error(
          "Your @username could not be verified. Refresh and try again.",
        );
      if (!addressee)
        throw new Error("That @username is not registered on Meaw.");
      if (!current())
        throw new Error(
          "Your selection or account changed. Review the request again.",
        );
      const record = await createSignedRequest(
        {
          id: crypto.randomUUID(),
          pool,
          requester: {
            username: me.toLowerCase(),
            wallet: requester.owner as `0x${string}`,
            notePubkey: publicKey(requester.notePubkeyHex) as `0x${string}`,
            viewPubkey: publicKey(requester.viewPubkeyHex) as `0x${string}`,
          },
          addressee: {
            username,
            wallet: addressee.owner as `0x${string}`,
            notePubkey: publicKey(addressee.notePubkeyHex) as `0x${string}`,
            viewPubkey: publicKey(addressee.viewPubkeyHex) as `0x${string}`,
          },
          amount: parseRequestAmount(input.amount, pool.tokenDecimals),
          note: validateRequestNote(input.note),
          createdAt: new Date().toISOString(),
        },
        signer,
      );
      if (!current())
        throw new Error(
          "Your selection or account changed. Review the request again.",
        );
      return api.requests.create.mutate(
        record.record,
      ) as unknown as Promise<PaymentRequest>;
    },
    onSuccess: () => {
      void cache.requests.pendingCount.invalidate();
      void cache.requests.listReceived.invalidate();
      void cache.requests.listSent.invalidate();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("mawee:request-changed"));
      }
    },
  });
  return {
    create: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error,
    clearError: mutation.reset,
  };
}
