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

---

## ADR-010: API hosting — Railway (Singapore) accepted; Fly.io Mumbai considered
**Date:** 2026-04-30
**Status:** Accepted

### Context

CLAUDE.md §1 locks the data region to Mumbai (`ap-south-1`); Supabase Postgres + Storage + Auth all live there. The Fastify API needs to sit physically close to Postgres because every request hits the DB at least once (RLS-checked queries + audit writes), and at 100 concurrent users the cumulative cross-region latency would dominate p95.

The original migration proposal listed Railway and Hetzner CCX13 as candidates. Both predate the hard region lock; this ADR revisits with the constraint binding.

Round-trip latency from each candidate to Supabase Mumbai (`aws-1-ap-south-1`):

| Host | Region | RTT to Supabase Mumbai |
|---|---|---|
| Fly.io | `bom` (Mumbai) | <5 ms (same metro) |
| Railway | `asia-southeast1` (Singapore) | ~50 ms |
| Hetzner CCX13 | Helsinki / Falkenstein | ~140–180 ms |
| AWS App Runner / ECS | `ap-south-1` (Mumbai) | <5 ms (same region) |
| DigitalOcean | `BLR1` (Bangalore) | ~10 ms |

For a typical API request that issues 1 write + 2 SELECTs against Postgres, the round-trips alone:
- Fly.io: ~15 ms baseline overhead
- Railway: ~150 ms baseline (3× round-trips × 50 ms)
- Hetzner: ~450–540 ms baseline — would blow the p95 < 300 ms target in `docs/ARCHITECTURE.md` before any application time is added.

### Decision

**Use Railway with the API in `asia-southeast1` (Singapore).** Single service, Dockerfile-based build, push-to-deploy via Railway's GitHub integration.

The Fly.io `bom` option had a clear technical edge (~150 ms cheaper baseline), but the user (project operator and primary on-call) chose Railway for DX reasons — familiarity, dashboard ergonomics, simpler env-var management, single-button rollbacks. The latency tax is acceptable at our current scale: ~150 ms baseline still leaves ~150 ms of app + query time under the p95 < 300 ms target if the API stays lean (no N+1, no synchronous heavy work in handlers, RLS policies index-friendly).

We run **`tsx` directly at the entrypoint** rather than compiling to `dist/` first — see "Build pipeline" below.

### Alternatives Considered

- **Fly.io `bom` (Mumbai)** — closer to Supabase by ~140 ms baseline; rejected on operator-DX grounds. We document the cost so the call is reversible: if p95 latency or perceived UI lag becomes a problem at >50 concurrent users, the Fly.io option is the first thing to reconsider. Same Dockerfile would work; only the deploy target changes.
- **Hetzner CCX13** (~₹450/mo, ~$5/mo) — **rejected: no Mumbai region.** Nearest is Helsinki / Falkenstein. The 150 ms+ RTT to Supabase makes the p95 latency target unattainable, and we'd lose CLAUDE.md §1's "all data and compute stays in India" promise to the user.
- **AWS App Runner / Fargate / EC2** in `ap-south-1` — rejected: solves the region problem but reintroduces AWS ops overhead that ADR-001 specifically rejected vs Supabase. ~$25/mo minimum for sized memory + CloudWatch + ALB; not enough advantage to justify.
- **DigitalOcean App Platform / Droplet** in BLR1 (Bangalore, ~10 ms RTT) — rejected: viable; kept as fallback if Railway Singapore degrades for an extended period.
- **Vercel / Cloudflare Workers / Edge Functions** — rejected: cold starts on a Postgres-bound API are a known foot-gun (the pooled connection from a freshly-cold function adds 200+ ms). The API is a long-running stateful Fastify process by design (auth plugin caches, in-memory rate limits), not a serverless handler.
- **Self-host on user's existing on-prem hardware** — not seriously considered. We're explicitly migrating *off* a single-machine setup.

### Build pipeline — `tsx` in production (deferred compile)

Decided to run `tsx src/server.ts` as the production entrypoint instead of `node dist/server.js`. Avoids:

