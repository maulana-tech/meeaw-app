import { describe, expect, it, vi } from "vitest";
import { createPrivacyRotationController } from "../src/features/privacyKeys/rotationController";
import type { RotationOperation } from "../src/features/privacyKeys/types";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";

describe("Settings privacy rotation controller", () => {
  it("retains the accepted authorization after a sponsorship pause without another signature", async () => {
    const f = await makePrivacyFixture();
    let pending: RotationOperation | null = null,
      attempts = 0;
    const sign = vi.spyOn(f.signer.walletClient, "signTypedData");
    const controller = createPrivacyRotationController({
      owner: f.owner,
      username: f.username,
      method: "pin",
      isCurrent: () => true,
      state: async () => ({ ...f.state, pending }),
      verifiedState: async () => f.state,
      bootstrap: async () => f.state,
      root: async () => f.root.slice(),
      signer: async () => f.signer,
      nonce: async () => "0",
      sponsored: async () => true,
      prepare: async (intent) =>
        (pending = {
          intent,
          phase: "prepared",
          txHash: null,
          updatedAt: new Date().toISOString(),
        }),
      submit: async (_id, authorization) => {
        if (!pending) throw Error("Missing pending operation");
        pending = {
          ...pending,
          registryAuthorization: authorization,
          sponsorshipPause: "budget",
        };
        if (++attempts === 1)
          throw Error("Gas sponsorship is temporarily unavailable.");
        return pending;
      },
      mark: vi.fn(),
      wallet: vi.fn(),
      reconcile: vi.fn(),
      install: vi.fn(),
    });
    await controller.prepare("123456");
    await expect(controller.confirm()).rejects.toThrow("Gas sponsorship");
    await controller.confirm();
    expect(sign).toHaveBeenCalledTimes(2);
  });
  it("does not admit a rotation if its review was disposed while the signer was loading", async () => {
    const f = await makePrivacyFixture();
    let finish!: (value: typeof f.signer) => void;
    const prepare = vi.fn();
    const controller = createPrivacyRotationController({
      owner: f.owner,
      username: f.username,
      method: "pin",
      isCurrent: () => true,
      state: async () => f.state,
      verifiedState: async () => f.state,
      bootstrap: async () => f.state,
      root: async () => f.root.slice(),
      signer: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      nonce: vi.fn(),
      sponsored: vi.fn(),
      prepare,
      submit: vi.fn(),
      mark: vi.fn(),
      wallet: vi.fn(),
      reconcile: vi.fn(),
      install: vi.fn(),
    });
    await controller.prepare("123456");
    const confirmation = controller.confirm();
    controller.dispose();
    finish(f.signer);
    await expect(confirmation).rejects.toThrow(/changed|review/i);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("does not install a disposed review after the verified-history response arrives", async () => {
    const f = await makePrivacyFixture();
    let state = f.state;
    let delayed = false;
    let resolveHistory!: (value: typeof f.state) => void;
    const install = vi.fn();
    let op: RotationOperation;
    const controller = createPrivacyRotationController({
      owner: f.owner,
      username: f.username,
      method: "pin",
      isCurrent: () => true,
      state: async () => state,
      verifiedState: () =>
        delayed
          ? new Promise((resolve) => {
              resolveHistory = resolve;
            })
          : Promise.resolve(state),
      bootstrap: async () => state,
      root: async () => f.root.slice(),
      signer: async () => f.signer,
      nonce: async () => "0",
      sponsored: async () => true,
      prepare: async (intent) =>
        (op = {
          intent,
          phase: "prepared",
          txHash: null,
          updatedAt: new Date().toISOString(),
        }),
      submit: async () => ({ ...op, phase: "submitted" }),
      mark: vi.fn(),
      wallet: vi.fn(),
      reconcile: async () => ({ ...op, phase: "confirmed" }),
      install,
    });
    await controller.prepare("123456");
    await controller.confirm();
    state = f.rotatedState;
    delayed = true;
    const checking = controller.check();
    await vi.waitFor(() => expect(resolveHistory).toBeTypeOf("function"));
    controller.dispose();
    resolveHistory(state);
    await expect(checking).rejects.toThrow(/changed|review/i);
    expect(install).not.toHaveBeenCalled();
  });
  it("derives review locally, signs only on confirmation and installs only confirmed history", async () => {
    const f = await makePrivacyFixture();
    const install = vi.fn(),
      prepare = vi.fn(
        async (intent) =>
          ({
            intent,
            phase: "prepared",
            txHash: null,
            updatedAt: new Date().toISOString(),
          }) as RotationOperation,
      );
    const submit = vi.fn(
      async (_id, authorization) =>
        ({
          intent: await f.signApproval(),
          phase: "submitted",
          txHash: `0x${"a".repeat(64)}`,
          updatedAt: new Date().toISOString(),
          registryAuthorization: authorization,
        }) as RotationOperation,
    );
    let state = f.state;
    const controller = createPrivacyRotationController({
      owner: f.owner,
      username: f.username,
      method: "pin",
      isCurrent: () => true,
      state: async () => state,
      verifiedState: async () => state,
      bootstrap: async () => f.state,
      root: async () => f.root.slice(),
      signer: async () => f.signer,
      nonce: async () => "0",
      sponsored: async () => true,
      prepare,
      submit,
      mark: vi.fn(),
      wallet: vi.fn(),
      reconcile: async () => ({
        intent: await f.signApproval(),
        phase: "confirmed",
        txHash: `0x${"a".repeat(64)}`,
        updatedAt: new Date().toISOString(),
      }),
      install,
    });
    const review = await controller.prepare("123456");
    expect(review.to).toBe(1);
    expect(review.newKeys).toEqual(f.keys[1]);
    expect(prepare).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    await controller.confirm();
    expect(install).not.toHaveBeenCalled();
    state = f.rotatedState;
    await controller.check();
    expect(install).toHaveBeenCalledOnce();
    expect(install.mock.calls[0][0].activeGeneration).toBe(1);
  });
  it("clears a cached operation only after a matching server terminal response", async () => {
    const f = await makePrivacyFixture();
    let op: RotationOperation;
    const controller = createPrivacyRotationController({
      owner: f.owner,
      username: f.username,
      method: "pin",
      isCurrent: () => true,
      state: async () => f.state,
      verifiedState: async () => f.state,
      bootstrap: async () => f.state,
      root: async () => f.root.slice(),
      signer: async () => f.signer,
      nonce: async () => "0",
      sponsored: async () => true,
      prepare: async (intent) =>
        (op = {
          intent,
          phase: "prepared",
          txHash: null,
          updatedAt: new Date().toISOString(),
        }),
      submit: async () => ({ ...op, phase: "submitted" }),
      mark: vi.fn(),
      wallet: vi.fn(),
      reconcile: vi.fn(),
      install: vi.fn(),
    });
    await controller.prepare("123456");
    await controller.confirm();
    const pending = controller.pending();
    if (!pending) throw Error("Expected a pending rotation");
    controller.clearTerminal({ ...pending, phase: "failed" });
    expect(controller.pending()).toBeNull();
    controller.dispose();
  });
  it("clears unaccepted private review when wallet identity becomes stale", async () => {
    const f = await makePrivacyFixture();
    let current = true;
    const prepare = vi.fn();
    const controller = createPrivacyRotationController({
      owner: f.owner,
      username: f.username,
      method: "pin",
      isCurrent: () => current,
      state: async () => f.state,
      verifiedState: async () => f.state,
      bootstrap: async () => f.state,
      root: async () => f.root.slice(),
      signer: async () => f.signer,
      nonce: vi.fn(),
      sponsored: vi.fn(),
      prepare,
      submit: vi.fn(),
      mark: vi.fn(),
      wallet: vi.fn(),
      reconcile: vi.fn(),
      install: vi.fn(),
    });
    await controller.prepare("123456");
    current = false;
    await expect(controller.confirm()).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
    controller.dispose();
  });
});
