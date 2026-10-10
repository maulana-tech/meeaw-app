import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const rootEnv = path.join(repoRoot, ".env");
if (fs.existsSync(rootEnv)) {
  const lines = fs.readFileSync(rootEnv, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;

    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] ??= value;
  }
}

const localBuild = process.env.MAWEE_BUILD_TARGET === "local";
/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/i/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/dashboard/links",
        destination: "/links",
        permanent: true,
      },
      {
        source: "/dashboard/withdraw",
        destination: "/withdraw",
        permanent: true,
      },
      {
        source: "/dashboard/history",
        destination: "/history",
        permanent: true,
      },
    ];
  },
  // Emit a self-contained server bundle for the Docker runtime image. Combined
  // with outputFileTracingRoot (the monorepo root), the standalone output lands
  // at web/.next/standalone/web/server.js with node_modules traced from the
  // repo root — see the Dockerfile runner stage.
  output: localBuild ? undefined : "standalone",
  distDir: localBuild ? ".next-local" : ".next",
  outputFileTracingRoot: repoRoot,
  reactStrictMode: true,
  // mongodb pulls in optional native drivers that webpack can't statically
  // bundle for the Node.js server runtime — require it from node_modules.
  serverExternalPackages: ["mongodb"],
  webpack: (config, { dev }) => {
    // The proof dependency graph (snarkjs/wasmcurves) makes Next's
    // persistent filesystem cache balloon to ~2GB. In dev, use an in-memory
    // cache instead so nothing accumulates on disk between restarts.
    if (dev) {
      config.cache = { type: "memory" };
    }

    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "@farcaster/mini-app-solana": false,
    };

    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /@farcaster\/mini-app-solana/ },
      { module: /@privy-io\/react-auth/ },
      /Critical dependency: the request of a dependency is an expression/,
    ];

    return config;
  },
};

export default nextConfig;
