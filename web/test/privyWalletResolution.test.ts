import type { ConnectedWallet } from "@privy-io/react-auth";
import { describe, expect, it } from "vitest";
import { findEmbeddedWallet } from "../src/lib/privy-wallet";

const wallet = (walletClientType: string, address: string) =>
  ({ walletClientType, address }) as unknown as ConnectedWallet;

describe("findEmbeddedWallet", () => {
  it("picks the Privy embedded wallet over injected wallets", () => {
    const embedded = wallet(
      "privy",
      "0x00000000000000000000000000000000000000E1",
    );
    expect(
      findEmbeddedWallet([
        wallet("metamask", "0x00000000000000000000000000000000000000A1"),
        embedded,
      ]),
    ).toBe(embedded);
  });

  it("returns null when the user has no embedded wallet yet", () => {
    expect(
      findEmbeddedWallet([
        wallet("metamask", "0x00000000000000000000000000000000000000A1"),
      ]),
    ).toBeNull();
  });
});
