# DECISIONS.md — Architectural Decision Log

> Append-only. Never edit or delete past entries. Supersede via a new ADR.

## Template

```
## ADR-NNN: <Title>
**Date:** YYYY-MM-DD
**Status:** Proposed / Accepted / Superseded by ADR-XXX / Deprecated

### Context
What is the problem? Why does this need a decision?

### Decision
What did we decide?

### Alternatives Considered
- Option A — rejected because <reason>
- Option B — rejected because <reason>

### Consequences
- Positive: <what we gain>
- Negative: <what we give up>
- Risks: <what could go wrong>
```

---

## ADR-001: Use Supabase over self-hosted or AWS
**Date:** 2026-04-29
**Status:** Accepted

### Context
Existing system uses Firebase Firestore with a JSON-blob anti-pattern (every collection stored as a single serialized document, rewritten on every save). Need a relational database supporting concurrency, transactions, reporting at the target scale of 15–100 users with ~50 GB ultimate data volume.

### Decision
Supabase Pro (Mumbai region, `ap-south-1`) for Postgres + Auth + Storage + Realtime. Separate Fastify API on Railway or Hetzner (ADR-008 pending).

### Alternatives Considered
- **AWS RDS + Cognito + S3** — rejected: ~$60/mo vs $26/mo Supabase at our scale, plus 5–10 hr/mo of ops overhead (VPC, IAM, RDS config, backups).
- **Self-hosted Postgres on Hetzner** — rejected: operational burden too high.
- **Stay on Firebase with per-record fix** — rejected: doesn't solve authorization, reporting, or relational integrity. User explicitly rejected as a temp solution.

