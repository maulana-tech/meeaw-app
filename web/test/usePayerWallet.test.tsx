// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";

const EMBEDDED = "0x5A0b54D5dc17e0AadC383d2db43B0a0D3E029c4c";
const BROWSER = "0x00000000000000000000000000000000000000Fa";

const mocks = vi.hoisted(() => ({
  authenticated: false,
  wallets: [] as { walletClientType: string; address: string }[],
  login: vi.fn(),
  privySigner: vi.fn(async () => ({ address: "privy" })),
  payerSigner: vi.fn(async () => ({ address: "browser" })),
  connectPayerWallet: vi.fn(),
}));

vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({
    ready: true,
    authenticated: mocks.authenticated,
    login: mocks.login,
  }),
  useWallets: () => ({ wallets: mocks.wallets }),
}));
vi.mock("../src/lib/privy-wallet", () => ({
  findEmbeddedWallet: (wallets: { walletClientType: string }[]) =>
    wallets.find((w) => w.walletClientType === "privy") ?? null,
  privySigner: mocks.privySigner,
}));
vi.mock("../src/features/payerWallet/injected", () => ({
  connectPayerWallet: mocks.connectPayerWallet,
  payerSigner: mocks.payerSigner,
}));

import { usePayerWallet } from "../src/features/payerWallet/hooks/usePayerWallet";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticated = false;
  mocks.wallets = [];
});

describe("usePayerWallet", () => {
  it("starts with no wallet and opens Privy for email checkout", () => {
    const { result } = renderHook(() => usePayerWallet());
    expect(result.current.address).toBeNull();
    expect(result.current.source).toBeNull();
    act(() => result.current.signInWithEmail());
    expect(mocks.login).toHaveBeenCalledOnce();
  });

  it("pays from the Privy embedded wallet once the payer has signed in", async () => {
    mocks.authenticated = true;
    mocks.wallets = [{ walletClientType: "privy", address: EMBEDDED }];
    const { result } = renderHook(() => usePayerWallet());
    expect(result.current.source).toBe("privy");
    expect(result.current.address).toBe(EMBEDDED);
    await result.current.getSigner();
    expect(mocks.privySigner).toHaveBeenCalled();
  });

  it("reports the wallet as preparing while Privy creates it", () => {
    mocks.authenticated = true;
    const { result } = renderHook(() => usePayerWallet());
    expect(result.current.preparing).toBe(true);
    expect(result.current.address).toBeNull();
  });

  it("prefers a browser wallet the payer explicitly connected", async () => {
    mocks.authenticated = true;
    mocks.wallets = [{ walletClientType: "privy", address: EMBEDDED }];
    mocks.connectPayerWallet.mockResolvedValue(BROWSER);
    const { result } = renderHook(() => usePayerWallet());
    await act(() => result.current.connect());
    expect(result.current.source).toBe("browser");
    expect(result.current.address).toBe(BROWSER);
    await result.current.getSigner();
    expect(mocks.payerSigner).toHaveBeenCalledWith(BROWSER);
  });
});
