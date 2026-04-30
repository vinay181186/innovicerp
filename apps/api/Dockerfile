# syntax=docker/dockerfile:1.7
# Multi-stage Dockerfile for the Innovic ERP API.
# Build context: REPO ROOT (not apps/api/) — pnpm workspaces need the
# root lockfile + workspace manifest + sibling workspace packages.
#
# Runs tsx at the entrypoint instead of compiled JS — see ADR-010.
# Trade: ~50ms startup overhead, ~20MB extra memory. Acceptable at our
# scale; revisit when we need a hardened minimal image.

FROM node:24-slim AS base
ENV PNPM_HOME=/usr/local/pnpm \
    PATH=/usr/local/pnpm:$PATH \
    NODE_ENV=production
RUN corepack enable
WORKDIR /app

# ─── deps ─────────────────────────────────────────────────────────────────────
# Cache install layer separately so source-only changes don't re-resolve deps.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile --filter '@innovic/api...'

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM base
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared

WORKDIR /app/apps/api

# Railway injects PORT; server.ts prefers it over API_PORT.
EXPOSE 3000

# Lean healthcheck using Node's built-in fetch (Node 22+). Railway also
# polls /health via the path set in railway.json.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["pnpm", "exec", "tsx", "src/server.ts"]
