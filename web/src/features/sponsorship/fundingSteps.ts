import type { MyNote } from "../../lib/notes";
import type { PoolScope } from "../../lib/pools";
import { nextFundingAction } from "../payments/funding";
import { nextGenerationFundingAction } from "../privacyKeys/generationFunding";
export function assertFundingSteps(
  notes: readonly MyNote[],
  amount: bigint,
  scope: PoolScope,
  limit: number,
  generation?: number,
) {
  let working = notes.map((n) => ({ ...n }));
  let index = working.reduce((max, n) => Math.max(max, n.leafIndex), -1) + 1;
  for (let step = 1; step <= limit; step++) {
    const action =
      generation === undefined
        ? nextFundingAction(working, amount, scope)
        : nextGenerationFundingAction(working, amount, scope, generation);
    if (action.kind === "payment") return;
    const ids =
      action.kind === "merge" ? action.inputIndices : [action.inputIndex];
    const inputs = working.filter((n) => ids.includes(n.leafIndex));
    const total = inputs.reduce((sum, n) => sum + n.amount, 0n);
    working = working.filter((n) => !ids.includes(n.leafIndex));
    const template = inputs[0];
    if (action.kind === "merge")
      working.push({ ...template, leafIndex: index++, amount: total });
    else {
      working.push({
        ...template,
        leafIndex: index++,
        amount: action.amount,
        keyGeneration:
          action.kind === "key-migrate"
            ? action.toGeneration
            : template.keyGeneration,
      });
      if (total > action.amount)
        working.push({
          ...template,
          leafIndex: index++,
          amount: total - action.amount,
        });
    }
  }
  throw new Error(
    "This payment needs too many preparation steps. Choose a smaller amount before sending.",
  );
}