- A separate `tsconfig.build.json` per workspace package
- Rewiring `packages/shared`'s `package.json` exports for runtime resolution
- Rewriting ~20 imports across the api to add `.js` extensions (required by `module: "NodeNext"`)
- TypeScript Project References

Cost: ~50 ms tsx loader startup overhead per cold start, ~20 MB extra resident memory for the loader. Both negligible at 15–100 users. Migration to a compiled image is a one-day task we can tackle when we want a smaller production attack surface (and a slightly faster cold start) — flagged in TASKS.md "Future / DLP-friendly dev script" alongside the same dev-side work.

### Consequences

- **Positive:** Push-to-deploy via Railway's GitHub integration. Dashboard for env vars, logs, metrics, rollbacks. Dockerfile gives us a portable build — switching to Fly.io / DO / AWS later means changing the deploy target, not the build. No code-level vendor lock-in.
- **Negative:** ~150 ms latency floor vs an in-region host. Eats into our p95 budget; bad app-side decisions (N+1, missing indexes) will surface as user-visible slowness sooner than they would on Fly Mumbai. Mitigation: we already index FKs and have query-plan discipline (see SCHEMA.md).
- **Risks:**
  - Railway's APAC presence is a single region (Singapore) — no failover. Mitigation: keep `pg_dump` portability (ADR-001) and the same Dockerfile that works elsewhere. Failover plan: deploy to DO BLR1 (~30 min, manual) if Singapore region degrades for >2 hr.
  - Latency could outgrow the p95 target as the workload grows. Mitigation: track p95 in Better Stack / Sentry; if it crosses 250 ms sustained, that's the trigger to revisit Fly.io Mumbai.

### Action items (T-011 implementation)

