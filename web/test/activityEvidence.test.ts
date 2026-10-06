import { describe, expect, it } from "vitest";
import { encodeFunctionData, type TransactionReceipt } from "viem";
import { maweePoolAbi } from "../src/lib/abi";
import { parseActivityEvidence } from "../src/server/modules/deposits/activityEvidence";
import { testPool } from "./helpers/requestFixtures";
describe("public activity evidence", () => {
  it("rejects a receipt from another pool instead of inferring a cash-out", () => {
    const h = `0x${"11".repeat(32)}` as const;
    const data = encodeFunctionData({
      abi: maweePoolAbi,
      functionName: "withdraw",
      args: [
        testPool.address,
        10n,
        h,
        h,
        {
          a: [1n, 2n],
          b: [
            [1n, 2n],
            [1n, 2n],
          ],
          c: [1n, 2n],
        },
      ],
    });
    expect(
      parseActivityEvidence({
        pool: testPool,
        transaction: { hash: h, to: testPool.address, input: data },
        receipt: {
          to: "0x2222222222222222222222222222222222222222",
          transactionHash: h,
          status: "success",
          logs: [],
          blockNumber: 1n,
        } as unknown as TransactionReceipt,
        at: "2026-10-06T00:00:00.000Z",
      }),
    ).toBeNull();
  });
});
