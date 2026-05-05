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

| Host                 | Region                        | RTT to Supabase Mumbai |
| -------------------- | ----------------------------- | ---------------------- |
| Fly.io               | `bom` (Mumbai)                | <5 ms (same metro)     |
| Railway              | `asia-southeast1` (Singapore) | ~50 ms                 |
| Hetzner CCX13        | Helsinki / Falkenstein        | ~140–180 ms            |
| AWS App Runner / ECS | `ap-south-1` (Mumbai)         | <5 ms (same region)    |
| DigitalOcean         | `BLR1` (Bangalore)            | ~10 ms                 |

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
- **Self-host on user's existing on-prem hardware** — not seriously considered. We're explicitly migrating _off_ a single-machine setup.

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

## ADR-015: Phase 5 schema — Procurement (PR / PO / GRN / store ledger)

**Date:** 2026-05-02
**Status:** Accepted — implementation in T-035b/c

### Context

Phase 5 migrates legacy procurement collections: `purchaseRequests` (1 record), `purchaseOrders` (1 record, denormalised line-per-doc), `grn` (3 records under one header), `storeTransactions` (2 records). Plus the deferred FK upgrade on `jc_ops` from ADR-011 #6: replace `outsource_pr_no` / `outsource_po_no` text columns with real FKs to the new tables.

The migration effort is dominated by schema design — current data is 7 records total. Decisions taken now lock in the shape we'll grow into as procurement volume scales.

### Decision (12 sub-decisions)

1. **Header+lines split for PO and GRN.** `purchase_orders` (header) + `purchase_order_lines` (children) + `goods_receipt_notes` (header) + `goods_receipt_note_lines` (children). Same pattern as ADR-012 #1 for SO/JW.

2. **`purchase_requests` as a top-level table** (not just a view of pending PR data on jc_ops or a child of POs). The PR workflow — raise → approve → PO created — is a first-class entity even at 1 record. Single-table for now (no separate lines) since current data is single-line per PR; promote to header+lines if multi-line PRs become a real workflow.

3. **PO line → SO line link** via `purchase_order_lines.source_so_line_id` (nullable FK to `sales_order_lines`). Forward link for cost rollup; legacy carries `soRefId` on PO line.

4. **PO line → JC op link** via `purchase_order_lines.source_jc_op_id` (nullable FK to `jc_ops`). Symmetric with the SO/JW source link on `job_cards`. Replaces the text `outsource_po_no` on jc_ops.

5. **Replace `jc_ops.outsource_pr_no` / `outsource_po_no` text columns with FKs** (`outsource_pr_id` → `purchase_requests`; `outsource_po_line_id` → `purchase_order_lines`). Same migration commit as the new tables; backfill during T-035c load by string match. The two FKs (PR ↔ JC-op, PO line ↔ JC-op) are denormalised inverses — both populated for query convenience; service layer keeps them in sync.

6. **Enums (lowercase, normalise from legacy mixed-case):**
   - `po_status`: `draft | open | partial | qc_pending | closed | cancelled`
   - `pr_status`: `open | approved | po_created | cancelled`
   - `po_type`: `standard | job_work | outsource | service` (legacy seen: `'Job Work'`)
   - `grn_qc_status`: `pending | in_progress | completed`
   - `store_txn_type`: `in | out | adjust`
   - `store_txn_source_type`: `grn_qc | manual_adjust | dispatch | jw_in | jw_out | other`

7. **Tax fields header-level on `purchase_orders`** (`tax_type`, `sgst_pct`, `cgst_pct`, `igst_pct`). Matches current data; promote to lines if a future PO needs per-line GST. `tax_type` left as `text` (not enum) until a third value beyond `'sgst_cgst'` and `'igst'` shows up.

8. **GRN QC fields inline on `goods_receipt_note_lines`** (not a separate `qc_inspections` table). Legacy data co-locates `qcStatus`, `qcAcceptedQty`, `qcRejectedQty`, `qcDate`, `qcRemarks` on each GRN line; that's the natural shape. Phase 6 (`qc_inspections` for shop-floor QC after machining) is a different table — GRN-receipt QC and op-completion QC are different workflows.