- [x] `apps/api/Dockerfile` — multi-stage, build context = repo root, runs `tsx src/server.ts`
- [x] `apps/api/.dockerignore` — strip web, legacy, docs, env, node_modules
- [x] `railway.json` at repo root — `builder: DOCKERFILE`, healthcheck `/health`
- [x] `apps/api/src/lib/env.ts` — accept `PORT` (Railway injects it) and prefer it over `API_PORT`
- [ ] Set Railway env vars in dashboard: `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_URL_POOLED`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`
- [ ] Set Railway region to `asia-southeast1`
- [ ] First `railway up` from CLI → verify `/health` returns 200
- [ ] Connect Railway → GitHub for push-to-`main` deploys (after CI is green)
- [ ] `.github/workflows/ci.yml` runs typecheck + lint + test (deploy stays with Railway, not GH Actions)
- [ ] `docs/RUNBOOK.md` — Railway deploy / logs / rollback commands
- [ ] `docs/ARCHITECTURE.md` — replace "Railway/Hetzner" placeholder with "Railway (Singapore)"

(Append new decisions below as ADR-012, ADR-013, ...)

## ADR-011: Phase 3 schema — derived statuses, real `running_ops`, separate `route_cards` master
**Date:** 2026-05-01
**Status:** Accepted

### Context
Phase 3 (T-024) migrates the op-entry chain (`jobCards` 3, `jcOps` 20, `opLog` 81) plus two adjacent legacy collections (`routeCards` 14, `runningOps` 2) that the legacy `calcEngine()` (legacy line 1626–1731) ties together. These five collections drive the heart of the system — operators run them every shift — so the schema choices have outsized leverage on Phases 3, 6, 7. Source data is small (104 op-chain rows + 16 supporting), so a schema that fits the export but breaks on a status the data didn't exhibit is a real risk.

T-024a was a deliberate stop point per CLAUDE.md §1: schema design first, user approval, then code.

### Decision

Per `docs/SCHEMA.md` §"Phase 3 Tables — Op Entry Chain". Eleven binding sub-decisions, the five most consequential:

1. **`route_cards` is its own master table** (with `route_card_ops` children + `route_card_revisions` jsonb history), NOT denormalised onto `job_cards`. Legacy looks up route by `itemCode` and copies ops to `jcOps` at JC creation (line 5966, 6881–6935) — master/transaction split is already there in the legacy semantics; preserve it.

2. **JC status and JC-op status are NOT stored — they are derived via SQL views** (`v_jc_op_status`, `v_jc_status`) mirroring `calcEngine()` (line 1657–1728). Legacy never stores these. At our scale (104 op rows, 100 users target) view cost is free, and we get correctness-by-derivation with no cache invalidation. Promote to materialized view in Phase 7 only if a measurement says so.

3. **`running_ops` is a real table**, not a view over `op_log`. It captures stop-without-complete (line 5703), holds session metadata `op_log` can't reconstruct, and acts as the lock holder for "machine runs one op at a time" via two partial unique indexes (`(company_id, jc_op_id) where status='running'` and `(machine_id) where status='running' and is_osp=false`).

4. **`op_log` is append-only with a `(start | complete | qc)` enum.** Immutable by RLS as well as by convention — corrections happen by appending a reversing entry. Realtime row-filterable by `(company_id, jc_op_id)`.

5. **SO/JW link on `job_cards` uses two nullable FK columns + a `source_legacy_ref text` capture column; FKs are deferred to Phase 4** when `sales_order_lines` and `job_work_orders` exist. A `check (num_nonnulls(...) = 1)` constraint lands at backfill time.

The remaining six (outsource fields kept inline on `jc_ops`, operator-FK-plus-text-fallback on `op_log`, drawing-as-Storage-path on `job_cards`, `qc_docs` deferred to Phase 6, 7 orphan opLog rows captured as anomalies, and Realtime selectivity confirmed) are all in SCHEMA.md §"Phase 3 Design Decisions".

### Alternatives Considered

- **Store `status` on `job_cards` and `jc_ops` (denormalise), maintained by triggers** — rejected: the trigger surface is large (every op_log insert touches at minimum one jc_op + one job_card status; outsource state changes touch more). Cache invalidation bugs would manifest as silent state drift with no DB-level invariant catching them. View-derived statuses can't drift. Revisit if measurement shows the views are slow.
- **`running_ops` as a view over `op_log` with `type='start'` rows that have no matching `'complete'`** — rejected: can't represent "stopped without completing" cleanly, can't hold session metadata that's not in op_log (operator name on the start log is the operator-at-start; mid-session reassignment isn't representable), and can't enforce machine-uniqueness via DB constraint.
- **Single `route_card_ops` table with `(route_card_id, revision_no, op_seq)` PK to keep history in the same table as live ops** — rejected: every read of "current ops for route X" then carries a `where revision_no = (select current_revision from route_cards ...)` predicate. Two-table split is simpler and matches the legacy mental model (`ops[]` is live, `revisionLog[]` is history).
- **Polymorphic `(source_type enum, source_id uuid)` on `job_cards` for the SO/JW link** — rejected: no FK enforcement. The two-nullable-columns + check-constraint pattern gives us referential integrity at the cost of one extra column.

### Consequences

- **Positive:**
  - View-derived statuses guarantee correctness by construction. The legacy `calcEngine()` has been the source of truth for years; mirroring its logic in SQL preserves behavior with no risk of state drift.
  - Two partial unique indexes on `running_ops` push the "one op per machine" and "one running per op" rules to the DB layer. Service layer can rely on them rather than recheck.
  - `op_log` immutability removes a class of audit/dispute bugs (no "who edited LOG-022?" forensics needed).
  - Outsource fields inline on `jc_ops` matches the legacy data shape exactly — transform is straightforward, no schema-flattening logic.

- **Negative:**
  - Views add query-planning cost on the hot read paths (Op Entry screen, Live Operations Board, JC list). At current scale this is invisible; at 100× growth we may need to refactor to a materialized view + refresh strategy.
  - `source_legacy_ref text` on `job_cards` is a forward debt — Phase 4 has to backfill the proper FKs and we should remove the column once verified.
  - Deferring `outsource` normalisation to Phase 8 means Phase 5 (procurement) has to integrate against the inline columns on `jc_ops` rather than a clean `osp_jobs` table.

- **Risks:**
  - **View performance under load.** Mitigation: the views project from indexed FK columns; we've added `(company_id, jc_op_id, log_date)` on `op_log` and the partial indexes on `running_ops`. Add `EXPLAIN` checks during T-026 (validation phase).
  - **Realtime fan-out on `op_log` and `running_ops`.** ADR-004 already bounds Realtime to four hot screens; the row-filter on `(company_id, jc_op_id)` keeps the per-client subscription narrow. Worst case: 20 operators × 1 active op each = 20 active subscriptions. Within budget.
  - **The "log_no is not unique" finding** (LOG-008 appears twice in source) means we cannot rely on `log_no` as a business key for de-duplication or display anchoring. Service layer + UI must use the UUID PK for any addressable reference. Documented in SCHEMA.md.

### Action items (T-024b implementation)

- [ ] Drizzle schema in `apps/api/src/db/schema.ts` — 7 new tables, 5 new enums (`op_type`, `op_log_type`, `outsource_status`, `running_op_status`, `shift`, `jc_priority`)
- [ ] Migration: `0004_phase3_op_entry.sql` (auto-gen via drizzle-kit) + `0005_phase3_views.sql` (hand-written for `v_jc_op_status` + `v_jc_status`) + `0006_phase3_triggers.sql` if needed for `set_updated_at`
- [ ] Apply to dev Supabase, verify with a representative `EXPLAIN` on the two views
- [ ] Update SCHEMA.md "Migration History" table with the three migration filenames

## ADR-012: Phase 4 schema — header+lines split for SO and JW; backfill JC source FKs
**Date:** 2026-05-01
**Status:** Accepted

### Context
Phase 4 (T-029) migrates the sales chain (`salesOrders` 9 records, `jobWorkOrders` 2 records) and fulfils the deferred FK contract from ADR-011 #5 by backfilling `job_cards.source_so_line_id` / `source_jw_line_id`. Legacy stores each LINE as a separate doc with header fields repeated — 8 of 9 SO docs share `soNo='SO-436'`. Same shape for JWs (each JW currently has 1 line). Schema must support header-level data (customer, status, milestones) AND per-line tracking (qty, due date, status).

T-029a was the deliberate stop point per CLAUDE.md §1: design first, user approval, then code.

### Decision

Per `docs/SCHEMA.md` §"Phase 4 Tables — Sales Chain". Eleven binding sub-decisions; the most consequential:

1. **Both `salesOrders` and `jobWorkOrders` get header + lines normalisation.** Two child tables (`sales_order_lines`, `job_work_order_lines`); transforms group source docs by `soNo`/`jwNo` to derive headers. Symmetry simplifies the JC source link (always `*_line_id`) and matches the legacy mental model where each LINE is independently tracked.

2. **Rename `job_cards.source_jw_id` → `source_jw_line_id`** for symmetry with `source_so_line_id`. Legacy `jcRef.soRefId` always points to the per-line doc (line 5371) — the line IS the source. Safe rename — column is null in all current rows.

3. **Backfill `job_cards.source_so_line_id` / `source_jw_line_id` from `source_legacy_ref` text.** Both surviving JCs (IN-JC-00002, IN-JC-00003) reference SO-436 lines. Backfill happens in the load script (Phase 4 transform produces the id_map; load script reads each JC's `source_legacy_ref` JSON and issues an UPDATE). Keep `source_legacy_ref` for one phase as audit trail; drop in Phase 5 cleanup commit.

4. **Add CHECK `num_nonnulls(source_so_line_id, source_jw_line_id) <= 1` on `job_cards`.** Relaxed from ADR-011 #5's `= 1` to allow source-less JCs going forward (e.g. internal stock builds). All current data is `= 1`, so no migration impact.

5. **`so_status` enum: `open | closed | dispatched | cancelled` — shared between SO and JW** (semantics are identical; auto-close cascade applies the same rules to both). **Drop `'Hold'` and `'Completed'`** — neither is set by legacy code on actual SOs/JWs; `'Completed'` is a filter alias for Closed (line 19310).

6. **`so_type` enum: `component_manufacturing | equipment | with_material`.** Three values from data + legacy seed. **Drop `'Job Work'`** — JWs are a separate table, not a type variant.

The remaining six (BOM defer, milestones defer, customer_name fallback, item_code_text fallback, gst_percent header-level, audit triggers per table) are routine and documented inline in SCHEMA.md.

### Alternatives Considered

- **Keep JWs flat (one row per JW since current data has 1 line each).** Rejected: asymmetry with SO complicates the JC source link (would need `source_jw_id` pointing at a header that's also a line). Header+lines split lets `job_cards.source_jw_line_id` always point to a line, regardless of how many lines a JW has. Worth the extra table for one-time transform complexity.
- **`= 1` CHECK constraint on `job_cards` source FKs.** Rejected: future flexibility. Internal stock-build JCs without a customer SO are a real use case the legacy doesn't model but we may want.
- **Drop `source_legacy_ref` immediately after backfill.** Rejected: keep one phase as audit trail in case the backfill misses something. Phase 5 cleanup removes it.
- **Include `bomMasters` collection in Phase 4.** Rejected: BOM expansion (Equipment SO → multiple JCs) is non-trivial and only 1 of 9 records is Equipment. Defer to a later phase; store `bom_master_id text` as forward-compatible ref.
- **Per-line `gst_percent`.** Rejected: data shows uniform 18% per SO. Header-level is correct for current usage; promote to lines later if a customer needs mixed rates.
- **Polymorphic `source_type / source_id` on `job_cards`** (revisited from ADR-011). Rejected for the same reason — no FK enforcement. Two nullable FK columns + CHECK is the established pattern.

### Consequences

- **Positive:**
  - Header+lines split lets the SO list / detail screens (T-030) load all 8 lines of SO-436 in a single FK-indexed query, no GROUP BY needed at read time.
  - JC source link is now FK-enforced — orphan source refs become a load-time error, not silent data drift.
  - Shared `so_status` enum keeps the auto-close cascade logic (T-033) symmetric across SO and JW.
  - `customer_name` + `item_code_text` fallbacks mean Phase 4 load is loss-tolerant — no rows drop because of master-data gaps (unlike Phase 3's ITM-001 cascade).

- **Negative:**
  - Two extra tables (vs flat JW) means more transform / load / validate code. Mitigated by reusing the Phase 3 patterns (route_cards → route_card_ops splits the same way).
  - `source_legacy_ref` lingers for one phase. Cleanup is scheduled but easy to forget; tracked in TASKS as a Phase 5 follow-on.
  - `bom_master_id text` is forward debt — Phase 4 doesn't validate it; bad strings will load silently. Acceptable until BOM module ships.

- **Risks:**
  - **Backfill dependency on `source_legacy_ref` parse correctness.** Mitigated: validate-phase4 script will assert that every JC with non-null `source_legacy_ref` either has a resolved FK OR appears in an anomaly list (legacy ref pointed at a row we couldn't find).
  - **`so_status` enum drift.** If legacy actually used `'Hold'` somewhere we missed, that data lands as `'open'` (default) with an anomaly. We can ALTER TYPE later to add values without data migration.

### Action items (T-029b implementation)

- [ ] Drizzle schema in `apps/api/src/db/schema.ts` — 4 new tables, 2 new enums (`so_type`, `so_status`)
- [ ] Migration: `0007_phase4_sales_chain.sql` (drizzle-gen — tables + enums + FKs + indexes + RLS) + `0008_phase4_jc_alters.sql` (hand-written — rename `source_jw_id` → `source_jw_line_id`, add the two FKs, add CHECK) + `0009_phase4_triggers.sql` (set_updated_at on the 4 new tables)
- [ ] Apply via the existing `apply-sql.ts` runner for the hand-written migrations
- [ ] Update SCHEMA.md "Migration History" with the three migration filenames

## Pending Decisions

- **ADR-013 (pending):** Domain name and transactional email-from address.
- **ADR-014 (pending):** How to handle Seclore FileSecure DLP tagging on legacy spec source and migration scripts (egress policy).
