// @vitest-environment happy-dom
import { render } from "@testing-library/react";

const captured = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock("@privy-io/react-auth", () => ({
  PrivyProvider: (props: Record<string, unknown>) => {
    captured.props = props;
    return props.children;
  },
}));

describe("PrivyAppProvider", () => {
  it("uses Google, email and passkey login and provisions a Monad embedded wallet", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "privy-public-app");
    const { PrivyAppProvider } = await import(
      "../src/components/PrivyAppProvider"
    );
    render(
      <PrivyAppProvider>
        <div>child</div>
      </PrivyAppProvider>,
    );
    expect(captured.props?.appId).toBe("privy-public-app");
    const config = captured.props?.config as {
      defaultChain: { id: number };
      supportedChains: { id: number }[];
    };
    expect(config).toMatchObject({
      loginMethods: ["google", "passkey", "email"],
      embeddedWallets: {
        ethereum: { createOnLogin: "users-without-wallets" },
        solana: { createOnLogin: "off" },
      },
    });
    expect(config.defaultChain.id).toBe(10143);
    expect(config.supportedChains.map((chain) => chain.id)).toEqual([10143]);
  });
});
