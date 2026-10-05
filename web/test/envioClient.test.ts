// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnvioQueryError,
  envioNotesAfter,
  envioNullifiersBetween,
  envioPoolStats,
  envioQuery,
  envioRegistryAccounts,
} from "../src/server/lib/envio";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("ENVIO_GRAPHQL_URL", "https://indexer.example/v1/graphql");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ok = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as Response;

const note = (leafIndex: number) => ({
  leafIndex,
  commitment: "0x01",
  ephemeralPk: "0x02",
  ciphertext: "0x03",
  blockNumber: 1,
  timestamp: 1,
  txHash: "0x04",
});

const SCOPE = "10143:0x00000000000000000000000000000000000000b0";

describe("Envio GraphQL client", () => {
  it("pages through one pool's notes with a leafIndex cursor", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => note(i));
    fetchMock
      .mockResolvedValueOnce(ok({ Note: firstPage }))
      .mockResolvedValueOnce(ok({ Note: [note(1000), note(1001)] }));

    const notes = await envioNotesAfter(SCOPE, -1, 500);

    expect(notes).toHaveLength(1002);
    const first = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(first.query).toContain("pool: { _eq: $pool }");
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.variables).toMatchObject({
      pool: SCOPE,
      after: 999,
      maxBlock: 500,
    });
  });

  it("filters spent nullifiers by pool and returns the bare nullifier", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        Nullifier: [{ nullifier: "aa".repeat(32), blockNumber: 3, timestamp: 1 }],
      }),
    );
    const rows = await envioNullifiersBetween(SCOPE, 0, 10);
    expect(rows[0].nullifier).toBe("aa".repeat(32));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toContain("pool: { _eq: $pool }");
    expect(body.variables).toMatchObject({ pool: SCOPE, after: 0, maxBlock: 10 });
  });

  it("reads stats by pool scope and accounts by registry scope", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ PoolStats: [{ notes: 1, merges: 2 }] }))
      .mockResolvedValueOnce(ok({ RegistryStats: [{ accounts: 4 }] }));
    await expect(envioPoolStats(SCOPE)).resolves.toMatchObject({ merges: 2 });
    await expect(envioRegistryAccounts("10143:0xre")).resolves.toBe(4);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).variables).toEqual({
      pool: SCOPE,
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).variables).toEqual({
      registry: "10143:0xre",
    });
  });

  it("surfaces GraphQL errors", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: "field not found" }] }),
    } as Response);
    await expect(envioQuery("{ x }")).rejects.toThrow(
      new EnvioQueryError("field not found"),
    );
  });

  it("surfaces HTTP failures", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(envioQuery("{ x }")).rejects.toThrow("Envio responded 503");
  });

  it("refuses to query when unconfigured", async () => {
    vi.stubEnv("ENVIO_GRAPHQL_URL", "");
    await expect(envioQuery("{ x }")).rejects.toThrow("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
