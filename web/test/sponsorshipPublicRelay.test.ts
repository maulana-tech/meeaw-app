import { describe, expect, it } from "vitest";
import type { Context } from "../src/server/context";
import { ordinaryBusinessIdentity } from "../src/server/modules/sponsorship/ordinaryIdentity";
import { principalFromContext } from "../src/server/modules/sponsorship/principals";

const guest: Context = {
  ip: "127.0.0.1",
  authToken: null,
  privyUserId: null,
  privyClaim: null,
  authError: null,
};
const wallet = "0x1111111111111111111111111111111111111111" as const;
describe("public sponsorship identity", () => {
  it("uses verified optional auth without trusting an unverified user id", () => {
    expect(principalFromContext({ ...guest, privyUserId: "alice" })).toEqual({
      kind: "anonymous",
      key: "shared",
    });
    expect(
      principalFromContext({
        ...guest,
        privyUserId: "alice",
        privyClaim: { user_id: "bob" } as Context["privyClaim"],
      }),
    ).toEqual({ kind: "anonymous", key: "shared" });
    expect(
      principalFromContext({
        ...guest,
        privyUserId: "alice",
        privyClaim: { user_id: "alice" } as Context["privyClaim"],
      }),
    ).toEqual({ kind: "user", key: "alice" });
    expect(principalFromContext(guest, wallet)).toEqual({
      kind: "guest-wallet",
      key: wallet,
    });
  });
  it("does not use an anonymous withdrawal destination as spender identity", () => {
    expect(principalFromContext(guest)).toEqual({
      kind: "anonymous",
      key: "shared",
    });
  });
  it("gives retries with new proof randomness the same business identity", () => {
    const base = {
      pool: `143:${wallet}`,
      recipient: wallet,
      nullifier: `0x${"a".repeat(64)}`,
      amount: 10n,
    };
    const one = ordinaryBusinessIdentity("withdraw", {
      ...base,
      proof: { a: [1n, 2n] },
    });
    expect(
      ordinaryBusinessIdentity("withdraw", { ...base, proof: { a: [3n, 4n] } }),
    ).toEqual(one);
    expect(
      ordinaryBusinessIdentity("withdraw", {
        ...base,
        recipient: "0x2222222222222222222222222222222222222222",
      }),
    ).not.toEqual(one);
  });
});
