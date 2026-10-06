import { describe, expect, it } from "vitest";
import {
  buildActivityRows,
  csvActivity,
} from "../src/features/payments/activityRows";
import { makeTransferFixture } from "./helpers/transferFixtures";
import { openTransfer } from "../src/features/transfers/transferCrypto";
describe("business activity", () => {
  it("shows one send without counting merge or change as income or cash-out", async () => {
    const f = await makeTransferFixture(),
      txHash = `0x${"11".repeat(32)}` as const,
      nf = `0x${"22".repeat(32)}` as const;
    const record = {
      ...f.record,
      status: "confirmed" as const,
      receipt: {
        txHash,
        leafIndex: 2,
        block: 1,
        confirmedAt: f.record.createdAt,
      },
    };
    const rows = buildActivityRows({
      notes: [
        {
          scope: f.pool.scope,
          leafIndex: 0,
          amount: 25_000_000n,
          salt: 1n,
          spent: true,
          nullifierHex: nf,
        },
        {
          scope: f.pool.scope,
          leafIndex: 3,
          amount: 5_000_000n,
          salt: 2n,
          spent: false,
        },
      ],
      transfers: [record],
      payloads: new Map([
        [record.id, await openTransfer(record, f.sender, f.pool)],
      ]),
      viewer: record.sender.wallet,
      evidence: [
        {
          scope: f.pool.scope,
          txHash,
          block: 1,
          at: record.createdAt,
          kind: "transfer",
          inputs: [nf],
          outputs: [
            { leafIndex: 2, commitment: record.recipientCommitment },
            { leafIndex: 3, commitment: `0x${"33".repeat(32)}` },
          ],
          withdrawAmount: null,
        },
      ],
    });
    expect(rows.filter((r) => r.kind === "sent").map((r) => r.amount)).toEqual([
      20_000_000n,
    ]);
    expect(rows.filter((r) => r.kind === "cashedOut")).toHaveLength(0);
    expect(
      rows.some((r) => r.kind === "received" && r.amount === 5_000_000n),
    ).toBe(false);
  });
  it("does not infer a cash-out solely from spent status", () => {
    const rows = buildActivityRows({
      notes: [
        {
          scope: "31337:0x1111111111111111111111111111111111111111",
          leafIndex: 0,
          amount: 10n,
          salt: 1n,
          spent: true,
        },
      ],
      transfers: [],
      payloads: new Map(),
      evidence: [],
      viewer: "0x2222222222222222222222222222222222222222",
    });
    expect(rows.some((r) => r.kind === "cashedOut")).toBe(false);
    expect(rows[0].kind).toBe("unclassified");
  });
  it("does not count recovered sender change as income when the source ciphertext is lost", async () => {
    const f = await makeTransferFixture(),
      txHash = `0x${"11".repeat(32)}` as const;
    const record = {
      ...f.record,
      status: "confirmed" as const,
      receipt: {
        txHash,
        leafIndex: 2,
        block: 1,
        confirmedAt: f.record.createdAt,
      },
    };
    const rows = buildActivityRows({
      notes: [
        {
          scope: f.pool.scope,
          leafIndex: 3,
          amount: 5_000_000n,
          salt: 2n,
          spent: false,
        },
      ],
      transfers: [record],
      payloads: new Map([
        [record.id, await openTransfer(record, f.sender, f.pool)],
      ]),
      viewer: record.sender.wallet,
      evidence: [
        {
          scope: f.pool.scope,
          txHash,
          block: 1,
          at: record.createdAt,
          kind: "transfer",
          inputs: [`0x${"22".repeat(32)}`],
          outputs: [
            { leafIndex: 2, commitment: record.recipientCommitment },
            { leafIndex: 3, commitment: `0x${"33".repeat(32)}` },
          ],
          withdrawAmount: null,
        },
      ],
    });
    expect(rows.filter((r) => r.kind === "received")).toHaveLength(0);
    expect(rows.filter((r) => r.kind === "sent").map((r) => r.amount)).toEqual([
      20_000_000n,
    ]);
  });
  it("escapes user CSV text and neutralizes formulas", () => {
    const csv = csvActivity([
      {
        id: "a",
        scope: "31337:0x1111111111111111111111111111111111111111",
        kind: "sent",
        status: "confirmed",
        amount: 1_000_000n,
        note: '=HYPERLINK("bad")',
        counterparty: "bob",
        at: "2026-10-06T00:00:00Z",
        txHash: null,
        leafIndex: null,
        locked: false,
        transferId: "a",
      },
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  });
});
