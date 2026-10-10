import { expect, it } from "vitest";
import { assertFundingSteps } from "../src/features/sponsorship/fundingSteps";
import { testPool } from "./helpers/requestFixtures";

const notes = (n: number, g = 0) =>
  Array.from({ length: n }, (_, leafIndex) => ({
    scope: testPool.scope,
    leafIndex,
    amount: 1n,
    salt: 1n,
    spent: false,
    keyGeneration: g,
  }));
it("counts final payment and every merge for exact-fit and one-over funding", () => {
  expect(() =>
    assertFundingSteps(notes(16), 16n, testPool.scope, 16),
  ).not.toThrow();
  expect(() => assertFundingSteps(notes(17), 17n, testPool.scope, 16)).toThrow(
    "smaller",
  );
});
it("counts retained-generation migrations before merges and payment", () => {
  expect(() =>
    assertFundingSteps(notes(2), 2n, testPool.scope, 4, 1),
  ).not.toThrow();
  expect(() => assertFundingSteps(notes(2), 2n, testPool.scope, 3, 1)).toThrow(
    "smaller",
  );
});
