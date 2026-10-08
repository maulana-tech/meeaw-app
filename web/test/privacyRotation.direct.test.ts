import { decodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";
import { submitRegistryRotationWallet } from "../src/features/privacyKeys/registryRotation";
import { maweeRegistryAbi } from "../src/lib/abi";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";

describe("direct privacy registry rotation", () => {
  it("consumes the authorization nonce through setPubkeysFor and records hash immediately", async () => {
    const f = await makePrivacyFixture();
    const hash = `0x${"a".repeat(64)}` as const,
      calls: string[] = [];
    const send = vi.fn(async () => {
      calls.push("broadcast");
      return hash;
    });
    const authorization = {
      nonce: "0",
      deadline: "4102444800",
      signature: `0x${"1".repeat(130)}` as const,
    };
    const operation = {
      intent: await f.signApproval(),
      phase: "prepared" as const,
      txHash: null,
      updatedAt: new Date().toISOString(),
      registryAuthorization: authorization,
    };
    const signer = {
      address: f.owner,
      walletClient: {
        account: f.owner,
        chain: f.signer.walletClient.chain,
        getChainId: async () => 31337,
        sendTransaction: send,
      },
    } as unknown as typeof f.signer;
    expect(
      await submitRegistryRotationWallet(
        signer,
        operation,
        authorization,
        async (received) => {
          expect(received).toBe(hash);
          calls.push("persist");
        },
      ),
    ).toBe(hash);
    expect(calls).toEqual(["broadcast", "persist"]);
    expect(
      decodeFunctionData({
        abi: maweeRegistryAbi,
        data: send.mock.calls[0][0].data,
      }).functionName,
    ).toBe("setPubkeysFor");
    expect(send.mock.calls[0][0].to.toLowerCase()).toBe(
      f.registry.split(":")[1],
    );
  });
  it("does not prompt a wrong wallet, wrong chain or unpersisted authorization", async () => {
    const f = await makePrivacyFixture(),
      send = vi.fn();
    const authorization = {
      nonce: "0",
      deadline: "4102444800",
      signature: `0x${"1".repeat(130)}` as const,
    };
    const operation = {
      intent: await f.signApproval(),
      phase: "prepared" as const,
      txHash: null,
      updatedAt: new Date().toISOString(),
      registryAuthorization: authorization,
    };
    const signer = {
      address: f.owner,
      walletClient: {
        account: f.owner,
        getChainId: async () => 1,
        sendTransaction: send,
      },
    } as unknown as typeof f.signer;
    await expect(
      submitRegistryRotationWallet(
        signer,
        operation,
        authorization,
        async () => {},
      ),
    ).rejects.toThrow();
    await expect(
      submitRegistryRotationWallet(
        { ...signer, address: `0x${"2".repeat(40)}` },
        operation,
        authorization,
        async () => {},
      ),
    ).rejects.toThrow();
    await expect(
      submitRegistryRotationWallet(
        signer,
        { ...operation, registryAuthorization: undefined },
        authorization,
        async () => {},
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
