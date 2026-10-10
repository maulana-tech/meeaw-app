import {
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  keccak256,
  type TransactionReceipt,
} from "viem";
import { afterEach, expect, it, vi } from "vitest";
import {
  makeRequestFixture,
  testPool,
  testSigner,
} from "./helpers/requestFixtures";
import { createSponsorSenderFixture } from "./helpers/sponsorshipSenderFixture";

const deps = vi.hoisted(() => ({
  db: null as unknown,
  runtime: null as unknown,
  ledger: null as unknown,
  wallet: "",
}));
vi.mock("../src/server/db/mongo", () => ({
  getDb: async () => deps.db,
  getPaymentRequests: async () =>
    (deps.db as import("mongodb").Db).collection("payment_requests"),
}));
vi.mock("../src/server/modules/wallets/wallets.service", () => ({
  currentWallet: async () => ({ address: deps.wallet }),
}));
vi.mock("../src/server/lib/durableRelayer", async (original) => ({
  ...(await original<typeof import("../src/server/lib/durableRelayer")>()),
  runtimeSender: async () => deps.runtime,
}));
vi.mock("../src/server/lib/relayer", () => ({
  relayerConfigured: () => true,
  relayerAddress: () =>
    (deps.runtime as { account: { address: string } }).account.address,
}));
vi.mock("../src/server/modules/sponsorship/sponsorship.service", () => ({
  sponsorshipLedger: async () => deps.ledger,
}));
vi.mock("../src/lib/pools", async (original) => ({
  ...(await original<typeof import("../src/lib/pools")>()),
  resolvePool: () => testPool,
}));

import {
  requestDigest,
  submissionTypedData,
} from "../src/features/requests/requestTypedData";
import type { SignedSubmission } from "../src/features/requests/types";
import { maweePoolAbi } from "../src/lib/abi";
import { __resetRateLimit } from "../src/server/lib/rateLimit";
import {
  beginPayment,
  reconcileRequestOperation,
  submitConsolidation,
  submitPayment,
} from "../src/server/modules/requests/requestOperations";
import { encodeSubmission } from "../src/server/modules/requests/requestSettlement";
import { toRequestDoc } from "../src/server/modules/requests/requests.repository";

let f: Awaited<ReturnType<typeof createSponsorSenderFixture>> | undefined;
afterEach(async () => {
  await f?.close();
  f = undefined;
});
const h = (i: number) => `0x${i.toString(16).padStart(64, "0")}` as Hex;
it("keeps request payment preparation and final payment inside one admitted action", async () => {
  __resetRateLimit();
  f = await createSponsorSenderFixture(31337);
  const fixture = await makeRequestFixture(),
    db = f.db,
    ledger = f.a,
    port = f.port,
    frozen = f.frozen;
  deps.db = db;
  deps.ledger = ledger;
  deps.wallet = fixture.record.addressee.wallet;
  await ledger.cancelUnsigned(f.action);
  await db
    .collection("payment_requests")
    .insertOne(
      toRequestDoc(
        fixture.record,
        requestDigest(fixture.record),
        new Date(),
      ) as never,
    );
  let accepted: SignedSubmission,
    receipt: TransactionReceipt | null = null;
  port.prepare.mockImplementation(async (intent, nonce) => ({
    ...frozen,
    to: intent.to,
    data: intent.data,
    nonce,
  }));
  port.receipt = async () => receipt;
  port.broadcast.mockImplementation(async (bytes) => {
    const txHash = keccak256(bytes),
      logs = [
        ...accepted.outputs.map((o, index) => ({
          address: testPool.address,
          removed: false,
          topics: encodeEventTopics({
            abi: maweePoolAbi,
            eventName: "Deposit",
            args: { leafIndex: index + accepted.step * 2 },
          }),
          data: encodeAbiParameters(
            [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }],
            [o.commitment, o.ephemeralPk, o.ciphertext],
          ),
        })),
        ...accepted.nullifiers.map((nullifier) => ({
          address: testPool.address,
          removed: false,
          topics: encodeEventTopics({
            abi: maweePoolAbi,
            eventName: "Spend",
            args: { nullifier },
          }),
          data: "0x" as Hex,
        })),
      ];
    receipt = {
      transactionHash: txHash,
      to: testPool.address,
      status: "success",
      blockNumber: 10n,
      blockHash: `0x${"b".repeat(64)}`,
      gasUsed: 50_000n,
      effectiveGasPrice: 100_000_000_000n,
      logs,
    } as TransactionReceipt;
    return txHash;
  });
  deps.runtime = {
    account: f.account,
    journal: f.journal,
    sender: f.sender,
    budget: { ledger },
    reader: {
      call: async () => {},
      getTransaction: async ({ hash }: { hash: Hex }) => ({
        hash,
        to: testPool.address,
        input: encodeSubmission(accepted),
      }),
      getBlockNumber: async () => 12n,
      getBlock: async () => ({ timestamp: 1791417600n }),
    },
  };
  const attemptId = crypto.randomUUID(),
    admitted = await beginPayment("payer", {
      id: fixture.record.id,
      revision: 0,
      attemptId,
    });
  expect(admitted.sponsorshipAction).toBeDefined();
  const signer = testSigner(2);
  for (const [step, kind] of (
    ["split", "merge", "payment"] as const
  ).entries()) {
    receipt = null;
    const output = {
      commitment:
        kind === "payment" ? fixture.record.recipientCommitment : h(20 + step),
      ephemeralPk: h(30 + step),
      ciphertext: "0x1234" as Hex,
    };
    const body = {
      version: 1 as const,
      requestId: fixture.record.id,
      operationId: attemptId,
      step,
      pool: testPool.scope,
      kind,
      root: h(1),
      nullifiers:
        kind === "merge" ? [h(40 + step), h(50 + step)] : [h(40 + step)],
      proof: {
        a: ["1", "2"] as const,
        b: [
          ["1", "2"],
          ["1", "2"],
        ] as const,
        c: ["1", "2"] as const,
      },
      outputs:
        kind === "merge"
          ? [output]
          : [output, { ...output, commitment: h(60 + step) }],
    };
    accepted = {
      ...body,
      signature: await signer.walletClient.signTypedData({
        account: signer.walletClient.account ?? signer.address,
        ...submissionTypedData(body),
      }),
    };
    await (kind === "payment" ? submitPayment : submitConsolidation)(
      "payer",
      accepted,
    );
    const result = await reconcileRequestOperation(attemptId);
    expect(result?.phase).toBe(kind === "payment" ? "confirmed" : "preparing");
    expect(result?.sponsorshipAction).toEqual(admitted.sponsorshipAction);
  }
  expect(await ledger.status({ kind: "user", key: "payer" })).toMatchObject({
    used: 1,
    reserved: 0,
  });
  expect((await ledger.repo.snapshot(31337)).usedWeiStr).toBe(
    "15000000000000000",
  );
});
