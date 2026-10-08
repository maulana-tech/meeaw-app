import { describe, expect, it, vi } from "vitest";
import { rotationTypedData } from "../src/features/privacyKeys/rotationTypedData";
import { privacyKeysRouter } from "../src/server/modules/privacyKeys/privacyKeys.router";
import { createPrivacyKeyService } from "../src/server/modules/privacyKeys/privacyKeys.service";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";

describe("privacy key authentication and registry binding", () => {
  it("refuses activation from metadata with another owner or an unconfirmed registry pair", async () => {
    const f = await makePrivacyFixture();
    const repository = {
      get: vi
        .fn()
        .mockResolvedValue({ ...f.state, owner: `0x${"2".repeat(40)}` }),
      bootstrap: vi.fn(),
      prepare: vi.fn(),
    };
    const service = createPrivacyKeyService({
      wallet: async () => f.owner,
      username: async () => f.username,
      registry: f.registry,
      confirmations: 2,
      now: () => 1800000000,
      repository,
      readRegistry: async () => ({
        scope: f.registry,
        owner: f.owner,
        keys: f.keys[0],
        nonce: "0",
        block: 10,
        blockHash: f.state.generations[0].evidence.blockHash,
        head: 12,
      }),
    });
    await expect(service.verifiedState("alice")).rejects.toThrow();
    repository.get.mockResolvedValue(f.rotatedState);
    await expect(service.verifiedState("alice")).rejects.toThrow();
  });
  it("refuses a signed candidate that reuses any retained historical pair", async () => {
    const f = await makePrivacyFixture(),
      prepare = vi.fn();
    const unsigned = {
      ...f.approval,
      expectedRevision: 2,
      from: 1,
      to: 2,
      oldKeys: f.keys[1],
      newKeys: f.keys[0],
    };
    const signature = await f.signer.walletClient.signTypedData({
      ...rotationTypedData(unsigned),
      account: f.signer.walletClient.account ?? f.owner,
    });
    const service = createPrivacyKeyService({
      wallet: async () => f.owner,
      username: async () => f.username,
      registry: f.registry,
      confirmations: 2,
      now: () => 1800000000,
      repository: {
        get: async () => f.rotatedState,
        bootstrap: vi.fn(),
        prepare,
      },
      readRegistry: async () => ({
        scope: f.registry,
        owner: f.owner,
        keys: f.keys[1],
        nonce: "1",
        block: 20,
        blockHash: f.rotatedState.generations[1].evidence.blockHash,
        head: 22,
      }),
    });
    await expect(
      service.prepare("alice", { ...unsigned, signature }),
    ).rejects.toThrow();
    expect(prepare).not.toHaveBeenCalled();
  });
  it("rejects anonymous metadata reads and rotation writes", async () => {
    const caller = privacyKeysRouter.createCaller({
      ip: null,
      authToken: null,
      privyUserId: null,
      privyClaim: null,
      authError: null,
    });
    const f = await makePrivacyFixture();
    await expect(caller.state()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.bootstrap({ keys: f.keys[0] })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.prepare(await f.signApproval())).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.status({ id: f.approval.id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.reconcile({ id: f.approval.id })).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
    await expect(
      caller.markSubmitted({
        id: f.approval.id,
        txHash: `0x${"a".repeat(64)}`,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.submit({
        id: f.approval.id,
        authorization: {
          nonce: "0",
          deadline: "4102444800",
          signature: `0x${"1".repeat(130)}`,
        },
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("bootstraps only a confirmed matching pair and verifies wallet/scope/signature before writes", async () => {
    const f = await makePrivacyFixture();
    const bootstrap = vi.fn(async () => f.state),
      prepare = vi.fn(async () => ({
        intent: await f.signApproval(),
        phase: "prepared" as const,
        txHash: null,
        updatedAt: new Date().toISOString(),
      }));
    const reader = vi.fn(async () => ({
      scope: f.registry,
      owner: f.owner,
      keys: f.keys[0],
      nonce: "0",
      block: 10,
      blockHash: f.state.generations[0].evidence.blockHash,
      head: 12,
    }));
    const service = createPrivacyKeyService({
      wallet: async (user) => (user === "alice" ? f.owner : null),
      username: async () => f.username,
      registry: f.registry,
      confirmations: 2,
      repository: {
        get: vi.fn().mockResolvedValueOnce(null).mockResolvedValue(f.state),
        bootstrap,
        prepare,
      },
      readRegistry: reader,
      now: () => 1800000000,
    });
    expect(await service.bootstrap("alice", { keys: f.keys[0] })).toEqual(
      f.state,
    );
    await expect(
      service.bootstrap("alice", { keys: f.keys[1] }),
    ).rejects.toThrow();
    await expect(service.state("bob")).rejects.toThrow();
    const signed = await f.signApproval();
    await service.prepare("alice", signed);
    for (const changed of [
      { ...signed, expectedRevision: 2 },
      { ...signed, owner: `0x${"2".repeat(40)}` as const },
      { ...signed, newKeys: f.keys[0] },
      { ...signed, deadline: "1" },
    ])
      await expect(service.prepare("alice", changed)).rejects.toThrow();
    expect(prepare).toHaveBeenCalledTimes(1);
    reader.mockResolvedValueOnce({
      scope: f.registry,
      owner: f.owner,
      keys: f.keys[0],
      nonce: "0",
      block: 10,
      blockHash: f.state.generations[0].evidence.blockHash,
      head: 10,
    });
    await expect(
      service.bootstrap("alice", { keys: f.keys[0] }),
    ).rejects.toThrow();
    expect(bootstrap).toHaveBeenCalledTimes(1);
  });
});
