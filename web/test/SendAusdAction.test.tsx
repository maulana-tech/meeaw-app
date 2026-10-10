// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SendAusdAction } from "../src/components/dashboard/SendAusdAction";
import { assetPool } from "./helpers/multiAssetFixtures";

const state = vi.hoisted(() => ({
  address: "alice",
  username: "alice" as string | null,
  unlocked: true,
  unlock: vi.fn(),
  pending: vi.fn(),
  pool: null as unknown,
}));
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: state.address,
    username: state.username,
    accountUnlocked: state.unlocked,
    promptUnlock: state.unlock,
  }),
}));
vi.mock("../src/lib/pools", () => ({ activePoolFor: () => state.pool }));
vi.mock("../src/trpc/client", () => ({
  api: { transfers: { pending: { query: state.pending } } },
}));

beforeEach(() => {
  state.address = "alice";
  state.username = "alice";
  state.unlocked = true;
  state.pool = { ...assetPool("AUSD"), transferCapable: true };
  state.pending.mockReset().mockResolvedValue(null);
  state.unlock.mockReset();
});

describe("AUSD send shortcut", () => {
  it("checks the configured AUSD pool before opening a new send", async () => {
    const onReady = vi.fn();
    render(<SendAusdAction onReady={onReady} />);
    fireEvent.click(screen.getByRole("button", { name: "Send AUSD" }));
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(state.pool, null));
    expect(state.pending).toHaveBeenCalledWith({
      pool: assetPool("AUSD").scope,
    });
  });
  it("reopens an existing AUSD transfer after a reload", async () => {
    const pending = { id: "existing-payment" };
    state.pending.mockResolvedValue(pending);
    const onReady = vi.fn();
    render(<SendAusdAction onReady={onReady} />);
    fireEvent.click(screen.getByRole("button", { name: "Send AUSD" }));
    await waitFor(() =>
      expect(onReady).toHaveBeenCalledWith(state.pool, pending),
    );
  });
  it("unlocks before checking payments", () => {
    state.unlocked = false;
    render(<SendAusdAction onReady={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Send AUSD" }));
    expect(state.unlock).toHaveBeenCalledOnce();
    expect(state.pending).not.toHaveBeenCalled();
  });
  it("does not offer sending when AUSD is unavailable", () => {
    state.pool = null;
    render(<SendAusdAction onReady={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: "Send AUSD" }),
    ).not.toBeInTheDocument();
  });
  it("ignores late responses after an account switch", async () => {
    let resolve!: (value: null) => void;
    state.pending.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const onReady = vi.fn();
    const view = render(<SendAusdAction onReady={onReady} />);
    fireEvent.click(screen.getByRole("button", { name: "Send AUSD" }));
    state.address = "bob";
    view.rerender(<SendAusdAction onReady={onReady} />);
    resolve(null);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send AUSD" })).toBeEnabled(),
    );
    expect(onReady).not.toHaveBeenCalled();
  });
  it("does not open a fresh send when pending status is unavailable", async () => {
    state.pending.mockRejectedValue(new Error("offline"));
    const onReady = vi.fn();
    render(<SendAusdAction onReady={onReady} />);
    fireEvent.click(screen.getByRole("button", { name: "Send AUSD" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not be checked/,
    );
    expect(onReady).not.toHaveBeenCalled();
  });
});
