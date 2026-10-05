import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { Storage } from "happy-dom";
import { afterEach } from "vitest";

// Node 22+ defines a global localStorage that is undefined without
// --localstorage-file, and it shadows happy-dom's. Give DOM tests real ones.
if (typeof document !== "undefined") {
  for (const key of ["localStorage", "sessionStorage"] as const) {
    if (!globalThis[key]) {
      Object.defineProperty(globalThis, key, {
        value: new Storage(),
        configurable: true,
      });
    }
  }
}

// Unmount any React trees rendered during a test so DOM state doesn't leak
// between cases. No-op for node-environment (server) tests.
afterEach(() => {
  cleanup();
});
