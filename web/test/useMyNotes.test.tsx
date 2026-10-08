// @vitest-environment happy-dom

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMyNotes } from "../src/components/dashboard/useMyNotes";

const mocks = vi.hoisted(() => ({
  scanMyNotes: vi.fn(),
  scanKeyringNotes: vi.fn(),
  ring: null as unknown,
}));

vi.mock("../src/lib/notes", () => ({
  getAccount: vi.fn(() => ({ ownerSecret: 1n, viewSk: new Uint8Array(32) })),
  scanMyNotes: mocks.scanMyNotes,
  scanKeyringNotes: mocks.scanKeyringNotes,
}));
vi.mock("../src/features/privacyKeys/session", () => ({
  getPrivacyKeyring: () => mocks.ring,
}));

const result = {
  notes: [{ leafIndex: 1, amount: 5_000_000n, salt: 2n, spent: false }],
  leaves: [1n],
  claimable: 5_000_000n,
  mirrorAvailable: true,
  indexedAt: new Date().toISOString(),
  health: "healthy" as const,
};

function Harness() {
  const state = useMyNotes("CACCOUNT");
  return (
    <div>
      <span data-testid="loading">{String(state.loading)}</span>
      <span data-testid="refreshing">{String(state.refreshing)}</span>
      <span data-testid="balance">{state.claimable.toString()}</span>
    </div>
  );
}

describe("useMyNotes", () => {
  beforeEach(() => {
    mocks.scanMyNotes.mockReset();
    mocks.scanKeyringNotes.mockReset();
    mocks.ring = null;
  });

  it("keeps the previous balance visible during a background refresh", async () => {
    mocks.scanMyNotes
      .mockResolvedValueOnce(result)
      .mockResolvedValueOnce(result);
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("balance")).toHaveTextContent("5000000"),
    );
    expect(screen.getByTestId("loading")).toHaveTextContent("false");

    let resolveRefresh!: (value: typeof result) => void;
    mocks.scanMyNotes.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    await act(async () => window.dispatchEvent(new Event("focus")));

    await waitFor(() =>
      expect(screen.getByTestId("refreshing")).toHaveTextContent("true"),
    );
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("balance")).toHaveTextContent("5000000");

    await act(async () => resolveRefresh(result));
  });
  it("scans retained generations and invalidates their results when the key session changes", async () => {
    mocks.ring = {
      owner: "0x1111111111111111111111111111111111111111",
      registry: "31337:0x4444444444444444444444444444444444444444",
      revision: 2,
      activeGeneration: 1,
    };
    mocks.scanKeyringNotes.mockResolvedValue({
      ...result,
      claimable: 20_000_000n,
    });
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByTestId("balance")).toHaveTextContent("20000000"),
    );
    expect(mocks.scanKeyringNotes).toHaveBeenCalled();
    expect(mocks.scanMyNotes).not.toHaveBeenCalled();
    mocks.ring = null;
    mocks.scanMyNotes.mockResolvedValue({
      ...result,
      claimable: 0n,
      notes: [],
    });
    await act(async () =>
      window.dispatchEvent(new Event("mawee:privacy-keys-changed")),
    );
    await waitFor(() =>
      expect(screen.getByTestId("balance")).toHaveTextContent("0"),
    );
  });
});
