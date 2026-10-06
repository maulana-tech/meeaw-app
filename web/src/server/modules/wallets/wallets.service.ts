import "server-only";

import { Binary } from "mongodb";
import { getAddress } from "viem";
import { getUsers, type UserDoc } from "../../db/mongo";
import { getPrivyUser } from "../../lib/privy";
import {
  WalletConflictError,
  WalletEscrowAlreadyInitializedError,
  WalletEscrowMissingError,
  WalletEscrowRevisionConflictError,
  WalletMigrationError,
} from "./wallets.errors";
import type {
  EscrowOutput,
  PasskeyRecord,
  PrivyWalletInput,
  RotateEscrowInput,
  RotateEscrowOutput,
  SaveEscrowInput,
  WalletOutput,
} from "./wallets.schema";

// On Monad a Mawee account is simply the user's Privy embedded Ethereum
// wallet (an EOA). The server only records which Privy identity owns which
// address, plus the PIN-encrypted master escrow used to restore note keys.

function binary(value: string): Binary {
  return new Binary(Buffer.from(value, "hex"));
}

function hex(value: Binary): string {
  return Buffer.from(value.buffer).toString("hex");
}

function output(doc: UserDoc): WalletOutput {
  return { address: getAddress(doc._id) };
}

type PrivyLinkedAccount = {
  type?: string;
  id?: string | null;
  address?: string;
  chain_type?: string;
  wallet_client_type?: string;
  connector_type?: string;
};

/** Embedded Ethereum wallets Privy says belong to this identity. */
export async function verifiedPrivyWallets(
  privyUserId: string,
): Promise<{ address: string; id?: string }[]> {
  const user = await getPrivyUser(privyUserId);
  const wallets = new Map<string, { address: string; id?: string }>();
  for (const account of user.linked_accounts) {
    const candidate = account as unknown as PrivyLinkedAccount;
    if (
      candidate.type !== "wallet" ||
      candidate.chain_type !== "ethereum" ||
      candidate.wallet_client_type !== "privy" ||
      candidate.connector_type !== "embedded" ||
      !candidate.address
    ) {
      continue;
    }
    let address: string;
    try {
      address = getAddress(candidate.address);
    } catch {
      continue;
    }
    if (!wallets.has(address)) {
      wallets.set(address, { address, id: candidate.id ?? undefined });
    }
  }
  return [...wallets.values()];
}

export async function assertPrivyWalletOwned(
  privyUserId: string,
  wallet: PrivyWalletInput,
): Promise<{ address: string; id?: string }> {
  const match = (await verifiedPrivyWallets(privyUserId)).find(
    (candidate) => candidate.address === getAddress(wallet.address),
  );
  if (!match) {
    throw new WalletConflictError(
      "The submitted wallet is not a Privy embedded wallet linked to this identity.",
    );
  }
  return match;
}

