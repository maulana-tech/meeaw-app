// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUsers: vi.fn() }));
vi.mock("../src/server/db/mongo", () => ({ getUsers: mocks.getUsers }));
vi.mock("../src/server/lib/privy", () => ({ getPrivyUser: vi.fn() }));

import { WalletEscrowAlreadyInitializedError } from "../src/server/modules/wallets/wallets.errors";
import { passkeyRecord } from "../src/server/modules/wallets/wallets.schema";
import {
  getPasskey,
  saveEscrow,
  savePasskey,
} from "../src/server/modules/wallets/wallets.service";

const record = {
  credentialId: "Y3JlZGVudGlhbC1pZC0x",
  transports: ["internal", "hybrid"],
  viewPubkeyHex: "AB".repeat(32),
};

describe("passkey recovery records", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores only public passkey metadata, once, and never alongside a PIN escrow", async () => {
    const users = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: vi.fn(),
    };
    mocks.getUsers.mockResolvedValue(users);

    await savePasskey("did:privy:user", record);

    const [filter, update] = users.updateOne.mock.calls[0];
    expect(filter).toEqual({
      privyUserId: "did:privy:user",
      passkeyCredentialId: { $exists: false },
      encryptedMaster: { $exists: false },
    });
    expect(update.$set).toEqual({
      passkeyCredentialId: record.credentialId,
      passkeyTransports: record.transports,
      passkeyViewPubkey: "ab".repeat(32),
      updatedAt: expect.any(Date),
    });
  });

  it("refuses to replace an existing recovery method", async () => {
    const users = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
      findOne: vi.fn().mockResolvedValue({ passkeyCredentialId: "x" }),
    };
    mocks.getUsers.mockResolvedValue(users);
    await expect(savePasskey("did:privy:user", record)).rejects.toBeInstanceOf(
      WalletEscrowAlreadyInitializedError,
    );
  });

  it("blocks a PIN escrow on a passkey account", async () => {
    const users = {
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }),
      findOne: vi.fn().mockResolvedValue({ passkeyCredentialId: "x" }),
    };
    mocks.getUsers.mockResolvedValue(users);
    await expect(
      saveEscrow("did:privy:user", {
        encryptedMasterHex: "aa".repeat(60),
        masterSaltHex: "bb".repeat(16),
        kdfParams: { m: 19_456, t: 2, p: 1 },
      }),
    ).rejects.toBeInstanceOf(WalletEscrowAlreadyInitializedError);
    expect(users.updateOne.mock.calls[0][0]).toMatchObject({
      passkeyCredentialId: { $exists: false },
    });
  });

  it("returns the stored record", async () => {
    mocks.getUsers.mockResolvedValue({
      findOne: vi.fn().mockResolvedValue({
        passkeyCredentialId: record.credentialId,
        passkeyTransports: record.transports,
        passkeyViewPubkey: "ab".repeat(32),
      }),
    });
    await expect(getPasskey("did:privy:user")).resolves.toEqual({
      credentialId: record.credentialId,
      transports: record.transports,
      viewPubkeyHex: "ab".repeat(32),
    });
  });

  it("validates the record shape", () => {
    expect(passkeyRecord.safeParse(record).success).toBe(true);
    expect(
      passkeyRecord.safeParse({ ...record, credentialId: "not base64url!" })
        .success,
    ).toBe(false);
    expect(
      passkeyRecord.safeParse({ ...record, viewPubkeyHex: "ab" }).success,
    ).toBe(false);
    // Unknown fields (e.g. a smuggled secret) are rejected.
    expect(
      passkeyRecord.safeParse({ ...record, prfOutput: "aa".repeat(32) })
        .success,
    ).toBe(false);
  });
});
