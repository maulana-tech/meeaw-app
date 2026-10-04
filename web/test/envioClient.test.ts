// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EnvioQueryError,
  envioNotesAfter,
  envioQuery,
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

describe("Envio GraphQL client", () => {
  it("pages through notes with a leafIndex cursor", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, i) => note(i));
    fetchMock
      .mockResolvedValueOnce(ok({ Note: firstPage }))
      .mockResolvedValueOnce(ok({ Note: [note(1000), note(1001)] }));

    const notes = await envioNotesAfter(-1, 500);

    expect(notes).toHaveLength(1002);
    const second = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(second.variables).toMatchObject({ after: 999, maxBlock: 500 });
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
