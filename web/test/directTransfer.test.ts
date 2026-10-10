import { describe, expect, it } from "vitest";
import {
  runDirectTransfer,
  type TransferRunnerPort,
} from "../src/features/transfers/directTransferRunner";
import { commitment, ownerPk } from "../src/lib/crypto";
import { makeTransferFixture } from "./helpers/transferFixtures";

describe("direct transfer client session", () => {
  it.each([
    16, 17,
  ])("checks %i funding steps before any Send child", async (count) => {
    const f = await makeTransferFixture(BigInt(count));
    let built = 0;
    await expect(
      runDirectTransfer(
        { record: f.record, account: f.sender, pool: f.pool, signer: f.signer },
        {
          isCurrent: () => true,
          operation: async () => ({
            ...f.operation,
            sponsorshipAction: {
              chainId: 31337,
              actionId: "send:test",
              fence: 1,
            },
          }),
          scan: async () => ({
            scope: f.pool.scope,
            health: "healthy",
            notes: Array.from({ length: count }, (_, leafIndex) => ({
              scope: f.pool.scope,
              leafIndex,
              amount: 1n,
              salt: 1n,
              spent: false,
            })),
            leaves: [],
            claimable: BigInt(count),
            mirrorAvailable: true,
            indexedAt: new Date().toISOString(),
          }),
          build: async () => {
            built++;
            throw Error("built");
          },
          submit: async () => f.operation,
          tick: () => {},
        },
      ),
    ).rejects.toThrow(count === 17 ? "smaller" : "built");
    expect(built).toBe(count === 17 ? 0 : 1);
  });
  it("retains a sponsorship pause without building another preparation step", async () => {
    const f = await makeTransferFixture();
    let scans = 0;
    const paused = { ...f.operation, sponsorshipPause: "budget" as const };
    const result = await runDirectTransfer(
      { record: f.record, account: f.sender, pool: f.pool, signer: f.signer },
      {
        isCurrent: () => true,
        operation: async () => paused,
        scan: async () => {
          scans++;
          throw Error("A paused action must not prepare notes");
        },
        build: async () => {
          throw Error("Paused");
        },
        submit: async () => {
          throw Error("Paused");
        },
        tick: () => {},
      },
    );
    expect(result).toBe(paused);
    expect(scans).toBe(0);
  });
  it("discards a completed proof when the account changes", async () => {
    const f = await makeTransferFixture(),
      pk = await ownerPk(f.sender.ownerSecret);
    let current = true,
      submitted = 0;
    const port: TransferRunnerPort = {
      isCurrent: () => current,
      operation: async () => f.operation,
      scan: async () => ({
        scope: f.pool.scope,
        notes: [
          {
            scope: f.pool.scope,
            leafIndex: 0,
            amount: 25_000_000n,
            salt: 1n,
            spent: false,
          },
        ],
        leaves: [await commitment(25_000_000n, pk, 1n)],
        claimable: 25_000_000n,
        mirrorAvailable: true,
        indexedAt: new Date().toISOString(),
        health: "healthy",
      }),
      build: async () => {
        current = false;
        return {} as never;
      },
      submit: async () => {
        submitted++;
        return f.operation;
      },
      tick: () => {},
    };
    expect(
      await runDirectTransfer(
        { record: f.record, account: f.sender, pool: f.pool, signer: f.signer },
        port,
      ),
    ).toBeNull();
    expect(submitted).toBe(0);
  });
});
