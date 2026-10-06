// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SendTransferDialog } from "../src/components/dashboard/SendTransferDialog";
import {
  testAccount,
  testParticipant,
  testSigner,
} from "./helpers/requestFixtures";
const state = vi.hoisted(() => ({
  resolve: vi.fn(),
  create: vi.fn(),
  signer: vi.fn(),
  account: null as unknown,
  address: "",
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: state.address,
    username: "alice",
    accountUnlocked: true,
    getSigner: state.signer,
    promptUnlock: vi.fn(),
  }),
}));
vi.mock("../src/lib/notes", () => ({
  getAccount: () => state.account,
  scanMyNotes: async () => ({ claimable: 100_000_000n, health: "healthy" }),
}));
vi.mock("../src/lib/pools", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/pools")>()),
  requestPool: () => ({
    scope: "31337:0x1111111111111111111111111111111111111111",
    chainId: 31337,
    address: "0x1111111111111111111111111111111111111111",
    token: "0x5555555555555555555555555555555555555555",
    tokenDecimals: 6,
    depth: 20,
    confirmations: 1,
    role: "active",
    requestCapable: true,
    deployBlock: 0,
  }),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    usernames: { resolve: { query: state.resolve } },
    relay: { status: { query: async () => ({ enabled: true }) } },
    transfers: { create: { mutate: state.create } },
  },
}));
describe("Send modal", () => {
  beforeEach(() => {
    state.resolve.mockReset();
    state.create.mockReset();
    state.signer.mockResolvedValue(testSigner(1));
    state.account = testAccount(1);
    state.address = testSigner(1).address;
  });
  it("requires recipient review again after registry keys change", async () => {
    const alice = await testParticipant("alice", 1),
      bob = await testParticipant("bob", 2),
      changed = await testParticipant("bob", 3);
    let rotated = false;
    state.resolve.mockImplementation(
      async ({ username }: { username: string }) => {
        const p = username === "alice" ? alice : rotated ? changed : bob;
        return {
          owner: p.wallet,
          notePubkeyHex: p.notePubkey,
          viewPubkeyHex: p.viewPubkey,
        };
      },
    );
    render(
      <SendTransferDialog open onOpenChange={() => {}} onCreated={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Send to"), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByLabelText("Amount · USDC"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review transfer" }));
    await screen.findByRole("button", { name: "Confirm send" });
    rotated = true;
    fireEvent.click(screen.getByRole("button", { name: "Confirm send" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/review.*recipient/i),
    );
    expect(state.create).not.toHaveBeenCalled();
  });
});