9. **`grn_lines.purchase_order_line_id` is nullable.** Legacy `poLineId` is empty in current data; loader resolves by `(po code, item code)` tuple, leaves null + logs anomaly on miss. Better than dropping rows (matching ADR-012 #10 fallback philosophy).

10. **`store_transactions` polymorphic** via `source_type` enum + `source_ref text` string. No FK columns — the source domain stabilises across phases (dispatch/JW DC arrive in Phase 6; refactor to typed FKs in a Phase 7 cleanup if any source needs strong consistency).

11. **Stock balance: derived `v_item_stock` view, not denormalised on items.** Avoids drift; legacy's `items.stockQty` is exactly the kind of denormalisation we're escaping. At <500 items × <10k txns the aggregate scan is cheap. Promote to materialised view (or a per-item cached column maintained by a trigger) only if read latency surfaces in profiling.

12. **PO/PR/GRN auto-close cascades — schema-only in T-035; logic deferred to a follow-on task** (likely T-035d). Same shape as T-033's SO/JW cascade. Pin the schema first and get one cycle of UI feedback before piling on the cascade — easier to revise the trigger conditions when we know what users actually click.

### RLS notes

- Standard `company_isolation` on all 5 tables.
- `manager_write` (admin/manager) for INSERT/UPDATE/DELETE on PR/PO/GRN/store_txn.
- **Special: `goods_receipt_note_lines_qc_update`** policy lets the `qc` role UPDATE only the QC fields (`qc_status`, `qc_accepted_qty`, `qc_rejected_qty`, `qc_date`, `qc_remarks`, `qc_inspected_by`). Defined now even though no qc-role user exists yet — Phase 6 adds them and we don't want to revisit Phase 5 migrations.

### Alternatives Considered

- **Single `purchases` table with type discriminator (PR vs PO).** Rejected: the workflows diverge significantly (approval flow, line counts, tax, vendor commitment); a discriminated union would force half-empty rows.
- **`store_transactions` with typed FK columns per source.** Rejected for now: 6 source types, sparse FKs everywhere; polymorphic text refs match legacy and let us see which source types actually need strong consistency before designing the FK layout.
- **Maintain `items.stock_qty` denormalised.** Rejected: drift risk + the very pattern Phase 1 was meant to escape. Will revisit if a measurement says the view is too slow.
- **Defer `purchase_requests` to a future phase.** Rejected: at 1 record, the schema work is the same regardless of when we do it; deferring means re-touching `jc_ops` (because outsource_pr_no FK depends on it).

### Consequences

- **Positive:**
  - Cost rollup gets real (PO line → SO line FK chain) — Phase 7 reports can `JOIN` cleanly.
  - Outsource workflow gets real FKs — eliminates a class of "stale text reference" bugs from legacy.
  - QC role is forward-defined, no Phase-6 schema churn.
  - Stock ledger is canonical — every txn is a row with full audit, vs legacy's inline `stockQty` mutations.

- **Negative:**
  - 5 new tables in one phase. Bigger Drizzle migration than Phase 4 (4 new tables).
  - `v_item_stock` aggregate scan on every stock check. Mitigated by item count being small (<500); upgrade path is clear.
  - Two denormalised inverse FKs (jc_ops.outsource_pr_id ↔ purchase_requests.source_jc_op_id, jc_ops.outsource_po_line_id ↔ purchase_order_lines.source_jc_op_id) need service-layer sync. CHECK constraint not feasible cross-table without triggers.

- **Risks:**
  - **Backfill miss on jc_ops outsource text → FK.** If the legacy `outsource_po_no` doesn't match a PO code in the new table (e.g. typo), backfill leaves the FK null. Mitigated: validate-phase5 will flag any jc_op that previously had a non-null text but ends up with null FK.
  - **`store_txn_source_type` enum drift.** New source types (e.g. `assembly_consume`) emerge in later phases. ALTER TYPE add value is cheap; not a blocker.

### Action items (T-035b implementation)

- [ ] Drizzle schema in `apps/api/src/db/schema.ts` — 5 new tables + 6 new enums + `jc_ops` ALTER (drop 2 text cols, add 2 FK cols)
- [ ] Migration: `0010_phase5_procurement.sql` (drizzle-gen — tables + enums + FKs + indexes + RLS) + `0011_phase5_jc_ops_alters.sql` (hand-written — drop legacy text cols, add FK cols, add indexes) + `0012_phase5_triggers.sql` (set_updated_at on the 5 new tables) + `0013_phase5_views.sql` (v_item_stock)
- [ ] Apply via the existing `apply-sql.ts` runner for the hand-written migrations
- [ ] Update SCHEMA.md "Migration History" with the four migration filenames

## ADR-016: Phase 6 schema — qc_processes master only; per-inspection records deferred to T-040

**Date:** 2026-05-03
**Status:** Accepted

### Context

T-038 was originally framed as "migrate `qc_inspections` (consolidated from `qcProcesses` / `qcAssignments` / `qcDocUploads`)" — implying a per-inspection event table built from three legacy collections. Real-data inspection of the Run 1 export contradicts that:

- `qcProcesses`: 5 records — but they are **master-data lookups** (MIR / MCR / DIR / Coating Inspection / TPI), not per-inspection events. Each has `name`, `description`, `defaultCycleTime`, `status`. Legacy uses these as a dropdown source on JC-op / route-card-op / plan-op forms (see SCHEMA.md §"Phase 6 Tables — Quality + Dispatch" for the line refs).
- `qcAssignments`: doc_missing — collection was never written by the legacy app.
- `qcDocUploads`: doc_missing — same.

Per-inspection state we already have, fully migrated:

- `goods_receipt_note_lines` QC fields (T-035c) — incoming-material QC.
- `jc_ops.qc_required` / `qc_call_date` / `qc_attended_date` (T-024) — shop-floor QC steps.

So the migration scope of T-038 collapses to: **one master table, 5 rows.**

### Decision

1. **T-038 reframe** — migrate only `qcProcesses` to a new `qc_processes` master table. Drop the "consolidated qc_inspections" framing. Per-inspection record table (with file uploads, sign-off, etc.) is deferred to **T-040** (build QC inspection workflow), where the UX requirements will drive the schema.
2. **Use `code` as the business key**, mapping legacy `name` → `code`. Legacy `name` functions as both unique key (form selects by name string) AND display label, and the values are short uppercase identifiers (`MIR`, `MCR`, etc.). Adding a separate `display_name` would be premature — if a longer display name emerges, alter the table then.
3. **No FK from `jc_ops.operation` to `qc_processes`.** Existing migrated JC-op QC steps already carry the right operation text. New JC-op writes via the future T-040 UX will pick from the master via dropdown but persist as text snapshot — same pattern as `purchase_orders.pr_code_text` (ADR-015 #3) where the audit text + dropdown pattern is preferred over a hard FK alter on a transactional table that's already shipped.
4. **Mark legacy `qcAssignments` + `qcDocUploads` as never-migrated** in MIGRATION-LOG. T-040 will design fresh structures (likely Supabase Storage URLs on per-inspection rows), not resurrect these.

### Alternatives Considered

- **A — original "consolidated qc_inspections" plan.** Rejected: zero per-inspection data exists in legacy, so there's nothing to consolidate. Building the table now would be designing in a vacuum; T-040 has the UX requirements that will drive the right shape.
- **B — separate `code` + `display_name` columns.** Rejected: legacy data treats name as both. Adding a column with no distinct values is premature abstraction (CLAUDE.md §6 #6).
- **C — add `jc_ops.qc_process_id` FK now.** Rejected: every shipped JC op already has the picked text in `op.operation`, so a FK alter would force a backfill that adds zero query power for existing data; better to leave the text snapshot pattern in place and let T-040 decide whether the per-inspection record needs a FK to the master.

### Consequences

- **Positive:**
  - Smallest viable T-038 — 1 table, 5 rows, ~200 LOC across schema + transform + load + validate + tests. Ships in one commit.
  - T-040 retains design freedom for the per-inspection record (file uploads, inspector roles, attachments).
  - Status field defaults to `is_active=true`; matches the operators / clients / vendors master pattern.

- **Negative:**
  - Until T-040 ships, there's no UI for QC inspection events themselves — only the master types are CRUD-able (and admin CRUD lands in a follow-on after T-038 since this is migration-only).

- **Risks:**
  - **Naming clash** — any new "qc_inspections" table T-040 designs needs to live next to `qc_processes`. Naming is `qc_processes` (master) + future `qc_inspections` (events) — clear separation.

### Action items (T-038)

- [ ] Drizzle schema: 1 new master table (`qc_processes`)
- [ ] Migration: drizzle-gen + hand-written `set_updated_at` trigger
- [ ] Transform layer: `migration/transforms/qc-processes.ts` (~50 LOC)
- [ ] Load: extend `migration/load.ts` with QC_PROCESS_MAPPER
- [ ] Validate: minimal `migration/validate-phase6.ts`
- [ ] Update TASKS.md + MIGRATION-LOG.md

---

## ADR-017: Phase 6 schema part 2 — nc_register + delivery_challans (legacy dispatch_log + JW DC + party_grn doc_missing)

**Date:** 2026-05-04
**Status:** Accepted

### Context

T-039 was framed as "migrate `nc_register` (3 rows) + `delivery_challans` (4 rows from `challans`); legacy `dispatch_log` doc_missing." Real-data inspection of the export confirms a wider doc_missing footprint than the task title implied:

- `ncRegister`: 3 records, all references resolve to migrated `IN-JC-00002` op-seqs 4 + 6 and item `554117302000`. Clean target migration set.
- `challans`: 4 records, 3 of 4 reference `IN-JWPO-00001` (migrated); DC-00002 references `IN-PO-00002` which was never written to the legacy DB. Item codes all resolve. soRefIds: 1 of 4 distinct values resolves (`4n7tmo9u` → migrated SO line; `574se7ev` and `9is8kb7f` are not in the legacy SO line set).
- `dispatchLog`: doc_missing — not migrated.
- `jwDCOutward`, `jwDCInward`, `partyMaterials`, `partyGrn`, `ospDC`, `outsourceJobs`, `storeIssues`: all doc_missing — collections were never written by the legacy app.

Status / disposition / reason enum values must reflect the **full** legacy form code, not just exhibited values: status filter dropdown enumerates 4 states (Pending / Disposed / Rework Complete / Closed — line 22555); disposition modal lists 5 (Rework / Scrap / Use As Is / Return to Vendor / Make Fresh — line 22633); reason modal lists 7 (Dimensional / Surface / Material / Process / Operator Error / Machine Fault / Other — line 22584).

### Decision

1. **Migrate only `ncRegister` (3 rows) + `challans` → `delivery_challans` (4 rows).** Skip the 8 doc_missing collections — T-040+ workflows will design fresh tables when UX requirements are clear (mirrors the qcAssignments / qcDocUploads carve-out from ADR-016).
2. **Enum coverage from legacy form code, not exhibited values.** 3 NC enums + 1 DC enum capture the full UX-allowed sets so future writes don't blow up on legitimate values:
   - `nc_status (pending, disposed, rework_done, closed)` — note `rework_done` covers both legacy `Rework Done` (action button line 22541) and `Rework Complete` (filter dropdown line 22555).
   - `nc_disposition (rework, scrap, use_as_is, return_to_vendor, make_fresh)` — nullable on the row until disposition is picked.
   - `nc_reason_category (dimensional, surface, material, process, operator_error, machine_fault, other)` — defaults to `other` since legacy auto-create path leaves the field blank.
   - `dc_status (issued, received, cancelled)` — only `issued` exhibited; the other two are forward states for the future inward-DC + cancellation flows.
3. **NC: hard FKs to `job_cards` + `items`; `jc_op_id` nullable.** All 3 legacy NC rows resolve clean on jcNo and itemCode. `jc_op_id` is nullable because legacy lets `opSeq=0` (or stale opSeq with deleted op) slip through the manual NC form. `disposition_by` / `reported_by` / `operator` are text-only — no FK to operators or users; the durable record is the name string snapshot. Same pattern as `op_log.operator_name` fallback (ADR-011).
4. **NC: no FK to `sales_orders`.** `so_code_text` is denormalised; the indirect path JC → sales_order_line → sales_order is the truth, and the snapshot makes NC reports self-contained without forcing a join.
5. **Delivery challan: `purchase_order_id` and `sales_order_line_id` nullable.** Required to absorb the DC-00002 case (poNo `IN-PO-00002` was never in the legacy export — only `IN-JWPO-00001` made it through migration) and the 2-of-4 unresolvable `soRefId` values. `po_code_text` is NOT NULL and `so_ref_text` preserves the original string, so the audit trail is durable even when FKs go null. Same forward-defaulting pattern as `purchase_order_lines.item_code_text` fallback (ADR-015 #10).
6. **Single status enum `dc_status` even with one exhibited value.** Forward-defining `received` and `cancelled` matches `po_status` (ADR-015) and avoids a follow-up enum-extension migration when T-040+ implements the inward DC flow. Cost: zero — Postgres enums extend without table rewrite, but pre-defining is cleaner.
7. **No view, no trigger beyond `set_updated_at()`.** NC has business-state cascades in legacy (`_disposeNC` line 22618 mutates `jc_ops.reworkQty` on Rework path, creates a supplementary JC on Make Fresh path, writes an `op_log` row on Use As Is path). All of those are application logic, not schema-level cascades — they belong in the future T-040 service layer, not in DB triggers. Phase 6 part 2 ships pure storage; no derived-state views like `v_jc_status`.

### Alternatives Considered

- **A — single combined `dispatch_movements` table holding both inbound and outbound DCs**, with a direction enum. Rejected: legacy `jwDCInward` is doc_missing, so we have nothing to populate the inbound rows with. T-040 can decide the right shape when the inward flow has actual UX. Building an empty side now is YAGNI.
- **B — hard FK `nc_register.disposition_by` → `users.id`.** Rejected: legacy stores `dispositionBy` as a name string snapshot ("Japan") with no UID linkage. Backfilling would require fuzzy name → user matching on 3 rows; the snapshot column is the durable record. Same call as `op_log.operator_name` text snapshot.
- **C — `dispatchLog` table now (even though doc_missing).** Rejected: building empty tables for collections that were never written is premature design; T-040+ workflows will design the right shape when UX requirements are clear.
- **D — separate `delivery_challan_lines` and `delivery_challan_inward_lines` tables.** Rejected: same reasoning as A. Single line table; if T-040 needs inward-line-specific columns, a follow-on migration adds them.

### Consequences

- **Positive:**
  - Total Phase 6 part 2 size: 3 tables, 11 rows (3 NC + 4 DC + 4 DC lines), ~700 LOC across schema + 2 transforms + load + tests + validate. Ships in one commit.
  - All 16 FK orphan checks pass clean against the dev DB. Field-level diff is 0 across 11 rows (`validate-phase6` PASS).
  - Forward-defined enums (`nc_status` 4 values, `dc_status` 3 values) absorb legitimate legacy state transitions that aren't in the exhibited 7-row sample, so future writes don't blow up.
  - Delivery-challan nullable FKs + text-snapshot columns absorb the 3 documented FK gaps without losing any legacy audit data.

- **Negative:**
  - No NC-entry UI yet — only migration-only loaded rows are visible. T-040 will build the read+write flows.
  - The text-snapshot pattern (`disposition_by_text`, `reported_by_text`, `so_code_text`) makes the NC table a snapshot store rather than a fully relational record. Reports that need user-aggregation must `LIKE`-match by name. Acceptable given 3 rows; revisit if NC volume grows.
  - One DC has `purchase_order_id IS NULL` because the legacy PO was never written. The `po_code_text` column makes the audit trail durable but listing "all DCs for PO X" needs both an `id` filter AND a `code_text LIKE` filter. Documented soft spot.

- **Risks:**
  - **Enum extension** — if T-040+ surfaces a legitimate disposition or reason value not in the 5 + 7 enums, an enum-extension migration is needed before code can use it. Mitigation: forward-defined enums minimise the gap; `nc_register_rejected_qty_positive` CHECK gives a hard floor for data integrity.
  - **Time-zone of `time_logged`** — legacy stores `new Date().toISOString()` in browser timezone (IST). Transform parses with `new Date()` then re-serialises to ISO; the round-trip preserves the absolute instant but assumes the legacy clients all wrote in IST. None of the 3 sample rows have `timeLogged` set, so this is theoretical until T-040 starts writing fresh rows with proper UTC.

### Action items (T-039)

- [x] 4 new enums in `packages/shared/src/enums/` + index wiring
- [x] Drizzle schema: 3 new tables + 4 new pgEnum exports
- [x] Migration: `0011_phase6_nc_dispatch.sql` (drizzle-gen) + `0012_phase6_nc_dispatch_triggers.sql` (hand-written), applied via `apply-sql.ts`
- [x] Transform layer: `migration/transforms/nc-register.ts` + `migration/transforms/delivery-challans.ts` (~600 LOC) + 16 unit tests
- [x] Load: 3 mappers + TABLE_CONFIGS + ALL_TABLES entries — 11 rows loaded
- [x] Validate: `validate-phase6.ts` extended to 4 tables + 16 FK orphan checks. PASS
- [x] Update TASKS.md + DECISIONS.md (ADR-017) + SCHEMA.md + MIGRATION-LOG.md

---

## ADR-018: Phase 7 ad-hoc report builder — declarative spec over a whitelisted source catalog

**Date:** 2026-05-05
**Status:** Accepted

### Context

T-041a shipped a server-defined report registry (slug → {definition, run}). Hand-written SQL per report. Adding a report = drop a file in `definitions/`. That works for fixed analytics but doesn't let users compose their own. Legacy had a drag-and-drop "Excel Report Builder" (legacy HTML L17434+) that operated client-side on the in-memory firestore JSON blobs, with `db.reportTemplates` as the persisted spec. We need to bring this forward.

The two tensions:

1. **User flexibility vs. SQL injection.** Legacy was safe-by-luck because it operated on an in-memory JS array. With a real database, the backend has to translate user-composed specs to SQL. Naive interpolation = RCE.
2. **Where does the catalog live.** The "Available fields" list (descriptors) is needed by both the Web (UI) and the API (validation + SQL templating). The SQL templates are server-only.

### Decision

Layer T-041b on the T-041a engine but treat user-composed specs differently:

1. **One new table `saved_reports`** — id + company_id + owner_id + name + description + source_key + spec jsonb + is_shared + standard audit/soft-delete cols. Per-user uniqueness on `name`. RLS = standard company_isolation pair (read + write); the per-user shared/private gate is enforced at the service layer (simpler than an RLS policy that would need a `current_user_id()` SQL helper).

2. **Whitelisted source catalog** — 5 sources for v1: `sales-orders`, `purchase-orders`, `job-cards`, `items-stock`, `nc-register`. Each pairs:
   - A **SourceDescriptor** (sourceKey + label + group + fields[] {key,label,type,filterable,groupable}) — exported via `@innovic/shared` so api + web see the same shape, returned by `GET /saved-reports/sources`.
   - A **baseSelect** SQL fragment (server-only, in `apps/api/src/modules/saved-reports/sources.ts`) that joins the underlying tables and aliases columns to descriptor field keys. Company isolation is applied here.

3. **Spec shape** — `AdHocSpec` = `{sourceKey, columns[], filters[], groupBy?, sumCol?, sumFn, sort[]}`. Filters are `{field, op, value}` with op enum `equals | notEquals | contains | gt | lt | after | before`. Aggregator enum `SUM | COUNT | AVG | MIN | MAX`. Mirrors legacy verbatim.

4. **Safety model** — the runner (`runner.ts`) validates every spec against the source's descriptor before touching SQL:
   - column / filter / sort / groupBy keys must exist in `descriptor.fields`
   - filter ops must be compatible with field type (text → equals/notEquals/contains; number → equals/notEquals/gt/lt; date → equals/after/before)
   - sumCol must be numeric for SUM/AVG/MIN/MAX (COUNT works on anything)
   - filter values are bound via Drizzle's `sql\`...${value}...\`` template (parameterised, never interpolated)
   - column / sort identifiers go through `sql.identifier()`
   - hard `LIMIT 5000` on rows + `LIMIT 200` on summary rows

5. **Two run modes** — `GET /saved-reports/:id/run` (executes a saved report) + `POST /saved-reports/preview` (executes an unsaved spec, powers the builder live preview). Both run inside `withUserContext` so RLS company isolation + role claims propagate to Postgres.

6. **Web UI mirrors legacy** — native HTML5 drag & drop (no `dnd-kit` / `react-dnd` dependency). 3 zones: Columns / Filters / Group By. Live preview button. Save panel with name + description + shared toggle. List page with own + shared reports.

### Alternatives Considered

- **Arbitrary user SQL** — rejected: user-composed SQL = injection risk + RLS bypass risk + no way to validate that the columns the UI expects actually exist.
- **One-off saved report = a generated SQL file in `definitions/`** — rejected: every save needs a deploy, no per-user customisation, no obvious soft-delete story.
- **Use a 3rd-party query DSL (e.g., GraphQL, PostgREST)** — rejected: overkill, adds a layer for problems we don't have.
- **RLS-level user_id filter** — rejected for v1: would need a `current_user_id()` SQL helper sourced from JWT claims (we have `current_company_id()` and `current_user_role()` already, but no user-id helper). Adding one is a 3-line migration but pulls scope; service-layer enforcement is sufficient for "shared vs private" since RLS already gates company-isolation. Revisit if cross-company leakage ever surfaces.
- **Use react-dnd / dnd-kit** — rejected: legacy uses native HTML5 drag-and-drop and a 50KB dependency for one screen is over-budget.

### Consequences

- **Positive:** users can compose their own reports without a deploy. The 5 sources cover the breadth of the legacy `_rbSources` (13 in legacy, 5 here for v1 — the 8 missing are either `doc_missing` per ADR-016/-017 or future-phase modules). Spec safety is enforced at one place (`runner.assertSpec`). Adding a new source = drop an entry in `sources.ts` + a test.
- **Negative:** the source catalog is hand-maintained — there's no automatic pickup of new tables. That's fine for an ERP at 100-user scale; we don't need a metadata-driven generic query engine.
- **Risks:** (a) jsonb spec drift between client + server zod schemas — mitigated by the shared `adHocSpecSchema` parsed on both sides + the runner re-parsing on read. (b) someone might inject a bind value that confuses Postgres (e.g. a number filter with a non-numeric string) — mitigated by per-type op validation. (c) the source catalog might grow into something unmaintainable — when that happens, refactor to a per-source file like `definitions/`.

### Implementation checklist

- [x] Shared schema `packages/shared/src/schemas/saved-report.ts` (FilterOp, AggFunction, AdHocSpec, SourceDescriptor, SavedReport, CRUD inputs, run response)
- [x] Drizzle table `saved_reports` + migration `0013_phase7_saved_reports.sql` (drizzle-gen, applied via apply-sql) + trigger `0014_phase7_saved_reports_trigger.sql`
- [x] API source catalog `sources.ts` (5 sources × baseSelect)
- [x] API runner `runner.ts` — spec validation + safe SQL building + summary aggregation
- [x] API service `service.ts` — list / get / create / update / softDelete / runSavedReport / previewAdHocSpec + ownership/visibility gate
- [x] API routes `routes.ts` — 8 endpoints
- [x] API tests (21 service + 7 routes = 28 new; api 259/259 green)
- [x] Web hooks `api.ts` (TanStack Query: list / detail / run / sources + create/update/delete/preview mutations)
- [x] Web `Builder.tsx` — drag-and-drop UI, live preview, save panel
- [x] Web `ResultTable.tsx` — shared table+summary renderer, CSV export
- [x] Web routes — list / new / edit / run + global-setup wipes T041B-prefixed test rows
- [x] Home nav — `Sparkles` Saved reports card; cross-link from `/reports` list

---

## ADR-019: Phase 8 — Activity log table + read-only viewer (T-051)

**Date:** 2026-05-05
**Status:** Accepted

### Context

Legacy `db.activityLog` (HTML L2126-2132 + L11270-11306) is an append-only audit trail capped at 2000 entries — `{id, ts, user, action, entity, detail, refId}`. 14 rows in Run 1 export. Renderer is a sortable, filterable table with action + user dropdowns + search. Migration is in Phase 9 backlog (final-cutover delta) but the table + viewer can land earlier as a Phase 8 starter — it has no FK dependencies on the still-pending modules.

### Decision

Single new table `activity_log` (T-051). Read-only viewer + filter UI for v1. Schema:

```sql
id uuid PK
company_id uuid NOT NULL → companies
ts timestamptz NOT NULL DEFAULT now()
user_id uuid → users(id) ON DELETE SET NULL  -- nullable
user_name text NOT NULL                      -- snapshot
action text NOT NULL                         -- text, not enum
entity text NOT NULL
detail text NOT NULL DEFAULT ''
ref_id text
created_at + created_by (audit)
-- NO updated_at + NO deleted_at — append-only
```

Indexes: `(company_id, ts)`, `(company_id, action)`, `(company_id, user_id)`. RLS: standard `company_read` for SELECT + `manager_insert` for INSERT only — no UPDATE / DELETE policies (append-only is enforced at the policy level, not just by convention).

API: `GET /activity-log?search=...&action=...&userId=...&fromDate=...&toDate=...&limit=...&offset=...` returns entries + total + distinct actions[] + distinct users[] (drives the filter dropdowns without separate endpoints). No POST / PUT / DELETE routes — append-only at the route boundary.

Web: `/activity-log` list page mirrors legacy renderer — Date / Time / colour-coded Action / Entity / Detail / Ref / User columns; search + action + user + date-range filters URL-persisted; "snapshot" badge on rows where `user_id` is null (legacy "Japan" / "System" entries).

### Alternatives Considered

- **`action` as Postgres enum** — rejected: legacy emits dozens of ad-hoc strings (CREATE / EDIT / DELETE / OP START / OP COMPLETE / DISPATCH / IMPORT / RESTORE / PERM DELETE / TEST / ...). Enum would force an `ALTER TYPE` every time a new emitter ships. Text + index is fine for the cardinality we expect (~30 distinct values).
- **Hard FK on `user_id` (NOT NULL)** — rejected: legacy "System" / "Japan" entries don't map to seeded Supabase users. Nullable + `user_name` snapshot is the standard pattern in the rest of the migration (matches NC `disposition_by_text`, op_log `operator_name`, etc.).
- **UPDATE / DELETE policies on the table** — rejected: append-only audit means no SQL-level mutation. Future "Clear log" admin action (legacy) is not migrated; if needed later, ship as a service function that uses a service-role connection bypassing RLS.
- **Wire up `logActivity` emitters from existing service modules in this commit** — rejected: that's a lot of plumbing across every module (items / SO / PO / GRN / NC / JC / op-entry / etc.). Out of scope for v1; deferred to Phase 8/9 follow-on. The table + viewer + `appendActivityLog` helper are the foundation; emitters land incrementally.
- **User id resolution in the transform layer** — rejected: legacy user names don't reliably map to Supabase Auth uids (legacy uses 8-char short ids + email). Resolving at transform time would couple the offline transform to live Supabase state. Simpler: leave `user_id` null at migration time + populate `user_name` snapshot. Live data going forward gets `user_id` from the active session.

### Consequences

- **Positive:** the audit trail surfaces in the UI immediately for the 14 historical rows. Future emitters drop activity entries via `appendActivityLog(input, user)` in their service path. The viewer's filter dropdowns are auto-populated from the data so adding a new action label requires zero UI changes.
- **Negative:** no in-flight write logging until emitters are wired up — the trail will look "frozen at migration date" in the early phase 8 weeks. Mitigation: ship the first emitter (e.g. on `softDeleteItem`) within a follow-on task.
- **Risks:** (a) the distinct-actions / distinct-users queries on the list endpoint scan the table — at 100k+ rows this becomes slow; mitigation is a follow-on materialised-view refresh. (b) `user_name` snapshot drifts from `users.full_name` if a user is renamed — by design (audit trail captures the name at event time).

### Implementation checklist

- [x] Drizzle table `activity_log` + migration `0015_phase8_activity_log.sql` (drizzle-gen, applied via apply-sql per Phase 5 journal-orphan workaround)
- [x] Shared zod schemas (ActivityLogEntry, ListActivityLogQuery, ListActivityLogResponse)
- [x] Migration transform `migration/transforms/activity-log.ts` (8 unit tests; deterministic uuidv5 from legacy id; null user_id + user_name snapshot)
- [x] Load mapper + ALL_TABLES entry; validate `migration/load/validate.ts` extended to include activity_log in TABLES_WITHOUT_DELETED_AT
- [x] `migration/validate-phase8.ts` script + `pnpm validate:phase8` — PASS (14/14 rows match, 0 orphan FKs across user_id + created_by)
- [x] API module `apps/api/src/modules/activity-log/` (service.listActivityLog with search/action/userId/date-range filters + distinct dropdown sources; service.appendActivityLog helper for future emitters; single GET route; 12 tests covering shape + filters + pagination + auth + append round-trip)
- [x] Web module `apps/web/src/modules/activity-log/` (list page with URL-persisted filters + paginated table mirroring legacy renderer; "snapshot" badge for null user_id rows)
- [x] Home nav adds `History` icon Activity log card; router registers the new route
- [x] api 291/291 green (was 279, +12); workspace typecheck + lint + format clean; web build clean

---

## Pending Decisions

- **ADR-020 (pending):** Domain name and transactional email-from address.
- **ADR-021 (pending):** How to handle Seclore FileSecure DLP tagging on legacy spec source and migration scripts (egress policy).
