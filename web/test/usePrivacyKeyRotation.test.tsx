// @vitest-environment happy-dom
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const ports = vi.hoisted(() => {
  const owner = "0x1111111111111111111111111111111111111111";
  const operation = {
    intent: {
      id: "00000000-0000-4000-8000-000000000001",
      owner,
      username: "alice",
    },
    phase: "prepared",
    txHash: null,
  };
  const state = {
    owner,
    username: "alice",
    registry: "31337:0x4444444444444444444444444444444444444444",
    revision: 1,
    activeGeneration: 0,
    generations: [],
    pending: operation as typeof operation | null,
  };
  return {
    state,
    operation,
    abort: vi.fn(),
    getSigner: vi.fn(),
    refresh: vi.fn(),
  };
});
vi.mock("../src/components/WalletProvider", () => ({
  useWallet: () => ({
    address: ports.state.owner,
    username: "alice",
    accountUnlocked: true,
    recoveryMethod: "pin",
    getSigner: ports.getSigner,
    refreshPrivacyState: ports.refresh,
  }),
}));
vi.mock("../src/lib/chain", () => ({
  gaslessEnabled: vi.fn(),
  registryAddress: "0x4444444444444444444444444444444444444444",
  publicClient: { readContract: vi.fn() },
}));
vi.mock("../src/features/privacyKeys/session", () => ({
  getPrivacyKeyring: () => null,
  installPrivacyKeyring: vi.fn(),
}));
vi.mock("../src/features/privacyKeys/reauthenticate", () => ({
  reauthenticatePrivacyRoot: vi.fn(),
  unlockPrivacyKeyring: vi.fn(),
}));
vi.mock("../src/trpc/client", () => ({
  api: {
    privacyKeys: {
      state: { query: async () => ({ ...ports.state }) },
      abort: { mutate: ports.abort },
    },
  },
}));

import { usePrivacyKeyRotation } from "../src/features/privacyKeys/usePrivacyKeyRotation";

it("clears a prepared rotation loaded from another session when the dialog is closed", async () => {
  ports.abort.mockImplementation(async () => {
    ports.state.pending = null;
    return { ...ports.operation, phase: "failed" };
  });
  const { result } = renderHook(() => usePrivacyKeyRotation());
  await waitFor(() => expect(result.current.operation?.phase).toBe("prepared"));
  await act(async () => {
    await result.current.clear();
  });
  expect(ports.abort).toHaveBeenCalledWith({ id: ports.operation.intent.id });
  expect(result.current.operation).toBeNull();
  expect(result.current.state?.pending).toBeNull();
});
