import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

// Node 22+ defines a global localStorage that is undefined without
// --localstorage-file, and it shadows happy-dom's. Give DOM tests real ones.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  const { Storage } = await import("happy-dom");
  for (const key of ["localStorage", "sessionStorage"] as const) {
    if (!globalThis[key]) {
      Object.defineProperty(globalThis, key, {
        value: new Storage(),
        configurable: true,
      });
    }
  }
  afterEach(() => {
    cleanup();
  });
}
