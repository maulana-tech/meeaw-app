import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import type { FeeEvidence, FrozenTx } from "../src/features/sponsorship/types";
import {
  accountedFee,
  maximumLiability,
  validateSignedTx,
} from "../src/server/modules/sponsorship/fees";

const signer = privateKeyToAccount(`0x${"01".repeat(32)}`);
const tx: FrozenTx = {
  chainId: 143,
  from: signer.address,
  to: "0x1111111111111111111111111111111111111111",
  nonce: 7,
  data: "0x1234",
  gas: 500_000n,
  value: 0n,
  fee: { type: 2, maxFeePerGas: 200n, maxPriorityFeePerGas: 10n },
};
const evidence: FeeEvidence = {
  hash: `0x${"a".repeat(64)}`,
  block: 10n,
  blockHash: `0x${"b".repeat(64)}`,
  blockTime: new Date("2026-10-08T00:00:00Z"),
  outcome: "reverted",
  gasUsed: 120_000n,
  effectiveGasPrice: 100n,
  transaction: tx,
};
async function sign(input: FrozenTx, account = signer) {
  return account.signTransaction({
    chainId: input.chainId,
    to: input.to,
    nonce: input.nonce,
    gas: input.gas,
    data: input.data,
    value: input.value,
    ...(input.fee.type === 2
      ? {
          type: "eip1559" as const,
          maxFeePerGas: input.fee.maxFeePerGas,
          maxPriorityFeePerGas: input.fee.maxPriorityFeePerGas,
        }
      : { type: "legacy" as const, gasPrice: input.fee.gasPrice }),
  });
}
describe("frozen sponsored fees", () => {
  it("accounts Monad gross gas limit, including reverts, and local consumed gas", () => {
    expect(maximumLiability(tx)).toBe(100_000_000n);
    expect(accountedFee(tx, evidence)).toBe(50_000_000n);
    const local = { ...tx, chainId: 31337 };
    expect(accountedFee(local, { ...evidence, transaction: local })).toBe(
      12_000_000n,
    );
  });
  it("preserves integer precision beyond JavaScript's safe number range", () => {
    const large = { ...tx, gas: 9_007_199_254_740_993n };
    expect(maximumLiability(large)).toBe(1_801_439_850_948_198_600n);
  });
  it.each([
    { ...tx, value: 1n },
    { ...tx, chainId: 1 },
    { ...tx, gas: 0n },
    { ...tx, fee: { type: 2, maxFeePerGas: 1n, maxPriorityFeePerGas: 2n } },
  ])("rejects non-allowed transaction bounds", (input) =>
    expect(() => maximumLiability(input as FrozenTx)).toThrow());
  it("rejects receipt gas or effective price outside signed limits", () => {
    expect(() =>
      accountedFee(tx, { ...evidence, gasUsed: 500_001n }),
    ).toThrow();
    expect(() =>
      accountedFee(tx, { ...evidence, effectiveGasPrice: 201n }),
    ).toThrow();
    expect(() =>
      accountedFee(tx, { ...evidence, transaction: { ...tx, nonce: 8 } }),
    ).toThrow();
  });
  it("validates real signed bytes against the complete frozen transaction", async () => {
    await expect(validateSignedTx(await sign(tx), tx)).resolves.toBeUndefined();
    const legacy: FrozenTx = { ...tx, fee: { type: 0, gasPrice: 200n } };
    await expect(
      validateSignedTx(await sign(legacy), legacy),
    ).resolves.toBeUndefined();
  });
  it("refuses changed signer, data, destination, fee, nonce or gas before publication", async () => {
    const bytes = await sign(tx);
    for (const changed of [
      { ...tx, from: "0x2222222222222222222222222222222222222222" as const },
      { ...tx, to: "0x3333333333333333333333333333333333333333" as const },
      { ...tx, data: "0x5678" as const },
      { ...tx, nonce: 8 },
      { ...tx, gas: 500_001n },
      {
        ...tx,
        fee: {
          type: 2 as const,
          maxFeePerGas: 201n,
          maxPriorityFeePerGas: 10n,
        },
      },
    ])
      await expect(validateSignedTx(bytes, changed)).rejects.toThrow();
    await expect(validateSignedTx("0x1234", tx)).rejects.toThrow();
  });
});
