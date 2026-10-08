import { describe, expect, it } from "vitest";
import { nextGenerationFundingAction } from "../src/features/privacyKeys/generationFunding";
import type { MyNote } from "../src/lib/notes";
import { testPool } from "./helpers/requestFixtures";

const note = (
  leafIndex: number,
  amount: bigint,
  keyGeneration: number,
): MyNote => ({
  scope: testPool.scope,
  leafIndex,
  amount,
  keyGeneration,
  salt: BigInt(leafIndex + 10),
  spent: false,
});
describe("generation-separated private funding", () => {
  it("moves only the target deficit, and uses sufficient target funds before old funds", () => {
    const notes = [note(0, 15_000_000n, 0), note(1, 5_000_000n, 1)];
    expect(
      nextGenerationFundingAction(notes, 20_000_000n, testPool.scope, 1),
    ).toEqual({
      kind: "key-migrate",
      inputIndex: 0,
      amount: 15_000_000n,
      fromGeneration: 0,
      toGeneration: 1,
    });
    expect(
      nextGenerationFundingAction(notes, 5_000_000n, testPool.scope, 1),
    ).toEqual({ kind: "payment", inputIndex: 1 });
    expect(
      nextGenerationFundingAction(
        [note(0, 100n, 0), note(1, 5n, 1)],
        20n,
        testPool.scope,
        1,
      ),
    ).toMatchObject({ kind: "key-migrate", amount: 15n });
  });
  it("merges only target-generation notes and never borrows another pool", () => {
    expect(
      nextGenerationFundingAction(
        [note(0, 15n, 1), note(1, 5n, 1)],
        20n,
        testPool.scope,
        1,
      ),
    ).toEqual({ kind: "merge", inputIndices: [0, 1] });
    expect(() =>
      nextGenerationFundingAction(
        [
          {
            ...note(0, 20n, 0),
            scope: "31337:0x5555555555555555555555555555555555555555",
          },
        ],
        20n,
        testPool.scope,
        1,
      ),
    ).toThrow();
    expect(() =>
      nextGenerationFundingAction([note(0, 20n, 64)], 20n, testPool.scope, 1),
    ).toThrow();
  });
  it("uses an exact prepared pair before splitting a large remainder again", () => {
    const max = (1n << 64n) - 1n;
    expect(
      nextGenerationFundingAction(
        [note(0, max - 5n, 1), note(1, 1000n, 1)],
        max - 2n,
        testPool.scope,
        1,
      ),
    ).toEqual({ kind: "split", inputIndex: 1, amount: 3n });
    expect(
      nextGenerationFundingAction(
        [note(0, max - 5n, 1), note(2, 997n, 1), note(3, 3n, 1)],
        max - 2n,
        testPool.scope,
        1,
      ),
    ).toEqual({ kind: "merge", inputIndices: [0, 3] });
  });
});
