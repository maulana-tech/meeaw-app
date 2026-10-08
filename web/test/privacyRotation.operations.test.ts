import type { Hex } from "viem";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registryTypedData } from "../src/lib/typedData";
import { PrivacyKeysRepository } from "../src/server/modules/privacyKeys/privacyKeys.repository";
import { createRotationOperations } from "../src/server/modules/privacyKeys/rotationOperations";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { openIsolatedRequestDb } from "./helpers/requestDb";

describe("durable routine privacy rotation", () => {
  let isolated: Awaited<ReturnType<typeof openIsolatedRequestDb>>;
  beforeAll(async () => {
    isolated = await openIsolatedRequestDb();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  async function fixture(suffix: number) {
    const f = await makePrivacyFixture();
    const registry =
      `31337:0x${suffix.toString(16).padStart(40, "0")}` as const;
    f.state.registry = registry;
    f.approval.registry = registry;
    const repo = new PrivacyKeysRepository(isolated.db);
    await repo.bootstrap(f.state);
    const signed = await f.signApproval();
    await repo.prepare(signed);
    const hash = `0x${"a".repeat(64)}` as Hex;
    const authorization = {
      nonce: "0",
      deadline: "4102444800",
      signature: await f.signer.walletClient.signTypedData({
        ...registryTypedData({
          rotate: true,
          chainId: 31337,
          registry: registry.split(":")[1] as Hex,
          owner: f.owner,
          username: f.username,
          ...f.keys[1],
          nonce: 0n,
          deadline: 4102444800n,
        }),
        account: f.signer.walletClient.account ?? f.signer.address,
      }),
    };
    let confirmed = false;
    const reader = vi.fn(async () => ({
      scope: registry,
      owner: f.owner,
      keys: confirmed ? f.keys[1] : f.keys[0],
      nonce: confirmed ? "1" : "0",
      block: confirmed ? 11 : 10,
      blockHash: `0x${(confirmed ? "2" : "1").repeat(64)}` as Hex,
      head: 12,
    }));
    const verify = vi.fn(async () =>
      confirmed
        ? {
            state: "confirmed" as const,
            evidence: {
              block: 11,
              blockHash: `0x${"2".repeat(64)}` as Hex,
              txHash: hash,
            },
          }
        : { state: "unknown" as const },
    );
    const sender = {
      prepare: vi.fn(async () => ({ txHash: hash })),
      broadcast: vi.fn(async () => ({
        state: "unknown" as const,
        txHash: hash,
        receipt: null,
      })),
      reconcile: vi.fn(async () => ({
        state: "unknown" as const,
        txHash: hash,
        receipt: null,
      })),
    };
    const refresh = vi.fn(async () => {});
    const ops = createRotationOperations({
      repository: repo,
      readRegistry: reader,
      verifyTransaction: verify,
      refreshCache: refresh,
      findTransaction: async () => ({ hash: confirmed ? hash : null }),
      sender,
      relayer: `0x${"3".repeat(40)}`,
      confirmations: 2,
      now: () => 1800000000,
    });
    return {
      ...f,
      registry,
      repo,
      signed,
      authorization,
      hash,
      sender,
      reader,
      verify,
      refresh,
      ops,
      confirmCandidate() {
        confirmed = true;
      },
      submit: () =>
        ops.submit(f.owner, registry, { id: signed.id, authorization }),
      reconcile: () => ops.reconcile(f.owner, registry, signed.id),
      state: () => repo.get(f.owner, registry),
    };
  }
  it("retries exact durable identity after unknown broadcast and activates once", async () => {
    const f = await fixture(11);
    await f.submit();
    expect((await f.state())?.activeGeneration).toBe(0);
    await f.submit();
    expect(
      f.sender.prepare.mock.calls.map((args) => args[0].operationKey),
    ).toEqual([
      `privacy-rotation:${f.signed.id}`,
      `privacy-rotation:${f.signed.id}`,
    ]);
    expect(f.sender.prepare.mock.calls[0][0]).toEqual(
      f.sender.prepare.mock.calls[1][0],
    );
    f.confirmCandidate();
    await f.reconcile();
    await f.reconcile();
    expect((await f.state())?.activeGeneration).toBe(1);
    expect((await f.state())?.generations).toHaveLength(2);
    expect((await f.state())?.pending).toBeNull();
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });
  it("retains the candidate key for recovery while cache synchronization keeps spending fenced", async () => {
    const f = await fixture(12);
    await f.submit();
    f.confirmCandidate();
    f.refresh.mockRejectedValueOnce(new Error("cache unavailable"));
    await f.reconcile();
    expect((await f.state())?.activeGeneration).toBe(1);
    expect((await f.state())?.generations).toHaveLength(2);
    expect((await f.state())?.pending).not.toBeNull();
    await expect(
      f.repo.acquireTicket({
        owner: f.owner,
        registry: f.registry,
        revision: 2,
        fundingGeneration: 1,
        operationId: "payment",
        kind: "spend",
      }),
    ).rejects.toThrow();
    await f.reconcile();
    expect((await f.state())?.pending).toBeNull();
    expect(f.sender.prepare).toHaveBeenCalledTimes(1);
  });
  it("does not broadcast an unauthorized candidate or allow another wallet to attach a hash", async () => {
    const f = await fixture(13);
    await expect(
      f.ops.submit(f.owner, f.registry, {
        id: f.signed.id,
        authorization: { ...f.authorization, nonce: "1" },
      }),
    ).rejects.toThrow();
    await expect(
      f.ops.markSubmitted(
        `0x${"2".repeat(40)}`,
        f.registry,
        f.signed.id,
        f.hash,
      ),
    ).rejects.toThrow();
    expect(f.sender.prepare).not.toHaveBeenCalled();
    expect((await f.state())?.activeGeneration).toBe(0);
  });
  it("recovers a lost wallet hash from registry events without another wallet transaction", async () => {
    const f = await fixture(14);
    await f.ops.authorize(f.owner, f.registry, f.signed.id, f.authorization);
    expect((await f.state())?.pending?.txHash).toBeNull();
    f.confirmCandidate();
    await f.reconcile();
    expect((await f.state())?.activeGeneration).toBe(1);
    expect(f.sender.prepare).not.toHaveBeenCalled();
  });
  it("keeps historical keys and the fence after a reverted transaction with an outstanding permit", async () => {
    const f = await fixture(15);
    await f.submit();
    f.verify.mockResolvedValueOnce({ state: "reverted" });
    expect((await f.reconcile()).phase).toBe("failed");
    expect((await f.state())?.activeGeneration).toBe(0);
    expect((await f.state())?.generations).toHaveLength(1);
    expect((await f.state())?.pending).not.toBeNull();
  });
  it("ends an expired permit only after confirmed old keys and unchanged nonce prove no rotation", async () => {
    const f = await fixture(16);
    await f.submit();
    f.reader.mockResolvedValue({
      scope: f.registry,
      owner: f.owner,
      keys: f.keys[0],
      nonce: "0",
      block: 12,
      blockHash: `0x${"2".repeat(64)}`,
      head: 14,
      timestamp: "4102444801",
    });
    expect((await f.reconcile()).phase).toBe("failed");
    expect((await f.state())?.pending).toBeNull();
    expect((await f.state())?.activeGeneration).toBe(0);
  });
});
