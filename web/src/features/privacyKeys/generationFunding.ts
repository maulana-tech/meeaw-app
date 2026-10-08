import type { MyNote } from "../../lib/notes";
import type { PoolScope } from "../../lib/pools";
import type { FundingAction } from "../payments/funding";
import { assertKeyGeneration } from "./keyDerivation";
export type GenerationFundingAction =
  | FundingAction
  | {
      kind: "key-migrate";
      inputIndex: number;
      amount: bigint;
      fromGeneration: number;
      toGeneration: number;
    };
export function nextGenerationFundingAction(
  notes: readonly MyNote[],
  amount: bigint,
  scope: PoolScope,
  generation: number,
): GenerationFundingAction {
  assertKeyGeneration(generation);
  const max = (1n << 64n) - 1n;
  if (amount <= 0n || amount > max) throw new Error("Invalid payment amount");
  const eligible = notes.filter(
    (note) => note.scope === scope && !note.spent && note.amount > 0n,
  );
  const seen = new Set<number>();
  for (const note of eligible) {
    assertKeyGeneration(note.keyGeneration ?? 0);
    if (
      !Number.isInteger(note.leafIndex) ||
      note.leafIndex < 0 ||
      note.amount > max ||
      seen.has(note.leafIndex)
    )
      throw new Error("Private note funding is inconsistent");
    seen.add(note.leafIndex);
  }
  if (eligible.reduce((sum, note) => sum + note.amount, 0n) < amount)
    throw new Error("Your private balance is too low.");
  const target = eligible.filter(
    (note) => (note.keyGeneration ?? 0) === generation,
  );
  const covering = target
    .filter((note) => note.amount >= amount)
    .sort((a, b) =>
      a.amount === b.amount
        ? a.leafIndex - b.leafIndex
        : a.amount < b.amount
          ? -1
          : 1,
    );
  if (covering[0])
    return { kind: "payment", inputIndex: covering[0].leafIndex };
  const total = target.reduce((sum, note) => sum + note.amount, 0n);
  if (total < amount) {
    const old = eligible
      .filter((note) => (note.keyGeneration ?? 0) !== generation)
      .sort((a, b) =>
        a.amount === b.amount
          ? a.leafIndex - b.leafIndex
          : a.amount > b.amount
            ? -1
            : 1,
      )[0];
    if (!old) throw new Error("Your private balance is too low.");
    const deficit = amount - total;
    return {
      kind: "key-migrate",
      inputIndex: old.leafIndex,
      amount: old.amount < deficit ? old.amount : deficit,
      fromGeneration: old.keyGeneration ?? 0,
      toGeneration: generation,
    };
  }
  const ordered = [...target].sort((a, b) =>
    a.amount === b.amount
      ? a.leafIndex - b.leafIndex
      : a.amount > b.amount
        ? -1
        : 1,
  );
  let best: { a: MyNote; b: MyNote; sum: bigint } | undefined;
  for (let i = 0; i < ordered.length; i++)
    for (let j = i + 1; j < ordered.length; j++) {
      const sum = ordered[i].amount + ordered[j].amount;
      if (sum > max) continue;
      const candidate = { a: ordered[i], b: ordered[j], sum };
      if (
        !best ||
        (sum >= amount && best.sum < amount) ||
        (sum >= amount && best.sum >= amount && sum < best.sum) ||
        (sum < amount && best.sum < amount && sum > best.sum)
      )
        best = candidate;
    }
  if (best)
    return {
      kind: "merge",
      inputIndices: [best.a.leafIndex, best.b.leafIndex],
    };
  const [a, b] = ordered;
  if (!a || !b) throw new Error("Private funding preparation is incomplete");
  return { kind: "split", inputIndex: b.leafIndex, amount: amount - a.amount };
}
