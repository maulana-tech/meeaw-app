import { Binary } from "mongodb";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrivacyKeysRepository } from "../src/server/modules/privacyKeys/privacyKeys.repository";
import { createEscrowRecoveryGate } from "../src/server/modules/wallets/privacyRecovery";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";
import { openIsolatedRequestDb } from "./helpers/requestDb";

describe("recovery PIN generation fence", () => {
  let isolated: Awaited<ReturnType<typeof openIsolatedRequestDb>>;
  beforeAll(async () => {
    isolated = await openIsolatedRequestDb();
  });
  afterAll(async () => {
    await isolated?.close();
  });
  async function fixture(suffix: number) {
    const f = await makePrivacyFixture();
    f.state.registry = `31337:0x${suffix.toString(16).padStart(40, "0")}`;
    f.approval.registry = f.state.registry;
    const user = `pin-user-${suffix}`,
      users = isolated.db.collection("users");
    await users.deleteOne({ _id: f.owner as never });
    await users.insertOne({
      _id: f.owner as never,
      privyUserId: user,
      escrowRevision: 1,
      encryptedMaster: new Binary(Buffer.alloc(60, 1)),
      masterSalt: new Binary(Buffer.alloc(16, 2)),
      kdfParams: { m: 19456, t: 2, p: 1 },
    });
    const repo = new PrivacyKeysRepository(isolated.db);
    await repo.bootstrap(f.state);
    let failure: "before" | "after" | null = null;
    const write = vi.fn(
      async (
        id: string,
        input: {
          expectedRevision: number;
          escrow: {
            encryptedMasterHex: string;
            masterSaltHex: string;
            kdfParams: { m: number; t: number; p: number };
          };
        },
      ) => {
        if (failure === "before") throw new Error("response unavailable");
        const result = await users.updateOne(
          { privyUserId: id, escrowRevision: input.expectedRevision },
          {
            $set: {
              escrowRevision: input.expectedRevision + 1,
              encryptedMaster: new Binary(
                Buffer.from(input.escrow.encryptedMasterHex, "hex"),
              ),
              masterSalt: new Binary(
                Buffer.from(input.escrow.masterSaltHex, "hex"),
              ),
              kdfParams: input.escrow.kdfParams,
            },
          },
        );
        if (!result.matchedCount) throw new Error("revision conflict");
        if (failure === "after") throw new Error("response lost after commit");
        return { revision: input.expectedRevision + 1 };
      },
    );
    const replacement = {
      expectedRevision: 1,
      escrow: {
        encryptedMasterHex: "03".repeat(60),
        masterSaltHex: "04".repeat(16),
        kdfParams: { m: 19456, t: 2, p: 1 },
      },
    };
    return {
      ...f,
      user,
      repo,
      write,
      replacement,
      gate: createEscrowRecoveryGate(isolated.db, f.state.registry, write),
      fail(value: typeof failure) {
        failure = value;
      },
    };
  }
  it("blocks PIN changes while a privacy rotation is admitted", async () => {
    const f = await fixture(31);
    await f.repo.prepare(await f.signApproval());
    await expect(f.gate.change(f.user, f.replacement)).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled();
  });
  it("refuses setup of a replacement recovery root once public key history is established", async () => {
    const f = await fixture(36);
    await expect(f.gate.assertSetupAllowed(f.user)).rejects.toThrow();
    expect(f.write).not.toHaveBeenCalled();
  });
  it("confirms the exact escrow after a lost response before releasing its recovery ticket", async () => {
    const f = await fixture(32);
    f.fail("after");
    expect(await f.gate.change(f.user, f.replacement)).toEqual({ revision: 2 });
    expect(await f.repo.prepare(await f.signApproval())).toBeTruthy();
  });
  it("retains an unresolved recovery ticket and resumes the same encrypted replacement", async () => {
    const f = await fixture(33);
    f.fail("before");
    await expect(f.gate.change(f.user, f.replacement)).rejects.toThrow();
    await expect(f.repo.prepare(await f.signApproval())).rejects.toThrow();
    f.fail(null);
    await f.gate.recover(f.user);
    expect(f.write.mock.calls[1][1]).toEqual(f.replacement);
    expect(await f.repo.prepare(await f.signApproval())).toBeTruthy();
    const state = await f.repo.get(f.owner, f.state.registry);
    expect(JSON.stringify(state)).not.toContain(
      f.replacement.escrow.encryptedMasterHex,
    );
  });
  it("releases an already-applied recovery after interruption before ticket release", async () => {
    const f = await fixture(34);
    const release = vi
      .spyOn(PrivacyKeysRepository.prototype, "releaseTicket")
      .mockRejectedValueOnce(new Error("connection lost"));
    try {
      await expect(f.gate.change(f.user, f.replacement)).rejects.toThrow();
      await f.gate.recover(f.user);
      expect(await f.repo.prepare(await f.signApproval())).toBeTruthy();
    } finally {
      release.mockRestore();
    }
  });
  it("does not apply a PIN change later when its admission was conclusively rejected", async () => {
    const f = await fixture(35);
    const ticket = await f.repo.acquireTicket({
      owner: f.owner,
      registry: f.state.registry,
      revision: 1,
      fundingGeneration: 0,
      operationId: "send",
      kind: "spend",
    });
    await expect(f.gate.change(f.user, f.replacement)).rejects.toThrow();
    await f.repo.releaseTicket(ticket, "terminal");
    await f.gate.recover(f.user);
    expect(f.write).not.toHaveBeenCalled();
    expect(await f.repo.prepare(await f.signApproval())).toBeTruthy();
  });
});