export async function restoreWallet(
  privyUserId: string,
): Promise<WalletOutput | null> {
  const users = await getUsers();
  const existing = await users.findOne({ privyUserId });
  if (existing) return output(existing);

  // Privy can issue a replacement DID when identities are linked or merged.
  // Reopen the account bound to an embedded wallet this identity still owns.
  const wallets = await verifiedPrivyWallets(privyUserId);
  if (wallets.length === 0) return null;
  const matches = await users
    .find({ _id: { $in: wallets.map((w) => w.address) } })
    .limit(2)
    .toArray();
  if (matches.length > 1) {
    throw new WalletConflictError(
      "Multiple Mawee accounts match wallets on this Privy identity.",
    );
  }
  const previous = matches[0];
  if (!previous) return null;
  try {
    const restored = await users.findOneAndUpdate(
      { _id: previous._id, privyUserId: previous.privyUserId },
      { $set: { privyUserId, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!restored) throw new WalletConflictError();
    return output(restored);
  } catch (error) {
    if ((error as { code?: number }).code === 11000)
      throw new WalletConflictError();
    throw error;
  }
}

export async function bootstrapWallet(
  privyUserId: string,
  wallet: PrivyWalletInput,
): Promise<WalletOutput> {
  const restored = await restoreWallet(privyUserId);
  if (restored) {
    if (restored.address !== getAddress(wallet.address)) {
      throw new WalletConflictError(
        "This Privy identity is already bound to a different wallet.",
      );
    }
    return restored;
  }

  const verified = await assertPrivyWalletOwned(privyUserId, wallet);
  const users = await getUsers();
  const now = new Date();
  try {
    await users.updateOne(
      { _id: verified.address },
      {
        $set: {
          ...(verified.id ? { privyWalletId: verified.id } : {}),
          updatedAt: now,
        },
        $setOnInsert: { privyUserId, createdAt: now },
      },
      { upsert: true },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new WalletConflictError();
    }
    throw error;
  }
  const created = await users.findOne({ _id: verified.address });
  if (!created || created.privyUserId !== privyUserId) {
    throw new WalletConflictError();
  }
  return output(created);
}

export async function currentWallet(
  privyUserId: string,
): Promise<WalletOutput | null> {
  const doc = await (await getUsers()).findOne({ privyUserId });
  return doc ? output(doc) : null;
}

export async function saveEscrow(
  privyUserId: string,
  input: SaveEscrowInput,
): Promise<void> {
  const users = await getUsers();
  const result = await users.updateOne(
    {
      privyUserId,
      // A passkey account derives its keys from the passkey; a PIN escrow
      // would be a second, different master.
      passkeyCredentialId: { $exists: false },
      $or: [
        { encryptedMaster: { $exists: false } },
        { masterSalt: { $exists: false } },
        { kdfParams: { $exists: false } },
      ],
    },
    {
      $set: {
        encryptedMaster: binary(input.encryptedMasterHex),
        masterSalt: binary(input.masterSaltHex),
        kdfParams: input.kdfParams,
        escrowRevision: 1,
        updatedAt: new Date(),
      },
    },
  );
  if (result.matchedCount === 1) return;
  if (!(await users.findOne({ privyUserId }))) {
    throw new WalletMigrationError(
      "No Mawee wallet is linked to this Privy identity.",
    );
  }
  throw new WalletEscrowAlreadyInitializedError();
}

export async function rotateEscrow(
  privyUserId: string,
  input: RotateEscrowInput,
): Promise<RotateEscrowOutput> {
  const users = await getUsers();
  const revision = input.expectedRevision + 1;
  const result = await users.updateOne(
    {
      privyUserId,
      encryptedMaster: { $exists: true },
      masterSalt: { $exists: true },
      kdfParams: { $exists: true },
      escrowRevision: input.expectedRevision,
    },
    {
      $set: {
        encryptedMaster: binary(input.escrow.encryptedMasterHex),
        masterSalt: binary(input.escrow.masterSaltHex),
        kdfParams: input.escrow.kdfParams,
        escrowRevision: revision,
        updatedAt: new Date(),
      },
    },
  );
  if (result.matchedCount === 1) return { revision };

  const doc = await users.findOne({ privyUserId });
  if (!doc?.encryptedMaster || !doc.masterSalt || !doc.kdfParams) {
    throw new WalletEscrowMissingError();
  }
  throw new WalletEscrowRevisionConflictError();
}

export async function getEscrow(privyUserId: string): Promise<EscrowOutput> {
  const doc = await (await getUsers()).findOne({ privyUserId });
  if (!doc?.encryptedMaster || !doc.masterSalt || !doc.kdfParams) return null;
  return {
    encryptedMasterHex: hex(doc.encryptedMaster),
    masterSaltHex: hex(doc.masterSalt),
    kdfParams: doc.kdfParams,
    revision: doc.escrowRevision ?? 1,
  };
}

/**
 * Records which passkey protects this account. Only public data is stored;
 * the keys are re-derived from the passkey's PRF output on each device.
 * Write-once, and exclusive with PIN escrow.
 */
export async function savePasskey(
  privyUserId: string,
  input: PasskeyRecord,
): Promise<void> {
  const users = await getUsers();
  const result = await users.updateOne(
    {
      privyUserId,
      passkeyCredentialId: { $exists: false },
      encryptedMaster: { $exists: false },
    },
    {
      $set: {
        passkeyCredentialId: input.credentialId,
        passkeyTransports: input.transports,
        passkeyViewPubkey: input.viewPubkeyHex.toLowerCase(),
        updatedAt: new Date(),
      },
    },
  );
  if (result.matchedCount === 1) return;
  if (!(await users.findOne({ privyUserId }))) {
    throw new WalletMigrationError(
      "No Mawee wallet is linked to this Privy identity.",
    );
  }
  throw new WalletEscrowAlreadyInitializedError();
}

export async function getPasskey(
  privyUserId: string,
): Promise<PasskeyRecord | null> {
  const doc = await (await getUsers()).findOne({ privyUserId });
  if (!doc?.passkeyCredentialId || !doc.passkeyViewPubkey) return null;
  return {
    credentialId: doc.passkeyCredentialId,
    transports: doc.passkeyTransports ?? [],
    viewPubkeyHex: doc.passkeyViewPubkey,
  };
}