### Consequences
- Positive: lowest TCO, fastest setup, includes auth/storage/realtime, standard Postgres = portable.
- Negative: PgBouncer kills long queries; Edge Functions have cold starts (we don't use them).
- Risks: Supabase pricing/pivot — mitigated by `pg_dump` portability (1-day migration to AWS RDS if ever needed).

---

## ADR-002: Drizzle ORM over Prisma
**Date:** 2026-04-29
**Status:** Accepted

### Context
ORM choice for the API layer.

### Decision
Use Drizzle ORM. Lighter, transparent SQL, raw SQL escape hatch, no codegen step.

### Alternatives Considered
- **Prisma** — rejected: heavy, hides too much, codegen step, slower cold starts.
- **Knex** — rejected: not type-safe enough.
- **Raw `pg`** — rejected: too much boilerplate.

### Consequences
- Positive: SQL stays inspectable; types are inferred from schema; migrations are diffs of TS schema.
- Negative: smaller community than Prisma; some advanced features still maturing.

---

## ADR-003: TanStack Query over manual fetch / SWR / RTK Query
**Date:** 2026-04-29
**Status:** Accepted

### Decision
Use TanStack Query v5. Replaces ~2,000 lines of hand-rolled cache/sync logic from the legacy Firestore HTML system.

### Consequences
- Positive: declarative, optimistic updates, retries, dedup, stale-while-revalidate built in.
- Negative: another concept to learn for devs new to it.

---

## ADR-004: Selective Realtime, not Realtime everywhere
**Date:** 2026-04-29
**Status:** Accepted

### Decision
Realtime ONLY on Op Entry, Live Operations Board, Machine Status, Task Allocation. Everything else uses TanStack Query polling (30s lists, 60s detail).

### Rationale
WebSocket connections cost server memory (~50 KB each). 100 users × 5 tabs = 500 connections. Polling scales linearly with simple HTTP, easier to debug, no reconnect logic on most screens.

---

## ADR-005: RLS for multi-tenancy and authorization
**Date:** 2026-04-29
**Status:** Accepted

### Decision
Every table has RLS enabled. Every table has at minimum a `company_isolation` policy. JWT claims (`company_id`, `role`) propagated to Postgres session via `current_company_id()` and `current_user_role()` SQL helpers.

### Consequences
- Positive: even a buggy API cannot leak data across companies. Database is authoritative.
- Negative: requires every dev to understand RLS; query plans need EXPLAIN review when policies change.

---

## ADR-006: Soft delete via `deleted_at`, no hard deletes from app
**Date:** 2026-04-29
**Status:** Accepted

### Decision
Every table has `deleted_at timestamptz`. App never executes `DELETE`. To "delete" → set `deleted_at = now()`. Standard queries filter `where deleted_at is null`. Hard deletes only via documented admin scripts after a backup is taken.

---

## ADR-007: pnpm workspaces over npm/yarn
**Date:** 2026-04-29
**Status:** Accepted

### Decision
pnpm workspaces. Fast, disk-efficient, strict module boundaries (no phantom dependencies).

---

## ADR-008: Node.js 24 instead of Node 20 LTS
**Date:** 2026-04-29
**Status:** Accepted

### Context
CLAUDE.md §5 originally specified Node.js 20 LTS as the locked runtime. The dev workstation came with Node v24.15.0 already installed. Rather than downgrade, evaluated keeping Node 24.

### Decision
Use Node.js 24 across local development, CI, and production. CLAUDE.md §5 amended to reflect this.

### Alternatives Considered
- **Downgrade to Node 20 LTS** (Option A) — rejected by user. Avoids one MSI uninstall + reinstall on the dev box; no functional benefit at this stage of the project.
- **nvm-windows side-by-side** (Option B) — rejected. Adds an additional tool to manage; no need for multiple versions on this project.

### Consequences
- Positive: latest Node features (e.g., built-in test runner, native fetch is mature); no dev-environment churn.
- Negative: Node 24 is "Current" not "LTS" until October 2026; we accept the stability risk. CI must pin to 24.x explicitly.
- Risks: some libraries may lag in supporting Node 24 native features. Mitigated by sticking to mainstream versions (Fastify 4.x, Drizzle, Vite 5) which all support Node 22+.

### Action items
- `package.json` engines: `node": ">=24.0.0"`
- `.github/workflows/ci.yml`: `node-version: 24`
- Re-evaluate when Node 24 enters Active LTS (October 2026) or if a project blocker emerges.

---

## ADR-009: Fastify 5 instead of Fastify 4
**Date:** 2026-04-30
**Status:** Accepted

### Context
CLAUDE.md §5 originally pinned Fastify 4.x — the current stable when the migration proposal was written (mid-2024). Fastify 5 shipped in late 2024 and the plugin ecosystem (`@fastify/cors` 10, `@fastify/helmet` 12, `@fastify/sensible` 6) now targets Fastify 5 by default. The T-001 bootstrap inadvertently pinned the plugins at their Fastify-5 line without bumping Fastify itself, which surfaced as `FST_ERR_PLUGIN_VERSION_MISMATCH` during T-006 server boot.

### Decision
Upgrade `fastify` from 4.x to 5.x. Plugins stay at their current versions. CLAUDE.md §5 amended.

### Alternatives Considered
- **Downgrade plugins to Fastify-4-compatible versions** (`@fastify/cors` 9, `@fastify/helmet` 11, `@fastify/sensible` 5) — rejected: a 2026 greenfield project should not start on the previous Fastify generation. Fastify 4 receives only maintenance backports; 5 has the active feature track.

### Consequences
- Positive: latest Fastify, current plugin ecosystem, better type inference, longer support runway.
- Negative: small API tweak in `server.ts` (`logger` option → `loggerInstance` keyword for passing a Pino instance).
- Risks: low; Fastify 5 is mature by now.

(Append new decisions below as ADR-010, ADR-011, ...)

## Pending Decisions

- **ADR-010 (pending):** API hosting — Railway ($7/mo managed) vs Hetzner CCX13 (~₹450/mo self-managed). Affects deploy.yml + runbook.
- **ADR-011 (pending):** Domain name and transactional email-from address.
- **ADR-012 (pending):** How to handle Seclore FileSecure DLP tagging on legacy spec source and migration scripts (egress policy).
