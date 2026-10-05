# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/package.json
COPY contracts/package.json contracts/package.json
# Only the web app's dependency graph; the Hardhat toolchain stays out.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "web..."

FROM node:22-bookworm-slim AS builder
RUN corepack enable
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/web/node_modules ./web/node_modules
COPY . .

ARG NEXT_PUBLIC_MONAD_CHAIN_ID
ARG NEXT_PUBLIC_MONAD_RPC_URL
ARG NEXT_PUBLIC_MAWEE_REGISTRY_ADDRESS
ARG NEXT_PUBLIC_MAWEE_POOL_ADDRESS
ARG NEXT_PUBLIC_MAWEE_POOL_DEPLOY_BLOCK
ARG NEXT_PUBLIC_MAWEE_POOLS
ARG NEXT_PUBLIC_USDC_ADDRESS
ARG NEXT_PUBLIC_USDC_DECIMALS
ARG NEXT_PUBLIC_USDC_MINTABLE
ARG NEXT_PUBLIC_POOL_DEPTH
ARG NEXT_PUBLIC_PRIVY_APP_ID

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

FROM node:22-bookworm-slim AS migrate
WORKDIR /migrate
RUN printf '{"type":"module","dependencies":{"migrate-mongo":"14.0.7"}}\n' > package.json \
    && npm install --omit=dev --no-audit --no-fund
COPY web/migrate-mongo-config.cjs ./migrate-mongo-config.cjs
COPY web/migrations ./migrations

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/web/public ./web/public
COPY --from=builder --chown=nextjs:nodejs /app/web/scripts/request-payments-local.mjs ./scripts/request-payments-local.mjs
COPY --from=migrate --chown=nextjs:nodejs /migrate /migrate

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "web/server.js"]
