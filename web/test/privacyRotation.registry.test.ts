import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  keccak256,
  stringToHex,
  type TransactionReceipt,
} from "viem";
import { describe, expect, it } from "vitest";
import {
  registryAuthorizationTypedData,
  registryRotationCalldata,
} from "../src/features/privacyKeys/registryRotation";
import { maweeRegistryAbi } from "../src/lib/abi";
import {
  createRegistryTransactionFinder,
  createRegistryTransactionVerifier,
} from "../src/server/modules/privacyKeys/registryEvidence";
import { makePrivacyFixture } from "./helpers/privacyKeyFixtures";

describe("canonical registry rotation evidence", () => {
  async function fixture() {
    const f = await makePrivacyFixture(),
      intent = await f.signApproval();
    const unsigned = { nonce: "0", deadline: "4102444800" };
    const authorization = {
      ...unsigned,
      signature: await f.signer.walletClient.signTypedData({
        ...registryAuthorizationTypedData(intent, unsigned),
        account: f.signer.walletClient.account ?? f.owner,
      }),
    };
    const hash = `0x${"a".repeat(64)}` as Hex,
      blockHash = `0x${"2".repeat(64)}` as Hex;
    const registry = f.registry.split(":")[1] as Hex;
    const log = {
      address: registry,
      topics: encodeEventTopics({
        abi: maweeRegistryAbi,
        eventName: "PubkeysRotated",
        args: {
          owner: f.owner,
          usernameHash: keccak256(stringToHex(f.username)),
        },
      }),
      data: encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [f.keys[1].notePubkey, f.keys[1].viewPubkey],
      ),
      blockNumber: 11n,
      blockHash,
      transactionHash: hash,
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
    };
    let receipt = {
      status: "success",
      transactionHash: hash,
      blockNumber: 11n,
      blockHash,
      logs: [log],
    } as unknown as TransactionReceipt;
    let transaction = {
      to: registry,
      from: f.owner,
      input: registryRotationCalldata(intent, authorization),
    };
    let canonical = blockHash,
      head = 12n;
    const verify = createRegistryTransactionVerifier({
      chainId: 31337,
      registry,
      confirmations: 2,
      receipt: async () => receipt,
      transaction: async () => transaction,
      blockHash: async () => canonical,
      head: async () => head,
      registryAt: async () => ({ owner: f.owner, keys: f.keys[1], nonce: "1" }),
      allowedSenders: [f.owner],
    });
    return {
      ...f,
      intent,
      authorization,
      hash,
      verify,
      setReceipt(value: TransactionReceipt) {
        receipt = value;
      },
      receipt,
      reorg() {
        canonical = `0x${"3".repeat(64)}`;
      },
      unconfirmed() {
        head = 11n;
      },
      substitute() {
        transaction = {
          ...transaction,
          input: registryRotationCalldata(
            { ...intent, newKeys: f.keys[0] },
            authorization,
          ),
        };
      },
    };
  }
  it("confirms only the exact owner/pair/authorization at a canonical confirmed block", async () => {
    const f = await fixture();
    expect(await f.verify(f.hash, f.intent, f.authorization)).toEqual({
      state: "confirmed",
      evidence: { block: 11, blockHash: f.receipt.blockHash, txHash: f.hash },
    });
  });
  it("refuses insufficient confirmations, reorgs and calldata/event substitution", async () => {
    for (const scenario of ["reorg", "unconfirmed", "substitute"] as const) {
      const f = await fixture();
      f[scenario]();
      expect((await f.verify(f.hash, f.intent, f.authorization)).state).toBe(
        "unknown",
      );
    }
    const f = await fixture();
    f.setReceipt({ ...f.receipt, logs: [] });
    expect((await f.verify(f.hash, f.intent, f.authorization)).state).toBe(
      "unknown",
    );
  });
  it("bounds lost-hash event searches and resumes using a canonical cursor", async () => {
    const f = await fixture(),
      ranges: [number, number][] = [];
    const anchor = f.receipt.blockHash;
    const finder = createRegistryTransactionFinder({
      confirmations: 2,
      head: async () => 700n,
      blockHash: async () => anchor,
      logs: async (from, to) => {
        ranges.push([from, to]);
        return [];
      },
      matchesTransaction: async () => false,
    });
    const op = {
      intent: f.intent,
      phase: "needsReconciliation" as const,
      txHash: null,
      updatedAt: new Date().toISOString(),
      registryAuthorization: f.authorization,
      authorizationEvidence: { block: 10, blockHash: anchor, txHash: null },
    };
    const first = await finder(op);
    expect(ranges).toEqual([
      [10, 109],
      [110, 209],
      [210, 309],
    ]);
    expect(first.scanned?.block).toBe(309);
    ranges.length = 0;
    await finder({ ...op, searchEvidence: first.scanned });
    expect(ranges[0][0]).toBe(310);
  });
});
