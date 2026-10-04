"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { env } from "@/env";
import { chain } from "@/lib/chain";

export const privyAppId =
  env.NEXT_PUBLIC_PRIVY_APP_ID || "mawee_missing_privy_app_id";

export function PrivyAppProvider({ children }: { children: ReactNode }) {
  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["google", "passkey", "email"],
        appearance: {
          theme: "dark",
          accentColor: "#91975b",
          landingHeader: "Sign in to Mawee",
          loginMessage: "Use Email, Google, or a passkey.",
        },
        defaultChain: chain,
        supportedChains: [chain],
        embeddedWallets: {
          // Every Mawee account is a Privy embedded wallet on Monad.
          ethereum: { createOnLogin: "users-without-wallets" },
          solana: { createOnLogin: "off" },
          showWalletUIs: true,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
