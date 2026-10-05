import { describe, expect, it } from "vitest";
import {
  mirrorScope,
  parsePoolManifest,
  scopedLeafId,
  scopeKey,
} from "../src/lib/pools";

const OLD = "0x1111111111111111111111111111111111111111";
const NEW = "0x2222222222222222222222222222222222222222";
const USDC = "0x3333333333333333333333333333333333333333";

const entry = (address: string, role: "active" | "legacy", extra = {}) => ({
  chainId: 10143,
  address,
  deployBlock: 5,
  token: USDC,
  tokenDecimals: 6,
  depth: 20,
  confirmations: 1,
  role,
  requestCapable: role === "active",
  ...extra,
});

const legacyEnv = {
  address: OLD,
  deployBlock: 7,
  token: USDC,
  tokenDecimals: 6,
};

function parse(manifest: unknown[] | undefined) {
  return parsePoolManifest({
    manifest: manifest ? JSON.stringify(manifest) : undefined,
    chainId: 10143,
    legacy: legacyEnv,
  });
}

describe("pool manifest", () => {
  it("separates the same leaf index in different pools", () => {
    const a = scopeKey(31337, "0x1111111111111111111111111111111111111111");
    const b = scopeKey(31337, "0x2222222222222222222222222222222222222222");
    expect(a).not.toBe(b);
    expect(scopedLeafId(a, 0)).not.toBe(scopedLeafId(b, 0));
    expect(() => scopedLeafId(a, -1)).toThrow();
    expect(() => scopedLeafId(a, 1.5)).toThrow();
  });

  it("normalizes scopes to lowercase addresses", () => {
    expect(scopeKey(10143, "0xAbCdEf0000000000000000000000000000000000")).toBe(
      "10143:0xabcdef0000000000000000000000000000000000",
    );
  });

  it("treats old environment variables as one pool that cannot take requests", () => {
    const pools = parse(undefined);
    expect(pools).toHaveLength(1);
    expect(pools[0]).toMatchObject({
      scope: `10143:${OLD}`,
      deployBlock: 7,
      role: "active",
      requestCapable: false,
      depth: 20,
      confirmations: 1,
    });
  });

  it("accepts one active request pool alongside legacy pools", () => {
    const pools = parse([entry(NEW, "active"), entry(OLD, "legacy")]);
    expect(pools.map((p) => [p.scope, p.role, p.requestCapable])).toEqual([
      [`10143:${NEW}`, "active", true],
      [`10143:${OLD}`, "legacy", false],
    ]);
    // IndexedDB mirrors keep their original key format per pool.
    expect(mirrorScope(pools[1])).toBe(`eip155:10143:${OLD}`);
  });

  it("rejects duplicate pools, zero or two active pools and wrong chains", () => {
    expect(() =>
      parse([
        entry(NEW, "active"),
        entry(NEW.toUpperCase().replace("0X", "0x"), "legacy"),
      ]),
    ).toThrow();
    expect(() =>
      parse([entry(NEW, "legacy", { requestCapable: false })]),
    ).toThrow();
    expect(() => parse([entry(NEW, "active"), entry(OLD, "active")])).toThrow();
    expect(() => parse([entry(NEW, "active", { chainId: 143 })])).toThrow();
    expect(() => parse([entry(NEW, "active", { depth: 24 })])).toThrow();
  });

  it("never lets a legacy pool accept requests", () => {
    expect(() =>
      parse([
        entry(NEW, "active"),
        entry(OLD, "legacy", { requestCapable: true }),
      ]),
    ).toThrow();
  });

  it("rejects unknown fields such as RPC URLs and oversized manifests", () => {
    expect(() =>
      parse([entry(NEW, "active", { rpcUrl: "https://key@rpc.example" })]),
    ).toThrow();
    expect(() =>
      parsePoolManifest({
        manifest: "x".repeat(9000),
        chainId: 10143,
        legacy: legacyEnv,
      }),
    ).toThrow();
    expect(() =>
      parsePoolManifest({
        manifest: "{not json",
        chainId: 10143,
        legacy: legacyEnv,
      }),
    ).toThrow();
  });
});
