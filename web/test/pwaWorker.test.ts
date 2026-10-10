import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

type WorkerEvent = {
  waitUntil?: (work: Promise<void>) => void;
  request?: { url: string; method: string; mode: string };
  respondWith?: (response: Promise<Response>) => void;
};

function worker() {
  const handlers: Record<string, (event: WorkerEvent) => void> = {};
  const offline = new Response("offline fallback", {
    headers: { "Content-Type": "text/html" },
  });
  const cache = { put: vi.fn(), match: vi.fn(async () => offline) };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => ["meaw-offline-v0", "another-app"]),
    delete: vi.fn(async () => true),
  };
  const fetch = vi.fn(async () => new Response("live page"));
  const claim = vi.fn();
  runInNewContext(
    readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"),
    {
      self: {
        location: { origin: "https://meaw.test" },
        clients: { claim },
        addEventListener: (
          name: string,
          handler: (event: WorkerEvent) => void,
        ) => {
          handlers[name] = handler;
        },
      },
      caches,
      fetch,
      URL,
      Response,
    },
  );
  function navigation(path = "/dashboard", overrides = {}) {
    const respondWith = vi.fn();
    handlers.fetch({
      request: {
        url: `https://meaw.test${path}`,
        method: "GET",
        mode: "navigate",
        ...overrides,
      },
      respondWith,
    });
    return respondWith;
  }
  return { handlers, cache, caches, fetch, claim, navigation };
}

describe("PWA offline privacy boundary", () => {
  it("stores only a self-contained offline page at installation", async () => {
    const w = worker();
    let work: Promise<void> | undefined;
    w.handlers.install({
      waitUntil: (promise: Promise<void>) => {
        work = promise;
      },
    });
    await work;
    expect(w.fetch).toHaveBeenCalledWith("/offline.html", {
      cache: "reload",
      credentials: "omit",
    });
    expect(w.cache.put.mock.calls.map((args) => args[0])).toEqual([
      "/offline.html",
    ]);
  });
  it("returns live navigation without storing account HTML", async () => {
    const w = worker();
    const response = await w.navigation().mock.calls[0][0];
    expect(await response.text()).toBe("live page");
    expect(w.cache.put).not.toHaveBeenCalled();
    expect(w.cache.match).not.toHaveBeenCalled();
  });
  it("falls back offline without replaying a payment", async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new TypeError("offline"));
    const response = await w.navigation("/pay/alice/invoice").mock.calls[0][0];
    expect(await response.text()).toBe("offline fallback");
    expect(w.fetch).toHaveBeenCalledTimes(1);
    expect(w.cache.put).not.toHaveBeenCalled();
  });
  it.each([
    ["/api/trpc/deposits.snapshot", {}],
    ["/api/cron/pool-indexer", {}],
    ["/dashboard", { method: "POST" }],
    ["/dashboard?_rsc=secret", { mode: "cors" }],
    ["/zk/deposit.wasm", { mode: "cors" }],
    ["/dashboard", { url: "https://auth.example/dashboard" }],
  ])("does not intercept API, proofs, RSC or cross-origin requests: %s %j", (path, overrides) => {
    const w = worker();
    expect(w.navigation(path, overrides)).not.toHaveBeenCalled();
    expect(w.fetch).not.toHaveBeenCalled();
    expect(w.cache.put).not.toHaveBeenCalled();
  });
  it("does not disguise server errors as offline", async () => {
    const w = worker();
    w.fetch.mockResolvedValue(new Response("error", { status: 503 }));
    const response = await w.navigation().mock.calls[0][0];
    expect(response.status).toBe(503);
    expect(w.cache.match).not.toHaveBeenCalled();
  });
  it("removes only older Meaw offline caches on activation", async () => {
    const w = worker();
    let work: Promise<void> | undefined;
    w.handlers.activate({
      waitUntil: (promise: Promise<void>) => {
        work = promise;
      },
    });
    await work;
    expect(w.caches.delete).toHaveBeenCalledWith("meaw-offline-v0");
    expect(w.caches.delete).not.toHaveBeenCalledWith("another-app");
    expect(w.claim).toHaveBeenCalledOnce();
  });
});
