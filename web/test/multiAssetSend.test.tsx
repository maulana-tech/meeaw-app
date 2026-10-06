// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SendTransferDialog } from "../src/components/dashboard/SendTransferDialog";
import { assetPool } from "./helpers/multiAssetFixtures";
import {
  testAccount,
  testParticipant,
  testSigner,
} from "./helpers/requestFixtures";

const state = vi.hoisted(() => ({
  address: "",
  resolve: vi.fn(),
  created: vi.fn(),
  account: null as unknown,
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: state.address,
    username: "alice",
    accountUnlocked: true,
    getSigner: async () => testSigner(1),
    promptUnlock() {},
  }),
}));
vi.mock("../src/lib/notes", () => ({
  getAccount: () => state.account,
  scanMyNotes: async () => ({ claimable: 25_000_000n, health: "healthy" }),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    usernames: { resolve: { query: state.resolve } },
    relay: { status: { query: async () => ({ enabled: true }) } },
    transfers: { create: { mutate: state.created } },
  },
}));
describe("selected-asset Send", () => {
  it("shows AUSD review and invalidates it when selection changes", async () => {
    const sender = await testParticipant("alice", 1),
      recipient = await testParticipant("bob", 2);
    state.address = sender.wallet;
    state.account = testAccount(1);
    state.resolve.mockImplementation(
      async ({ username }: { username: string }) => {
        const p = username === "alice" ? sender : recipient;
        return {
          owner: p.wallet,
          notePubkeyHex: p.notePubkey,
          viewPubkeyHex: p.viewPubkey,
        };
      },
    );
    const props = { open: true, onOpenChange: () => {}, onCreated: () => {} };
    const view = render(
      <SendTransferDialog {...props} pool={assetPool("AUSD")} />,
    );
    fireEvent.change(screen.getByLabelText("Send to"), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByLabelText(/Amount/), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review transfer" }));
    expect(await screen.findByText("20 AUSD")).toBeVisible();
    view.rerender(<SendTransferDialog {...props} pool={assetPool("USDC")} />);
    expect(
      screen.queryByRole("button", { name: "Confirm send" }),
    ).not.toBeInTheDocument();
    expect(state.created).not.toHaveBeenCalled();
  });
});
