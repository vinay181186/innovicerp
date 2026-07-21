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

### Follow-on (2026-05-05): in-tx `emitActivityLog` + first emitter wired (items)

The original T-051 closure left `appendActivityLog` as a self-contained helper that opens its own `withUserContext` transaction. That works for one-off / out-of-band emission but is wrong for service-layer auditing: the audit row needs to be **atomic with the mutation** it audits — if the outer mutation rolls back, the audit row must roll back too, otherwise we get phantom audit entries for transactions that never happened.

Split into two:

- `appendActivityLog(input, user)` — standalone; owns its own tx. Use when there is no caller-side tx already running (e.g. ad-hoc admin tooling, future scheduled emitters).
- `emitActivityLog(tx, input, companyId, user)` — low-level; writes inside a caller-provided transaction. **The standard for service modules** that mutate-and-emit inside their existing `withUserContext` block.

Conventions for emitter callers:

- `action`: `CREATE` / `EDIT` / `DELETE` for CRUD. Domain verbs (`DISPATCH`, `OP_START`, `QC_ACCEPT`, ...) for non-CRUD.
- `entity`: PascalCase domain noun (`Item`, `SalesOrder`, `JobCard`, `PurchaseOrder`, ...).
- `detail`: short human string. For master data: `<code> — <name>`. For transactions: `<code> — <verb> <qty> ... ` etc.
- `refId`: business key (item `code`, SO `code`, JC `code`, ...) — NOT the uuid `id`. Matches legacy `_logActivity` usage. UI links use this for filter / drill-down.

First emitter wired: **items** (`createItem` / `updateItem` / `softDeleteItem`). Test coverage adds one assertion that all three actions land with correct entity / userId / userName / refId / detail.

Test isolation: pagination test for activity_log was previously assuming a stable table; the items emitter writing audit rows during parallel test runs broke offset stability. Fix: pin both pages to `toDate = new Date()` snapshot taken at test start (the service already supports `toDate`). Same pattern will apply to any future module that asserts pagination shape on a shared write target.

Remaining modules to wire (in roughly the order of the legacy emitter density): sales-orders → job-work-orders → job-cards → purchase-requests → purchase-orders → goods-receipt-notes → nc-register → delivery-challans. Each is a small commit per CLAUDE.md §7.

### Follow-on #2 (2026-05-05): cascade audit emissions in op-entry/sales-cascade.ts

CRUD emitter sweep landed in 8 commits (T-051a #1 → #8). With CRUD covered, the remaining gap was **auto-cascade events** that fire from `op-entry/sales-cascade.ts` when the last op of a JC closes — these flip SO line + SO header (or JW line + JW header) status via direct SQL, bypassing `service.update*`, so they didn't surface in the audit feed.

**Granularity decision: per-entity rows** (matches the precedent set by `createPurchaseOrderFromPr` which emits PO CREATE + PR PR_CONVERT in one tx).

5 new actions emitted from the cascade:

- `JC_COMPLETE` (entity='JobCard', refId=jc.code) — fires once when the JC reaches `complete` status AND the inner cascade actually closed a line
- `SO_LINE_CLOSED` (entity='SalesOrder', refId=so.code) — detail mentions the JC code: `<so.code> — Line auto-closed (JC <jc.code>)`
- `SO_CLOSED` (entity='SalesOrder', refId=so.code) — fires when the header auto-closes after the last line
- `JW_LINE_CLOSED` (entity='JobWorkOrder', refId=jw.code) — same shape as SO line
- `JW_CLOSED` (entity='JobWorkOrder', refId=jw.code) — same shape as SO header

**Idempotency guard:** JC_COMPLETE is emitted only when `cascadeSo` / `cascadeJw` returned a non-skipped result (i.e. it actually closed a line, not just observed it was already terminal). Re-running `tryCascadeJcComplete` against an already-closed line is a no-op AND emits no audit row. Test asserts this with a direct cascade re-run after the initial `submitOpLog` that drove the close.

**Signature change:** `cascadeSo` and `cascadeJw` now take `jcCode` as their second arg so the emit can include it in the line-close detail. The arg is loaded once in `tryCascadeJcComplete` from the same JC SELECT that already pulled the source link.

**Audit row order on a single complete-cascade flow** (newest first by ts/id desc): OP_COMPLETE → JC_COMPLETE → SO_LINE_CLOSED → SO_CLOSED. Reading top to bottom narrates the chain: operator completed final op → JC complete → line closed → header closed.

3 new tests in `sales-cascade.test.ts` (24 → 27 op-entry tests): SO single-line audit shape, JW path audit shape, idempotent re-run does NOT duplicate JC_COMPLETE. teardownAll wipes activity_log by `refId LIKE 'T033-%'`.

**Final activity-log entity vocabulary:** Item, SalesOrder, JobWorkOrder, JobCard, Op, PurchaseRequest, PurchaseOrder, GoodsReceiptNote, NonConformance.

**Final action vocabulary:** CREATE / EDIT / DELETE (all CRUD modules) + OP_START / OP_STOP / OP_COMPLETE (op-entry) + PR_CONVERT (PO from PR shortcut) + NC_DISPOSE / NC_CLOSE_REWORK (NC dispositions) + JC_COMPLETE / SO_LINE_CLOSED / SO_CLOSED / JW_LINE_CLOSED / JW_CLOSED (cascade).

---

## ADR-022: Phase 8 design tracker (T-046) deferred — all 8 source collections doc_missing

**Date:** 2026-05-06
**Status:** Accepted

### Context

T-046 was framed in the Phase 8 backlog as "Design tracker (consolidate 7 collections → 4 tables)." Real-data inspection of the Run 1 export contradicts that:

- **All 8 design collections are `doc_missing`** (zero rows ever written by the legacy app):
  - `designProjects`, `designTasks`, `designIssues`, `designWorkLog`, `designDCRs`, `designDCNs` (System v2 — project-task-issue tree with change-control, legacy HTML L7531–L7651, projects numbered `DP-NNNN`)
  - `designTracker`, `designTimeLog` (System v1 — flat per-SO tracker used by `_canStartProductionForSO` gate, legacy HTML L7485–L7486, designs numbered `DSN-NNNN`)
- The TASKS.md framing of "7 collections" undercounted by 1 — the export actually has 8 design collections across two parallel systems, neither of which legacy users ever populated.

So the migration scope of T-046 is: **zero rows to migrate, two competing legacy specs, no UX requirements driving which to pick.** Same shape as ADR-016 §"Alternatives Considered → A" (the rejected `qc_inspections` design-in-a-vacuum plan) and ADR-017 §1 (dispatchLog + JW DC + 5 other doc_missing carve-outs).

### Decision

1. **Defer T-046 entirely.** No migration, no schema, no api/web module. T-046 row in Phase 8 backlog flipped to `[-] Deferred per ADR-022`. Phase 8 backlog comment notes the doc_missing rationale.
2. **Apply the ADR-016 / ADR-017 precedent uniformly:** doc_missing collections are not resurrected from legacy code in a vacuum. When design tracking becomes a real workflow need, the schema gets designed fresh against the UX requirements at that time — pick System v1, v2, or a hybrid based on what actual designers need, not what legacy happens to have coded.
3. **MIGRATION-LOG entry** records all 8 design collections as `NOT MIGRATED (per ADR-022)` with rationale, mirroring the qcAssignments / qcDocUploads / dispatchLog entries from ADR-016 / ADR-017.
4. **Forward-looking note (not part of this decision but flagged for the user):** T-047 (CRM: `leads`, `communications`, `crmReminders`), T-048 (`toolIssues`, `storeIssues`, `partyMaterials`, `partyGrn`), T-049 (`capaRecords`), T-050 (`printTemplates`, `printTemplateRevisions`) — confirmed doc_missing on inspection of the same Run 1 export. The same defer-or-pivot question applies to each. Decisions on those tasks should be resolved separately, but the precedent set here makes deferral the path of least resistance unless UX requirements have arrived.

### Alternatives Considered

- **A — Build legacy v2 only (`designProjects` + 5 children → 4 tables), skip v1.** Rejected: still designing in a vacuum since v2 was never used either; the moment a real designer wants to use it, requirements may differ. Same pitfall ADR-016 §"Alternatives Considered → A" rejected for `qc_inspections`.
- **B — Build both v1 and v2.** Rejected: largest scope, lowest payoff. v1 is essentially obsolete in legacy and would only carry a mini-feature (per-SO design gate) that doesn't justify a separate migration path.
- **C — Build the schema now but skip the web module.** Rejected: still ships dead tables with unknown long-term shape; a future workflow-driven design would have to ALTER those tables anyway.

### Consequences

- **Positive:** Avoids sinking a session into 4-table design + tests + UI for a module with zero real-world usage. Phase 8 backlog shrinks meaningfully if the same logic propagates. Establishes a clear test (doc_missing → defer until UX) for the remaining Phase 8 tasks.
- **Negative:** Phase 8's title in CLAUDE.md ("Peripheral modules") becomes mostly aspirational rather than executable — `activity_log` (T-051 + T-051a) may end up the only Phase 8 module that ships under this rule.
- **Risks:** The legacy spec source survives in `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` and `migration/export/design*.json`. If a future design module is built from scratch, the legacy code is available as design inspiration — not as a binding spec.

---

## ADR-023: Phase 8 peripheral modules T-047 / T-048 / T-049 / T-050 deferred — all source collections doc_missing (extends ADR-022)

**Date:** 2026-05-06
**Status:** Accepted

### Context

ADR-022 (same day) deferred T-046 design tracker after confirming all 8 source collections were doc_missing. ADR-022 §4 flagged that the remaining Phase 8 backlog items (T-047, T-048, T-049, T-050) were also doc_missing on inspection of the same Run 1 export and that "the same defer-or-pivot question applies to each."

Real-data inspection confirms:

- **T-047 (CRM):** `leads`, `communications`, `crmReminders` — all 3 doc_missing
- **T-048 (shop-floor / party):** `toolIssues`, `storeIssues`, `partyMaterials`, `partyGrn` — all 4 doc_missing. 3 of these (`storeIssues`, `partyMaterials`, `partyGrn`) were already explicitly carved out by ADR-017 §1 alongside the dispatch / OSP / JW DC collections; only `toolIssues` is a new carve-out under this ADR.
- **T-049:** `capaRecords` — doc_missing. ADR-017 already mentioned the legacy `_createCAPAFromNC` cascade is absent from the data even though referenced in legacy code.
- **T-050 (print):** `printTemplates`, `printTemplateRevisions` — both doc_missing.

User agreed 2026-05-06 to apply the ADR-016 / ADR-017 / ADR-022 precedent uniformly: doc_missing modules wait for real workflow UX requirements before schema design starts.

### Decision

1. **Defer T-047, T-048, T-049, T-050 in one batch.** No migration, no schema, no api/web modules for any. All 4 rows in Phase 8 backlog flip to `[-] Deferred per ADR-023`.
2. **Apply ADR-022's "designed fresh against UX" rule** to each module when it eventually becomes a real workflow need. Legacy HTML survives in `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` as design inspiration; legacy export JSONs (all empty per Run 1) survive in `migration/export/`.
3. **Phase 8 outcome under the uniform doc_missing-defer rule:** `activity_log` (T-051 + T-051a) is the only Phase 8 module that ships. Everything else either already shipped under a different phase (`dashboardConfig` partially folded into T-041c / T-043 dashboard tiles), remains blocked on external infra (`alertConfig` → T-041d needs BullMQ + Redis + Resend), or stays deferred (this ADR + ADR-022).
4. **MIGRATION-LOG entries** added for the 7 newly-carved-out collections in this ADR. The 3 already in ADR-017 (`storeIssues`, `partyMaterials`, `partyGrn`) don't need second entries — their existing carve-out stands and is reaffirmed here under the broader policy.

### Alternatives Considered

For each task individually, the same options ADR-022 considered apply: build from legacy code in a vacuum (rejected — no usage data), build a partial schema (rejected — would ALTER once UX arrives), or build the full module with full UI (rejected — designs in a vacuum). The case-by-case rationale collapses to the same precedent.

One option specific to this ADR (not in ADR-022):

- **Build print templates (T-050) anyway** because legacy HTML has actual JS code for templating. Rejected: the legacy print template editor is the WYSIWYG layer; the persisted `printTemplates` + `printTemplateRevisions` collections are doc_missing, meaning no users ever defined custom templates. The default-template renderer pattern shipped in T-045 (Excel export from saved-reports) covers the print-export need for Phase 9 without resurrecting the editor.

### Consequences

- **Positive:** Phase 8 backlog collapses cleanly. Attention pivots to Phase 9 final cutover work, which IS executable today (monitoring setup, runbook expansion, backup verify, etc.). Establishes a uniform project policy via the ADR-016 / -017 / -022 / -023 chain — future doc_missing surprises now have a clear default response.
- **Negative:** When CRM / CAPA / tool tracking / print templates eventually become real needs, schema design starts from scratch — no migration scaffolding exists as a starting point.
- **Risks:** None substantive. Reversible: any ADR can be superseded if real UX requirements arrive and warrant a different approach.

---

## ADR-024: T-041d alerts — split eval engine (Phase A) from push delivery (Phase B); registry in code

**Date:** 2026-05-08
**Status:** Accepted

### Context

T-041d (the last meaningful Phase 7 sub-task with code to write) is framed in TASKS.md as "Phase 7 alerts — needs BullMQ + Redis + Resend infra". Reading the legacy implementation (`legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`, `_defaultAlerts` array starting line 22255, `_getAlertRules` line 22305, `_runAlerts` line 22314, `renderAlerts` line 22323, `renderAlertConfig` line 22427) reveals two facts that change the design:

1. **Legacy alerts are poll-and-display, not push.** The 23 hard-coded rules (`AL-001` … `AL-023`) are evaluated synchronously when a user opens the Alerts Dashboard. There is no scheduling, no email, no notification queue.
2. **Legacy `alertConfig` Firestore collection is just `{code, active}` per company** — a per-company on/off override of the rule registry's default `active` flag. Optionally a renamed `name`. That's the entire persistence surface.

The "BullMQ + Redis + Resend" framing is a forward-looking add-on, not a faithful migration. Conflating the two in one task makes the chunk too big to ship cleanly and obscures which work is actually optional infra.

Of the 23 legacy rules, ~16 are portable to Postgres today; 5 reference doc_missing collections (`plans`, `taskAllocations`, `jwDCOutward`/`jwDCInward`, `opEntries` — the legacy proxy for op_log) and 2 are no-ops even in legacy (`AL-019` Quotation Pending returns empty, `AL-016` JW DC Pending Return depends on doc_missing data). Carve-out follows the same precedent as ADR-022 / -023 for doc_missing modules.

### Decision

Split T-041d into two genuinely independent phases. Both ship in the same overall task; commits chunk per logical unit per CLAUDE.md §7:

**Phase A — eval engine + dashboard (no infra needed):**

1. **Rule registry lives in code**, not the database — one file per rule under `apps/api/src/modules/alerts/definitions/<code>.ts` exporting `{definition, run(ctx)}`. Mirrors the saved-reports pattern (T-041a). Schema-as-code is right here because:
   - The 16 rules are hand-written SQL queries, each different. There is no value in a generic rule DSL that interprets configuration at runtime — every rule already needs a developer to write a SQL query.
   - Adding a rule is a code change reviewed in PR. Removing is the same. Rules don't churn frequently and benefit from typecheck + lint coverage.
   - The legacy app's `_defaultAlerts` is exactly this pattern: hard-coded `fn` per rule, with a separate per-company on/off override. Migrating like-for-like preserves the mental model.
2. **`alert_config` table** stores the per-company per-rule override only: `(company_id, code, active)` with audit columns. No description, no name override (legacy supported renaming but it was unused in practice and easy to add later). RLS: any role reads, admin/manager writes. No soft-delete (the row IS the override; orphaned rows after rule removal are harmless).
3. **Service**: `listDefinitions()` + `runAll(filter, user)` (parallel evaluation, dept-filtered) + `runOne(code, user)` (drill-down records) + `listConfig(user)` (definitions joined with overrides) + `setActive(code, active, user)` (upsert).
4. **Routes**: `GET /alerts` (run all active), `GET /alerts/:code` (drill), `GET /alerts/config` (definitions + overrides), `PUT /alerts/config/:code` (upsert toggle).
5. **Web**: 2 routes — `/alerts` (dashboard mirroring legacy `renderAlerts`) and `/alerts/config` (admin-only toggle table mirroring legacy `renderAlertConfig`). 60s polling (matches polling cadence in ADR-004).

**Phase B — push delivery (gated on Redis + Resend):**

1. **Two new tables**: `alert_subscriptions` (per-user per-rule email opt-in) and `alert_deliveries` (audit log of dispatch attempts, used as a dedup key against repeated digest emails for the same rule + window).
2. **BullMQ + ioredis + resend dependencies** added to `apps/api/package.json`. Wired behind feature flags: `REDIS_URL`, `RESEND_API_KEY`, `ALERTS_PUSH_ENABLED`, `ALERTS_FROM_EMAIL`.
3. **Graceful no-op when infra is absent**: `lib/queue.ts` and `lib/email.ts` export wrapper APIs that log + skip when their respective env vars are unset, so api can boot without Redis/Resend in dev. Phase A continues to work — it never calls these modules.
4. **Worker** is a BullMQ repeatable job (default cadence: every 30 minutes, configurable per env). On each tick: load active alerts, fan out per `alert_subscriptions` row, assemble per-user digest, dispatch via Resend, write `alert_deliveries` audit row keyed on `(alert_code, user_id, window_start)` for idempotency.
5. **Web subscription UI**: per-user "subscribe" toggle on the dashboard rows.

### Alternatives Considered

- **A. Phase A + Phase B as one large commit.** Rejected: too large to review safely; if Phase B's env-var or migration setup needs iteration, it churns Phase A code that already worked. Splits cleanly along a real boundary (DB write surface, infra deps).
- **B. Defer Phase A entirely; build Phase B foundation only.** Rejected: ships dead code (queue + email + subscriptions) that no rule registry feeds. Phase A is the value; Phase B is the amplifier.
- **C. Store rule definitions in the database as SQL strings + filter spec (saved-reports-style for alerts).** Rejected: reuses the ad-hoc report builder mental model, but alerts ARE different from reports — they're tripwires, not exploration. The 23 legacy rules contain bespoke logic (`AL-022` low-FPY needs aggregate-then-threshold; `AL-013` machine-idle needs a left-join-against-running-ops set difference) that would need a much richer DSL than the saved-reports column/filter spec to express. The cost-benefit doesn't justify the complexity.
- **D. Use Postgres `pg_cron` + `pg_notify` for scheduling instead of BullMQ.** Rejected: Supabase doesn't expose `pg_cron` install on managed Postgres without paid tier upgrade; even if it did, debugging cron-in-Postgres is materially harder than reading a BullMQ dashboard. BullMQ keeps scheduling in app-space where it's testable.
- **E. Carry forward all 23 legacy rules even if 5 reference doc_missing data.** Rejected: those 5 would always return empty, becoming visual noise. Defer them to follow-on tasks tied to the doc_missing collections' eventual schema work (per ADR-022 / -023 precedent: when UX requirements arrive for the source domain, the alert rule arrives with it).

### RLS notes

- `alert_config` — `company_isolation` for read (any role); admin/manager only for write. Operators see the dashboard but can't toggle.
- `alert_subscriptions` (Phase B) — same shape but `using` clause additionally allows the row's own `user_id` to read/write its own subscription. Admin/manager can edit anyone's. Defined inline with the table per pattern.
- `alert_deliveries` (Phase B) — admin/manager read-only at the API layer; no app-level write (worker writes via service-role bypass like activity_log entries from system jobs).

### Phase B feature-flag semantics

- `REDIS_URL` unset → `lib/queue.ts` exports `enqueueAlertEvaluation = async () => {}` and warn-logs once at boot.
- `RESEND_API_KEY` unset → `lib/email.ts` exports `sendAlertDigest` that logs the envelope and returns a fake `{id: 'stub-...'}`. No outbound network.
- `ALERTS_PUSH_ENABLED=false` (default) → worker is registered but the repeatable scheduler is not added; `enqueueAlertEvaluation` no-ops even with Redis present.
- All three flags together (`REDIS_URL`, `RESEND_API_KEY`, `ALERTS_PUSH_ENABLED=true`, `ALERTS_FROM_EMAIL`) → push delivery active.

This means rolling out Phase B is purely an env-var change; no code redeploy. Disabling under incident is also one env var. RUNBOOK.md gets the toggle steps.

### Carve-out: deferred legacy rules

Following ADR-022 / -023 precedent, these legacy rules are NOT migrated in T-041d:

- `AL-010` (SO Not Planned) — depends on doc_missing `plans` collection
- `AL-016` (JW DC Pending Return) — depends on doc_missing `jwDCOutward` / `jwDCInward` per ADR-017
- `AL-017` (My Overdue Tasks) — depends on doc_missing `taskAllocations`
- `AL-019` (Quotation Pending) — empty stub even in legacy code
- `AL-020` (Pending Op Entry) — depends on legacy `calcEngine()` derived view; partial portable equivalent could be done off `op_log` but defer until the legacy `_canStart` semantics are pinned down (cycle-time-aware, not just qty-aware)
- `AL-021` (QC Pending > 3 Days) — depends on legacy `calcEngine` + `opEntries` (the legacy proxy for op_log); rules out clean port without re-implementing legacy's enriched-op view in Postgres
- `AL-022` (Low FPY) — uses `_qccFPYData()` first-pass-yield helper that itself depends on `opEntries`; same blocker as AL-021. Trivial when an `op_log`-derived FPY view is built (likely a Phase 9 reporting task)
- `AL-023` (High Inspector Reject Rate) — `opEntries` again

Of the 23 legacy rules, **15 are migrated in this task** (AL-001, 002, 003, 004, 005, 006, 007, 008, 009, 011, 012, 013, 014, 015, 018), 8 deferred. Each deferred rule has a clean re-entry point as the underlying domain ships.

### Consequences

- **Positive:**
  - Phase A ships immediate user value: a working alerts dashboard + admin config screen — same UX surface as legacy, on the new data model.
  - Push infra (Phase B) becomes a clean env-var-driven activation: no separate code deploy when the user provisions Redis + Resend.
  - Rule registry in code keeps the SQL inspectable and reviewable; PRs touching alerts go through the same review path as services.
  - 8 deferred legacy rules have a uniform, principled rationale (doc_missing source data) — same shape as ADR-022 / -023.

- **Negative:**
  - Adding a rule still requires a developer (no admin self-service rule builder). Acceptable given the rule cadence (~23 rules over years of legacy use); not a real bottleneck. If self-service rules ever become a need, the saved-reports + threshold-config layer (ADR-018) is a natural starting point.
  - Two phases means two migration windows: alert_config in Phase A, alert_subscriptions + alert_deliveries in Phase B.

- **Risks:**
  - **BullMQ worker resource cost on Railway**: a Worker is a long-lived process. Mitigated by running it in the same api container (worker mode toggled via env). Requires an explicit decision later about scale-out (separate worker dyno) when alert volume justifies it.
  - **Email deliverability** (Resend domain verification, SPF/DKIM): RUNBOOK captures the setup; Phase B doesn't ship enabled by default, so a misconfigured domain doesn't bounce real users.
  - **Drift between code-defined rules and `alert_config` rows**: if a rule code is removed from the registry, its `alert_config` row becomes orphaned but harmless (service skips unknown codes). If a rule code is renamed, the override is silently lost. Mitigation: code review on rule removal/rename should also drop or migrate the corresponding `alert_config` rows. Documented in `apps/api/src/modules/alerts/definitions/README.md` as part of T-041d.

### Action items

Phase A:

- [x] `alert_config` table in `apps/api/src/db/schema.ts` (T-041d step 1)
- [x] Migration `0015_phase7_alert_config.sql` generated + applied to dev Supabase (idempotent: re-runs via apply-sql.ts safe)
- [ ] Shared schemas in `packages/shared/src/schemas/alert.ts`
- [ ] 15 rule definitions in `apps/api/src/modules/alerts/definitions/`
- [ ] Service + 4 routes + tests
- [ ] Web `/alerts` + `/alerts/config` routes + home nav card
- [ ] Update SCHEMA.md "Phase 7 Tables" with `alert_config`

Phase B:

- [ ] `bullmq`, `ioredis`, `resend` deps added to `apps/api/package.json`
- [ ] `alert_subscriptions` + `alert_deliveries` tables + migration
- [ ] `lib/queue.ts` + `lib/email.ts` (graceful no-op stubs)
- [ ] `lib/env.ts` extension: `REDIS_URL?`, `RESEND_API_KEY?`, `ALERTS_PUSH_ENABLED` (default false), `ALERTS_FROM_EMAIL?`
- [ ] Worker + repeatable BullMQ job (`runAlertEvaluation` every 30 min, configurable)
- [ ] Subscription service + routes + web toggle UI
- [ ] RUNBOOK steps: provision Redis (Railway add-on), get Resend key, set env vars, verify domain, enable

## ADR-025: T-040d QC inspection submit MVP — extend op-entry, no new tables, no new module folder

**Date:** 2026-05-15
**Status:** Accepted

### Context

Two issues from `docs/ISSUES.md` block real cascade verification on migrated data:

- **ISSUE-001:** `op-entry/submitOpLog` has no guard against `op_type='qc'`; a user submitting against a QC op writes a phantom `log_type='complete'` row that corrupts `v_jc_op_status`. Today's smoke wrote one (`LOG-20260515092904`).
- **ISSUE-003:** No API path writes `log_type='qc'` rows. `IN-JC-00002` ops 8/9 + `IN-JC-00003` ops 1/2 sit in `qc_pending` indefinitely; the cascade can't reach `complete` on either migrated JC.

T-040c (per-inspection record table + CAPA + file uploads) is deferred until UX requirements drive the schema. But the underlying `op_log` table already supports `'qc'` log_type, accepted/reject qty columns, and the `v_jc_op_status` view already rolls QC logs into `qc_accepted_qty` / `qc_rejected_qty`. We can add the writable QC path without any schema change, closing both issues immediately.

### Decision

**Extend `op-entry` module. Do not create a separate `qc-entry` module folder. No new tables.**

Concretely:

1. **New service function** `submitQcLog(input, user)` in `apps/api/src/modules/op-entry/service.ts` next to `submitOpLog`.
2. **Defensive guard** added to existing `submitOpLog` — throws `ValidationError` when `op.opType === 'qc'`. Closes ISSUE-001 server-side.
3. **New route** `POST /op-entry/qc-log` in the same module's `routes.ts`.
4. **New shared input schema** `submitQcLogInputSchema` in `packages/shared/src/schemas/op-entry.ts` — `qty` (accepted, ≥0), `rejectQty` (≥0), `logDate`, `shift`, `operatorName?`, `remarks?`. Refine: `qty + rejectQty > 0`.
5. **Validation** mirrors legacy `submitQcLog` handler at HTML L3893-3957:
   - Op must be qc-bearing (`op_type='qc'` OR `qc_required=true`)
   - `qty + rejectQty` must not exceed `v_jc_op_status.qc_pending`
   - At least one of `qty` / `rejectQty` must be > 0
6. **Side effects** (in same tx as the insert):
   - Insert `op_log` row with `log_type='qc'`
   - Set `jc_ops.qc_attended_date` = log date
   - Backfill `jc_ops.qc_call_date` if null — value = most recent prior op's `complete` log date, fallback to log date itself (mirrors legacy L3909-3913)
   - `tryCascadeJcComplete()` — same hook `submitOpLog` uses, fires SO/JW close cascade if this QC log brings the JC to `v_jc_status.computed_status='complete'`
   - Audit emit: action `OP_QC`, entity `Op`, refId = JC code, detail = `<jcCode> Op #<seq> — <accepted> accepted, <rejected> rejected by <operator>`
7. **Web form swap** in `apps/web/src/modules/op-entry/components/op-entry-form.tsx`: when selected op is qc-bearing, render the QC sub-form (Accepted Qty + Reject Qty + Submit QC button) instead of the production-complete form. Hides the production form entirely on QC ops — closes ISSUE-001 from the UI side too.

### Alternatives Considered

- **Separate `qc-entry` module folder** — rejected: duplicates 80% of op-entry's plumbing (loadJcOp, loadAvailability, audit emitter, cascade hook). The legacy spec also keeps the QC submit logically next to the JC's op flow; no cross-module benefit. CLAUDE.md §4 hard rule about "one folder per ERP module" doesn't apply here — this isn't a new domain entity, it's a second write path against the existing op_log table.
- **Wait for full T-040c (per-inspection record table + CAPA + file uploads)** — rejected: blocks ISSUE-003 indefinitely; T-040c needs UX requirements that don't exist yet; the underlying schema already supports the QC log path so MVP can ship now.
- **Auto-create NC on `rejectQty > 0` in this slice** — rejected from MVP: legacy does this (HTML L3946 `_autoCreateNC()`), but it touches the nc-register module's create signature + adds a 5th cross-module call inside the same tx. Surface as a follow-on slice (T-040e) and ISSUE entry; nc-register's `createNcRegister` service already exists.
- **Stock cascade on last-op QC accept in this slice** — rejected from MVP: legacy adds qty to `items.stock_qty` + writes `store_transactions` ledger row when last op QC passes (HTML L3923-3940). Touches 2 more modules; cleaner as a separate slice (T-040f).
- **Split audit action into `OP_QC_ACCEPT` / `OP_QC_REJECT`** — rejected: a single QC log can have BOTH accept and reject qty (legacy allows it; the validation only requires one > 0). Single `OP_QC` action with detail string capturing both numbers is the right grain.

### Consequences

- **Positive:** Closes ISSUE-001 (both server + UI guards) and majority of ISSUE-003 (cascade can now drive through QC ops on migrated data once user navigates to IN-JC-00002 ops 8/9). No schema migration. Reuses existing audit emitter + cascade plumbing. Smaller blast radius than a new module.
- **Negative:** No NC auto-create yet (manual step from QC dashboard, but that doesn't exist yet either — see follow-on). No stock cascade. No QC report file attachment (deferred per ADR-022). UX is "extend the op-entry form" rather than a dedicated /qc-entry route — fine for shop-floor but a QC engineer dashboard would be a future slice.
- **Risks:** The `qc_pending` calc lives in the view; changing the validation to read from anywhere else risks drift with `v_jc_op_status`. Mitigation: same pattern as `submitOpLog` (also reads `available` from the view, never recomputes).

### Follow-on slices to schedule

- **T-040e** — auto-create NC on `rejectQty > 0` (legacy `_autoCreateNC`); calls `nc-register.createNcRegister` inside the QC submit tx
- **T-040f** — last-op stock cascade (`items.stock_qty` += qty + `store_transactions` ledger row) when QC accepts the last op of a JC
- **T-040g** — QC engineer dashboard (legacy renderQCEngineerDash at HTML L3963 — list of qc_pending ops + monthly perf + response times)
- **T-040c** (still deferred) — per-inspection record table + CAPA + file uploads, gated on UX

---

## ADR-026: T-059 outsource DC outward + receive — fresh tables, slice as 059a / 059b

**Date:** 2026-05-18
**Status:** Accepted

### Context

`apps/api/src/modules/delivery-challans/service.ts` shipped read-only in T-040a (the comment at the top of the file points to `printChallan` legacy line 26133 as the "future task" outward flow). The read-only module exposes 4 migrated `challans` rows; it cannot create new DCs nor cascade into `jc_ops.outsource_status` / `outsource_sent_qty` / `outsource_dc_no`.

ISSUE-003 in `docs/ISSUES.md` documents the consequence: `IN-JC-00002` (the only migrated JC with an outsource op) cannot be driven through `v_jc_status.computed_status='complete'` via current UI flows, because op 7 (COATING) is outsource — no flow exists to flip it `'sent' → 'received'`. The sales-cascade unit test (`sales-cascade.test.ts`) already proves the logic with synthetic fixtures; e2e against migrated data is blocked.

Legacy has two parallel outsource flows:

| Legacy collection       | Purpose                                                                                          | Migrated to Innovic             |
| ----------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------- |
| `db.challans`           | Simple per-shipment DC; bumps `jc_ops.sentQty` + outsourceStatus                                 | YES (T-040a, 4 rows)            |
| `db.jwDCOutward/Inward` | Returnable Gate Pass workbench with separate outward/inward + stock IN + auto-NC on rejected qty | NO — doc_missing per ADR-017 §1 |

### Decision

Build T-059 as a Phase 6 follow-on sliced into two sub-tasks:

- **T-059a** — Outward only. Add `purchase_order_line_id` column to `delivery_challan_lines` (nullable, FK to `purchase_order_lines`, ON DELETE SET NULL) so the cascade can find the exact `jc_op` via `outsource_po_line_id` and reverse cleanly on cancel. New service functions `createDeliveryChallan` + `cancelDeliveryChallan` with `applyOutwardToJcOp` + `reverseOutwardFromJcOp` cascade helpers + stock OUT/IN-on-cancel ledger writes (`source_type='jw_out'`). Two new audit actions `DC_ISSUE` / `OP_OUTSOURCE_SENT` on create, `DC_CANCEL` / `OP_OUTSOURCE_REVERSED` on cancel. Web: create form (PO-driven wizard at `/delivery-challans/new?poId=`), "Cancel DC" button on detail (admin-only), "Issue DC" button on PO detail (replaces "Receive (new GRN)" when `po.poType === 'job_work'`).
- **T-059b** — Receive-back. New `delivery_challan_receipts` + `delivery_challan_receipt_lines` tables (separate from `delivery_challan_lines` because receipts are many-per-outward-line and need vendor-side fields `vendor_challan_no` / `received_qty` / `ok_qty` / `rejected_qty`). New `receiveAgainstDeliveryChallan` service. Stock IN ledger (`source_type='jw_in'`). Auto-NC on `rejected_qty > 0` (mirrors T-040e pattern). `v_jc_op_status` view update so an outsource op with `outsource_status='received'` AND `outsource_returned_qty >= input_avail` projects `computed_status='complete'` (instead of just `'received'`) — this is what makes the sales-cascade fire and closes ISSUE-003 end-to-end.

### Alternatives Considered

- **Single monolithic T-059 task** — rejected: ~12-16 hours of work, harder to review, cascade interactions tightly coupled but receive-back has independent test surface. Slicing matches the T-041d 6a/6b/6c precedent for big features.
- **Resurrect `jwDCOutward` / `jwDCInward` from legacy** — rejected: source collections `doc_missing` per ADR-017 §1; same uniform-defer rule as ADR-022/023. Build fresh tables against current UX requirements instead.
- **No new column on `delivery_challan_lines` — match by item code** — rejected: legacy `printChallan` does fuzzy match by item code which silently touches unrelated jc_ops on other JCs. Adding `purchase_order_line_id` makes the linkage exact and reverses cleanly on cancel. Small migration cost.
- **Mutate `delivery_challan_lines` for receive-back instead of new tables** — rejected: receipts are many-per-outward-line (partial receives over time); each receipt needs vendor-side fields that don't fit on the outward line. CLAUDE.md §12 "every record gets its own row."
- **Hard-delete on cancel instead of `status='cancelled'`** — rejected: cancel needs an audit trail + reversal of side effects (jc_op flip + stock txn). Keeping the row with status=cancelled preserves history. Same shape as PO/GRN.
- **Single `DC_CANCEL` audit row vs. per-jc-op `OP_OUTSOURCE_REVERSED`** — chose per-op: matches the T-051a precedent (create-PO from PR emits TWO rows in one tx, one per entity touched). Each entity's audit feed stays complete from its own filter.

### Consequences

- **Positive:** Outsource flow finally has an end-to-end UI path (closing on T-059b). Cascade test coverage extends to real workflow data. ISSUE-003 unblocks. Each slice can be browser-smoked independently. New audit verbs surface jc_op state transitions in the activity log.
- **Negative:** Two new audit action strings (`OP_OUTSOURCE_SENT` / `OP_OUTSOURCE_REVERSED`); the activity-log viewer's `ACTION_COLORS` map will need a future entry (defer to a small UI polish PR — falls back to muted-grey badge meanwhile).
- **Risks:**
  - `outsource_sent_qty` is `integer` in the DB but `delivery_challan_lines.qty` is `numeric(12,2)` — the cascade does `Math.round(Number(qty))` so fractional DC qtys lose precision in the jc_op counter. Acceptable for outsource (whole-piece shipments) but flagged for future audit if BOM ever ships kg/m fractional outsource lines.
  - Cancel doesn't re-credit `outsource_status` past `'po_created'` even if the cascade earlier downgraded a `'pr_raised'` row. Conservative — we don't lose state, just don't recover the earlier "pr_raised" granularity. Documented in `cascades.ts:reverseOutwardFromJcOp`.

### What ships in T-059a (this commit)

- DB: migration `0018_phase6_dc_po_line_link.sql` + schema update
- Service: `createDeliveryChallan` + `cancelDeliveryChallan` + cascades (4 helpers in `cascades.ts`)
- Routes: `POST /delivery-challans` + `POST /delivery-challans/:id/cancel`
- Tests: 22/22 green (16 service + 6 routes — full DC suite)
- Web: hooks + create form + cancel button + PO detail "Issue DC" button
- Quality: typecheck + lint + prettier + build all clean

### What waits for T-059b

- DB: `delivery_challan_receipts` + `_lines` + view update
- Service: `receiveAgainstDeliveryChallan` + auto-NC integration + `tryCascadeJcComplete` invocation
- Routes: `POST /delivery-challans/:id/receive`
- Web: receive form + receipts section on detail page
- Closes ISSUE-003 fully (end-to-end cascade on migrated data)

---

## ADR-027: T-042 materialize `v_item_stock` as a trigger-maintained table, not a Postgres MATERIALIZED VIEW

**Date:** 2026-05-19
**Status:** Accepted

### Context

`v_item_stock` was a SUM-on-the-fly view over `store_transactions` (defined in 0011_phase5_views.sql per ADR-015 #11). Every QC accept cascade, JW DC issue, JW DC receive, and GRN QC accept reads it (to derive stock_before before writing the next ledger row); items-on-hand reports also read it. Read cost grows linearly with `store_transactions` row count.

T-042 calls for converting in-memory aggregations to SQL views / materialized views. The codebase is already SQL-first; the actual remaining win is materializing the hottest view.

### Decision

Implement materialization via a **trigger-maintained denormalized table** (`item_stock_balances`), not a Postgres `MATERIALIZED VIEW`.

- New `item_stock_balances (company_id, item_id, on_hand_qty, updated_at)` table, PK on (company_id, item_id).
- AFTER INSERT trigger on `store_transactions` (SECURITY DEFINER) upserts the balance row by `txn_type` (`in` → +qty, `out` → -qty, `adjust` → +qty per the existing view convention).
- `v_item_stock` view rewritten to `SELECT * FROM item_stock_balances` so every existing caller continues to work unchanged.
- Backfill via `INSERT … ON CONFLICT DO UPDATE` over the live ledger; re-runnable as a reconcile.
- Items FK has `ON DELETE CASCADE` on the balances table so item hard-deletes clean the cache.

### Alternatives Considered

- **Postgres `MATERIALIZED VIEW` with periodic `REFRESH MATERIALIZED VIEW CONCURRENTLY`** — rejected: full refresh costs scale with `store_transactions` size; incremental refresh isn't a Postgres primitive; refresh staleness window adds correctness risk for cascades that read stock_before then write stock_after in the same tx.
- **Keep the view, add covering index on `store_transactions(company_id, item_id, txn_type, qty)`** — rejected: index helps planner but still scans all rows for one item. At 100K+ ledger rows the SUM is still O(N per item) per query.
- **Resurrect legacy `items.stock_qty` denormalization** — rejected: same as this decision in spirit but stored on `items` table. Separate table keeps `items` schema clean and lets the cache be wiped/rebuilt without touching the master.
- **Defer T-042 entirely until production perf data exists** — partially accepted: deferred for `v_jc_op_status` + monthly aggregates (no clear leverage at current scale); only `v_item_stock` materialized in this slice because its read cost ramps with `store_transactions` row count (already 4–5 writes per JC complete), so the curve bites earliest.

### Consequences

- **Positive:** Hot reads drop from O(N) per item to O(1) PK lookup. Cascade write paths (T-036c GRN, T-040f QC accept, T-059a DC issue, T-059b DC receive) all get faster as the ledger grows. View contract preserved → zero caller changes. Backfill statement doubles as a reconcile primitive.
- **Negative:** New invariant to maintain (trigger correctness). If a future ALTER on `store_transactions` adds UPDATE/DELETE without paired triggers, the cache drifts silently.
- **Risks:**
  - **Trigger correctness drift:** mitigated by the reconcile-style backfill which is also a fact-check. Adding a periodic `SELECT 1 FROM v_item_stock WHERE on_hand_qty != (SELECT SUM(...) ...)` smoke check as a Phase 9 monitoring item could close this.
  - **`store_transactions` becoming mutable:** ADR-011 #4 declares the ledger append-only. If that ever changes, the trigger must add UPDATE/DELETE handlers that reverse the prior delta + apply the new one. Captured here so the breaking change can't slip in unnoticed.

---

## ADR-028: Build to full legacy parity per user direction 2026-05-20

**Date:** 2026-05-20
**Status:** Accepted
**Supersedes:** ADR-016, ADR-017, ADR-022, ADR-023

### Context

The previous four deferral ADRs (016/017/022/023) shelved 16+ legacy screens on the rationale that their Firebase collections were empty (`doc_missing`). The user directed on 2026-05-20 that this was the wrong default: the legacy HTML defines workflows regardless of whether the current Firebase export captured any data, and the new app's stated goal from day one was "system like HTML, database in SQL" — i.e. full parity. `docs/LEGACY_AUDIT.md` (committed `93820e5`) enumerated all ~85 legacy screens and confirmed only 21 (~25%) were shipped.

### Decision

Reverse all four deferral ADRs. Build out the full legacy surface area in six phases per the LEGACY_AUDIT build plan:

- **Phase A** (foundation masters that gate downstream): BOM Master, Route Cards, QC Process Master, Cost Center Master, Settings + Users + Access Control
- **Phase B** (Planning module, 5 screens)
- **Phase C** (Production deepening, 9 missing + 2 partial)
- **Phase D** (QC + Sales + Purchase deepening)
- **Phase E** (Design + CRM + Finance, the bulk of previously-deferred work)
- **Phase F** (System / Tasks / cross-cutting reports)

Estimated 8–9 weeks of focused work to reach 1:1 parity.

### Specifically what gets unblocked per superseded ADR

- **ADR-016** → QC Documents, QC Call Register, QC Process Master UI all back in scope.
- **ADR-017** → outsourceJobs, ospDC (separate-from-jwdc view), partyMaterials master + PartyGRN, storeIssues / issueRegister, toolIssue all back in scope. JW DC inward view added.
- **ADR-022** → entire Design module (7 screens) back in scope — projects, issues, work log, BOM Master (shipping in this commit), design tracker, route cards, design reports.
- **ADR-023** → CRM (leads + reminders + Customer 360°), CAPA records, print templates editor, daily task reports, task board, admin trash recovery, tool issues all back in scope.

### Alternatives Considered

- **Stay on the deferred scope, ship 25% of legacy** — rejected: user explicitly stated this was a misalignment with project goals. The original "data-driven deferral" rule was conservative engineering inferred from incomplete signal, not a user-confirmed scope decision.
- **Build only what users actively ask for** — rejected: the user wanted comprehensive parity so the team doesn't have to re-train on different workflows. Asking per-feature would prolong the cutover ramp and leave gaps.

### Consequences

- **Positive:** Full parity restores confidence in the migration. Users see every familiar screen on day one. The audit doc becomes the build backlog.
- **Negative:** 8–9 weeks of additional work before cutover-ready. Multi-session effort. Per-screen scope creep is a real risk.
- **Risks:**
  - **Scope creep on each module** — mitigated by per-module ADRs as needed AND the audit doc's "what's explicitly NOT in scope" section (backup screen → CI cron, dedicated mobile view, etc.).
  - **Schema churn** — fresh modules need fresh tables; old tables may need ALTERs. Each migration is reviewed; soft-deletes preserve existing data.
  - **Field-by-field divergence** — mitigated by `feedback_ui_match_legacy_html.md` memory note (mirror legacy 1:1 for both data layout AND chrome) + per-module audit during build.

### What ships in this commit (BOM-1 through BOM-8)

- DB: migration `0021_phase8_bom_master.sql` — 3 tables + 2 enums + indexes + RLS + sales_order_lines.source_bom_master_id FK
- Drizzle schema entries
- Shared zod schemas (read + write input + Excel import shapes)
- Service layer with revision lifecycle + auto-diff note + linked-SO delete guard
- Routes: GET / POST / PUT / DELETE
- 24 tests green (17 service + 4 routes + 3 cascade)
- BOM-to-SO cascade hooked into createSalesOrder — manufacture lines spawn child JC, purchase/outsource lines spawn PR (with `'OUTSOURCE'` operation marker for outsource)
- 40/40 green across BOM + sales-orders modules

### What waits for follow-up commits

- Web pages (list + detail + create + edit forms + Excel import)
- Update-path cascade hook (updateSalesOrder line additions with sourceBomMasterId set)
- Phase A items 2–5 (Route Cards, QC Process Master, Cost Center, Settings/Users/Access Control)
- Phase B+ per LEGACY_AUDIT plan

---

## ADR-029: Route Cards — ALTER existing schema for OSP fields, keep `cycle_time_min` column name despite hours semantics

**Date:** 2026-05-20
**Status:** Accepted

### Context

Phase 1 reserved `route_cards`, `route_card_ops`, `route_card_revisions` tables on first migration (Phase 3 design — ADR-013) but the module was never built; legacy `renderRouteCards` (HTML L10078) defines the missing master. Two design questions surfaced before code touched:

1. **OSP fields:** Legacy route-card ops with `opType:'OSP'` carry `ospVendorCode`, `ospVendor`, `ospLeadDays`. Our `route_card_ops` table has `op_type='outsource'` enum value but NO vendor / lead-days columns. Porting a real route card with an outsource step would silently lose vendor + scheduling data.
2. **Cycle time unit:** Legacy form labels read "Cycle (hrs)" (L10240 placeholder `"hrs"`, L10163 header `<th>Cycle(h)</th>`) and store the value in hours. Our column is named `cycle_time_min` ("minutes per piece" per SCHEMA.md). Same shape carries through `jc_ops.cycle_time_min` already (Phase 3 snapshots route-card ops to JC ops). Storing hours in a column named "min" is a unit mismatch.

### Decision

1. **Add 3 nullable OSP columns to `route_card_ops`** via migration `0022_phase8_route_card_osp.sql`:
   - `osp_vendor_id uuid` FK → `vendors(id) ON DELETE SET NULL` (live FK when the legacy ospVendorCode resolves)
   - `osp_vendor_code_text text` (free-text fallback per ADR-012 #10)
   - `osp_lead_days integer` (lead days between issuing OSP PO and expected return; legacy default 5)
   - Partial index on `osp_vendor_id` for the lookup.
   - No CHECK enforcing "outsource → vendor required" — service-layer Zod refine conditionally requires one of `ospVendorId` / `ospVendorCodeText` only when `opType='outsource'`, so partial drafts stay editable.

2. **Mirror legacy unit semantics — store hours in `cycle_time_min`, label "Cycle (hrs)" in UI.** Matches the existing `jc_ops.cycle_time_min` behaviour (Phase 3 already carries the same mismatch). Avoids touching every reader (op-entry, JC display, reports). Logged as ISSUE-011 for the audit-phase cleanup pass.

### Alternatives Considered

- **Defer OSP fields to a follow-up commit** — rejected: legacy already supports OSP route-card ops; without these columns a port of any real OSP-bearing route card loses vendor + lead-time silently. Small migration (~30 LOC), cheap to include now.
- **Add a CHECK constraint enforcing "outsource → vendor required"** — rejected: would block partial form drafts (user picks outsource → saves → sets vendor later). Form-layer validation is the right enforcement point.
- **Rename `cycle_time_min` → `cycle_time_hours` across `route_card_ops` AND `jc_ops` in this slice** — rejected: scope creep. Touches op-entry, JC display, reports, store-tx cascades. Bundle into the audit-phase cleanup with the rest of the cycle-time fixes.
- **Convert hours → minutes on save** — rejected: legacy `jc_ops.cycle_time_min` already stores hours; a converter on route-card writes would create asymmetric semantics with the downstream `jc_ops` snapshot the JC creation flow does.

### Consequences

- **Positive:** Full parity with legacy OSP behaviour shipped in the same slice as the master CRUD. Service-layer validation surfaces friendly errors instead of raw DB FK failures.
- **Negative:** Cycle-time unit mismatch persists across two tables. Future readers may misread `cycle_time_min` as "minutes."
- **Risks:**
  - **Hidden unit assumption** — anyone editing op-entry / JC display without reading SCHEMA.md or ISSUE-011 could compute totals in minutes by mistake. Mitigation: every UI surface label explicitly reads "Cycle (hrs)"; ISSUE-011 tracks the column rename for the audit phase.
  - **OSP vendor lookup drift** — legacy `ospVendorCode` may not resolve to a vendor master row at import time. The free-text fallback keeps the audit trail intact; service-layer doesn't try to re-resolve later. Acceptable.

### What ships in this commit (RC-1 through RC-6)

- DB: migration `0022_phase8_route_card_osp.sql` — 3 ALTER columns + 1 FK constraint + 1 index
- Drizzle schema additions (`ospVendorId`, `ospVendorCodeText`, `ospLeadDays`)
- Shared zod schemas (read + write input with conditional OSP refines)
- Service layer with revision lifecycle + auto-diff note + one-active-RC-per-item guard
- Routes: GET / POST / PUT / DELETE
- 21 tests green (16 service + 5 routes)
- Web module: list (expand-row), detail, new, edit; sidebar entry under Design dept; topbar title map
- 4 routes registered in router.tsx

### What waits for follow-up

- JC-creation auto-load from route_card_ops snapshot (Phase 3 logic already wires this when route_card exists for the item; verify it picks up the new OSP fields cleanly on first JC built from an OSP-bearing route card)
- Phase A items 3–5 (QC Process Master UI, Cost Center, Settings/Users/Access Control)

---

## ADR-030: Planning module schema — `plans` per (SO line × BOM child), separate `assembly_units` + `assembly_tracking`

**Date:** 2026-05-21
**Status:** Accepted

### Context

Phase B of ADR-028 ships the Planning module: 5 React screens that mirror legacy `renderPlanDashboard` (L9994), `renderSOPlanning` (L9299), `renderSOOverview` (L9112), `renderSOStatus` (L4255), `renderAssemblyTracker` (L28738). Two of the five screens are pure-read over data we already have (SO Status, SO Overview). The other three need new schema:

1. **`plans`** — the planning record itself. Legacy stores in `db.plans` as a Firestore JSON blob with a wide, sparse field set whose meaning depends on `planType`.
2. **`assembly_units`** — one row per assembled equipment unit (serial number, assembly date, assembledBy, dispatched flag/date). Legacy `db.assemblyUnits`.
3. **`assembly_tracking`** — manual component-readiness overrides per (SO, BOM child). Legacy `db.assemblyTracking`.

Three architectural questions surfaced before any DDL was written:

1. **Plan grain:** is a plan per SO line, per item-instance, or per BOM child? Legacy stores `soRefId` (SO LINE id, not header) + `bomParentCode` + `bomChildCode`; an Equipment SO with a 5-child BOM produces 6 plans (5 children + 1 assembly), a Component SO line produces 1.
2. **Plan-type fan-out:** four plan types (`manufacture`, `direct_purchase`, `full_outsource`, `assembly`) write disjoint field sets — DP fills `dp_*`, FO fills `fo_*`, manufacture fills `ops[]` + `jc_no`. Single wide nullable table vs polymorphic split?
3. **State machine:** transitions are `In Planning → Planned → (JC Created | PR Created) → In Production → Complete`, plus `Cancelled` as a soft terminal. Legacy enforces guards in JS only — once the plan ≥ `JC Created` / `PR Created` the form is locked. Where do we enforce in our stack?

### Decision

1. **One `plans` table, per (SO line × BOM child).** Single fact row keyed by `(so_line_id, bom_parent_code, bom_child_code)`. Wide nullable shape mirrors legacy — DP / FO / manufacture / assembly fields all co-exist as nullable columns. Identification of "which kind of plan" is via `plan_type` enum; service-layer Zod refines enforce the conditional field requirements per type. Rejected polymorphic split (separate `direct_purchase_plans` / `outsource_plans` / `manufacture_plans`) because: (a) cross-type listings on the dashboard get expensive (UNION across 4 tables), (b) plan-type can change while still "In Planning" without paying a row-move cost, (c) legacy's wide shape is what every downstream report reads against.

2. **Two new enums:** `plan_status` ∈ {`in_planning`, `planned`, `jc_created`, `pr_created`, `in_production`, `complete`, `cancelled`}, `plan_type` ∈ {`manufacture`, `direct_purchase`, `full_outsource`, `assembly`}. Lowercase snake_case (matches our existing op-type / store-tx-type convention; legacy values stored as Title Case strings are normalised on import).

3. **State machine enforced at three layers** (matches ADR-005 RLS pattern):
   - **DB CHECK** on the `(plan_type, plan_status)` combinations that are legal (e.g. `plan_status='jc_created' → plan_type IN ('manufacture','assembly')`).
   - **DB CHECK** that linked FK columns are set when status demands it (`status='jc_created' → jc_id IS NOT NULL`, `status='pr_created' → (dp_pr_id OR fo_pr_id) IS NOT NULL`).
   - **Service-layer transition guards** in `apps/api/src/modules/plans/service.ts` — only `planned → execute()` is a public mutation; all forward transitions happen inside `executePlan()` in one transaction with the JC / PR creation.
   - **RLS policy** restricts updates to status ∈ `('in_planning','planned')` for non-admin roles; admin can reopen via explicit override action.

4. **Live FKs + free-text fallback per ADR-012 #10** for vendor refs (`dp_vendor_id` + `dp_vendor_code_text`, `fo_vendor_id` + `fo_vendor_code_text`, etc). Same pattern as route_cards OSP fields (ADR-029).

5. **`plans.ops` lives in `plan_ops` child table** (not a JSONB column) — manufacture/assembly plans have an array of operations matching `route_card_ops` shape. Promoting to a child table avoids the legacy JSON-blob anti-pattern (CLAUDE.md §12 #1) and makes per-op outsource PR linking (`plan_ops.outsource_pr_id`) trivial.

6. **`assembly_units`** as a fact table keyed by `(so_id, unit_no)` unique. Includes a `deductions` JSONB column for per-child stock deductions captured at assembly time (this is intentionally JSONB — it's a snapshot of point-in-time stock movement, not a transactional source of truth; the actual stock writes go through `store_transactions` in the same tx). Dispatched flag + date columns.

7. **`assembly_tracking`** as an override table with unique `(so_id, child_item_code)`. Single `ready_qty_override` numeric column + audit envelope. Per-row not per-unit because the legacy semantics are "I declare 50 of this part are ready," not per-unit allocation.

### Alternatives Considered

- **Per-SO plan grain (one plan row per SO line, BOM children stored as JSONB array of `child_plans`)** — rejected: re-introduces the legacy JSON-blob anti-pattern. Status queries ("show me all `jc_created` plans for child item X") become `WHERE child_plans @> '[{"itemCode":"X","status":"jc_created"}]'` which is unindexable. Also breaks the per-child JC link, which is 1:1 with a row in legacy.
- **Polymorphic split (4 tables, one per plan_type)** — rejected per Decision #1 rationale.
- **No DB CHECK on (type, status) combinations — service layer only** — rejected: this is a closed enum + a small finite state machine. CHECK constraints are the right place; service-layer guards catch the friendly-error path, CHECK catches anything that slips through (direct SQL fixes, future bug).
- **`plans.ops` as JSONB column** — rejected per CLAUDE.md §12 #1 and per ADR-013 (jc_ops promoted to a child table for the same reason).
- **Status enum as TEXT with a CHECK list** — rejected: Postgres ENUM gives index-friendly storage + compiler-checked typing in Drizzle, same pattern as `op_type`, `store_tx_type`.

### Consequences

- **Positive:**
  - Wide nullable `plans` table is dead-simple to query for cross-type listings (dashboard KPIs become a single GROUP BY without UNIONs).
  - Per (SO line × BOM child) grain matches legacy exactly — Phase 2 migration import becomes a 1:1 mapping with no shape transform.
  - State machine guarded at 3 layers (DB CHECK + service-layer + RLS) prevents both code bugs and direct-SQL accidents from corrupting plan status.
  - `plan_ops` child table enables proper outsource PR linking per op (legacy stores `outsourcePRNos` as a parallel array on `plans` — the new structure gives us a real FK).
- **Negative:**
  - Wide table has ~30 columns, many always-null for any given row. Cost: ~24 bytes per null bitmap + a longer migration. Acceptable.
  - Plan-type fan-out logic lives in two places (DB CHECK + service refine). Drift risk if one is updated and not the other. Mitigation: every plan-type change ships in both places in the same migration + commit.
- **Risks:**
  - **`(plan_type, plan_status)` CHECK is brittle** — adding a new plan_type means dropping + recreating the CHECK. Acceptable; the set is closed and changes are rare.
  - **`assembly_units.deductions` JSONB drift** — point-in-time snapshot may diverge from `store_transactions` if a later correction is made. Mitigation: deductions is read-only metadata for the assembly UI; the source of truth for stock IS store_transactions.

### What ships in this ADR

- **Architectural decision only.** No DDL, no code. Defines the shape for PL-3 (`plans` table) and PL-5 (`assembly_units` + `assembly_tracking`) when those slices are built.

### What ships per sub-task

- **PL-1 — SO Status Review:** No new schema. Reads existing tables. Ports legacy `calcEngine()` aggregator to `apps/api/src/lib/calc-engine.ts`.
- **PL-2 — SO Overview:** No new schema. Reuses PL-1's calc-engine. Adds stage/status derivation helper.
- **PL-3 — Planning Dashboard:** Migration `0024_phase8_plans.sql` — `plans` + `plan_ops` + 2 enums + (type, status) CHECK + status-guarded RLS + indexes. Service + routes + tests. Dashboard UI.
- **PL-4 — SO/JW Planning:** No new schema. Plan create/edit + execute flow. Reuses PL-3 tables.
- **PL-5 — Assembly Tracker:** Migration `0025_phase8_assembly_units.sql` — `assembly_units` + `assembly_tracking` + indexes + RLS. Service + routes + tests. Tracker UI with multi-level BOM readiness rollup.

### Build sequence

1. PL-1 (SO Status Review) — proves calc-engine port.
2. PL-2 (SO Overview) — reuses calc-engine; pure read.
3. PL-3 (Planning Dashboard) — introduces `plans` + `plan_ops`.
4. PL-4 (SO/JW Planning) — depends on PL-3.
5. PL-5 (Assembly Tracker) — depends on PL-3 + PL-4; introduces `assembly_units` + `assembly_tracking`.

---

## ADR-031: QC Command Center gets a backend module; `qc_assignments` for Pick-Up / Assign

**Date:** 2026-05-24
**Status:** Accepted

### Context

QC Command Center (legacy `renderQCCommandCenter` L18613) shipped frontend-only — it composed `/qc-history` + `/qc-dashboard`. Two tabs were placeholders: **First-Pass Yield** and **Rework Cycles**, both of which need per-op QC-attempt history (group `op_log` QC rows by op, count attempts, detect first-pass). The legacy **Pick-Up / Assign** queue actions (`_qccPickUp` / `_qccAssign`, backed by `db.qcAssignments`) were also unbuilt. The "qc resume" trigger points here as the only remaining QC work.

Two questions: (1) where does the FPY/rework aggregation live, and (2) how do we model assignments?

### Decision

1. **Stand up a `qc-command` backend module** (`GET /qc-command` + `POST /qc-command/{pickup,assign}`), reversing the original frontend-only stance. FPY and rework are genuine aggregations and Pick-Up/Assign are writes — both are business logic, which CLAUDE.md Rule 1 keeps server-side. The analytics read pulls all company QC `op_log` rows once, groups by `jc_op_id` in JS (ordered oldest-first), and derives: attempt counts (→ queue + rework), first-pass yield (1 entry, 0 rejects — legacy rule L18339-18342), and rework rows. Pareto + Inspector tabs keep reading `/qc-dashboard` (already full) to avoid rewriting verified code.

2. **`qc_assignments` table** (migration 0040), one ACTIVE row per op via a partial unique index `(company_id, jc_op_id) WHERE deleted_at IS NULL`; pick-up / re-assign **upsert** onto it (check-then-insert/update inside the txn, since ON CONFLICT against a partial index is awkward). Inspector stored as **both `inspector_user_id` FK and `inspector_name` text snapshot** (ADR-012 #10 pattern) so the queue renders without a join and survives renames. `assigned_by_text` snapshot for the audit trail.

### Alternatives Considered

- **Compute FPY/rework on the frontend** from a raw `op_log` dump — rejected: violates Rule 1, and ships a large unfiltered payload.
- **Fold into `qc-history`** — rejected: `qc-history` is a focused read; assignments are writes with their own role rules. Section 4 prefers one folder per module.
- **Inspector as name-only string** (legacy) — rejected: loses referential integrity and breaks on rename.

### Consequences

- Positive: FPY/Rework now real; queue shows Attempt + Assigned-To with Pick-Up/Assign; stats strip matches legacy (Rework Items + FPY%). 17/17 module tests green.
- Negative: the all-QC-`op_log` scan is unbounded per company (matches legacy's all-time FPY). Fine at current scale; revisit with a rolling window if `op_log` QC rows grow large.
- **Authorization split:** RLS gates `qc_assignments` writes to admin/manager/qc; the service additionally restricts **assign-to-another to admin only** (pick-up = self). Role check lives in the service per the ARCHITECTURE 3-layer model.
- Minor DELTA logged in `docs/PARITY/qc-command-center.md`: Inspector "Current Load" column not yet wired (data now exists in `qc_assignments`).

---

## ADR-032: Generalize file-Storage into a shared lib; reuse one `qc-docs` bucket

**Date:** 2026-05-24
**Status:** Accepted

### Context

QC Documents (ADR via migration 0039) stood up the app's first file capability: a private `qc-docs` Supabase Storage bucket + `uploadQcFile` / `signedUrlFor` helpers living inside `apps/web/src/modules/qc-documents/api.ts`. Other entities want files too — `items.drawing_file_path` and `job_cards.drawing_file_path` exist as columns but had no uploader (the item-form even registered `drawingFilePath` with no UI — a dead column). "Generalise the file capability" (QC backlog step 3).

Investigation found the literal targets are thin: there is **no JC detail/edit page** (only a list) and **no TPI-report or design-file columns** — so only `items.drawing_file_path` has a real host screen today.

### Decision

1. **Extract the helpers into `apps/web/src/lib/storage.ts`** — generic `uploadFile(file, companyId, { bucket?, folder? })` + `signedUrl(path, { bucket?, expiresIn? })`, default bucket `qc-docs`. `qc-documents/api.ts` keeps `uploadQcFile`/`signedUrlFor` as thin wrappers (call sites untouched).
2. **Reuse the single `qc-docs` bucket** for all file types (no new bucket/migration), namespaced by `${companyId}/<folder>/` path prefix (item drawings → `item-drawings/`). A new bucket per domain buys nothing at current scale.
3. **Wire item drawings** as the first non-QC consumer: an upload field in the item form (sets `drawingFilePath`) + a "View drawing" signed-URL link on item detail. JC drawings / TPI / Design deferred — no host screens/columns.

### Alternatives Considered

- **A bucket per domain** (`drawings`, `design`, …) — rejected: more RLS surface, no benefit at this scale; revisit if retention/ACL policies diverge.
- **Register item drawings as `qc_documents` rows** — rejected: a drawing is a property of the item (its own column), not a QC document; avoids cross-module coupling from the items form into the QC API.

### Consequences

- Positive: any module can now upload/download with two imports; the dead `drawing_file_path` column is live; no migration.
- **Known limitation (security DELTA):** the `qc-docs` bucket's `storage.objects` policies grant read to **any authenticated user**, not per-company — the `${companyId}/` path prefix is organisational, not a boundary. A user could read another company's object if they knew the path. This predates this change (QC Documents already had it); widening usage widens the blast radius. **→ RESOLVED by ADR-033 / migration 0041 (2026-05-24).**

---

## ADR-033: qc-docs Storage bucket — per-company object RLS via a SECURITY DEFINER sub→company lookup

**Date:** 2026-05-24
**Status:** Accepted (resolves the ADR-032 limitation)

### Context

The `qc-docs` bucket (migration 0039) granted **any authenticated user** read/insert/delete on every object (`USING (bucket_id = 'qc-docs')`). The `${companyId}/…` path prefix was organisational only — a user who knew a path could read another company's file. With item drawings now using the bucket (ADR-032), this needed fixing.

The blocker: storage objects are accessed **directly browser→Supabase** with the Supabase Auth JWT, which **does not carry `company_id`** — the Fastify API derives company from `public.users` by the JWT `sub` (`auth.ts`). So `current_company_id()` (reads the `company_id` claim) returns NULL in the Storage context; a policy using it would deny all access.

### Decision

Migration 0041:

1. **New helper `public.current_auth_company_id()`** — returns the caller's company by looking up `public.users` with the JWT `sub` (`request.jwt.claims->>'sub'`). `SECURITY DEFINER` + `SET search_path = public` so it bypasses the company-scoped users RLS (which itself needs a company context the Storage caller lacks — a chicken-and-egg otherwise). `GRANT EXECUTE … TO authenticated`.
2. **Replace the three permissive policies** with `qc_docs_company_{read,insert,delete}`, each asserting `(storage.foldername(name))[1] = current_auth_company_id()::text` — the object's first path segment must equal the caller's company. Works for both `${companyId}/…` and `${companyId}/<folder>/…` layouts.

### Alternatives Considered

- **`current_company_id()` in the policy** — rejected: NULL in the Storage context (no `company_id` JWT claim) → denies everything.
- **Add a Supabase custom access-token hook** to inject `company_id` into the JWT — rejected for now: requires Supabase Auth dashboard config (not just SQL), changes the token app-wide, and the app already resolves company via DB. The SECURITY DEFINER lookup is self-contained in one migration.
- **Subquery to `public.users` inline in the policy (no DEFINER)** — rejected: the subquery is itself subject to users RLS (NULL company context) → returns null → fails closed.

### Consequences

- Positive: cross-company object access is closed at the Storage layer; signed-URL issuance (which checks SELECT RLS) is now company-scoped too. `service_role` still bypasses (server ops unaffected).
- Testing: the policies aren't in the vitest harness (they apply to the `authenticated` role via the Storage API with a real JWT; the harness connects as the migration role). Covered the helper logic in `storage-rls.test.ts` (correct company for a known sub, NULL for an unknown sub). **Plus a DB-level enforcement proof run 2026-05-24** (ad-hoc rolled-back script, since removed): impersonating the `authenticated` role with a real JWT sub against `storage.objects`, cross-company read was DENIED and own-company read ALLOWED, foreign-prefix INSERT DENIED and own-prefix INSERT ALLOWED — all ✓. The only residual gap vs a full Playwright run is the Supabase Storage HTTP wrapper around this RLS, which does not change the policy outcome.
- Path discipline is now load-bearing: `uploadFile` MUST keep writing the company id as the first segment, or writes fail the INSERT check. Documented in `lib/storage.ts`.

---

## ADR-034: Print Templates — admin-only customisable blocks + full revision history; print rendering client-side

**Date:** 2026-05-25
**Status:** Accepted — P1 shipped; P2 (PO/DC prints) + P3 (fixed-layout prints) follow.

### Context

Phase F "Print Templates" (LEGACY_AUDIT screen #81, deferred by ADR-023). The legacy `renderPrintTemplates` (HTML L14660) is an admin WYSIWYG editor for the editable prose blocks (header note / special notes / terms / footer / signature) of exactly **three** documents — PO, OSP DC, JW DC — with `{variable}` substitution and last-5-version rollback. The real print actions (`printPO`, `printChallan`, `_jwdcPrint`) consume those blocks; a separate family of fixed-layout `printX` functions (Job Card, Route Card, Invoice, Dispatch Register, Daily Report) do **not** use the editor. User approved full scope (A+B+C) 2026-05-25. See `docs/PARITY/print-templates.md`.

### Decision

1. **Two tables** (migration 0042): `print_templates` (one active row per `(company_id, template_key)`; absent ⇒ factory default) + `print_template_revisions` (append-only, `created_at`/`created_by` only, mirroring `route_card_revisions`).
2. **Defaults + variable catalogue + substitution helper live in `packages/shared`** (`PRINT_TEMPLATE_DEFAULTS`, `PRINT_TEMPLATE_VARS`, `PRINT_TEMPLATE_META`, `substituteTemplateVars`). Single source of truth: the API falls back to defaults, the web editor previews with them, and the print windows substitute with them.
3. **Admin-only writes** at every layer (RLS `admin_write` policy with `current_user_role() = 'admin'` + service `requireAdminRole`). Legacy gates on `isAdmin()`, not the broader manager-write role — honored exactly.
4. **Full revision history retained; UI shows last 5.** Legacy hard-deletes revisions beyond 5. We never hard-delete (CLAUDE.md Rule #8) — keep all, `LIMIT 5` on read. "Reset to default" soft-deletes the customised row (after archiving its content) so the block falls back to the default with `isCustomised=false`.
5. **Print/substitution HTML is presentation → web `@/lib` (P2/P3), not the API.** Template content + the data bag come from the API; the print window is a pure `window.open` + string build. Honors CLAUDE.md Rule #1 (no business logic in FE) because there is no validation/authorization/calculation in the print path — auth lives in the template-write service + RLS.

### Alternatives Considered

- **JSONB blob of all 15 blocks on a single `company_print_config` row** — rejected: loses per-block revision granularity and the natural unique-key upsert; the row-per-block table matches the legacy `templateKey` model and the existing master patterns.
- **Hard-cap revisions at 5 (delete oldest)** — rejected: violates the no-hard-delete rule; keeping history is strictly better and the display cap costs nothing.
- **Server-rendered print HTML (API returns a print document)** — rejected: the print layout is presentation; rendering client-side avoids shipping an HTML-templating concern into the API and keeps the data endpoints reusable. Reconsider only if we need server-side PDF generation later.
- **`manager_write` to match other masters** — rejected: legacy is explicitly admin-only for print templates; broadening it would be a silent policy change.

### Consequences

- Positive: clean single-source defaults; admins customise vendor-facing docs without code; full audit trail; P2/P3 reuse the same substitution + (P3) a shared `printWindow` util.
- Negative: print-window HTML is hand-built strings (no React) — acceptable for a print surface, but each fixed-layout print (P3) is its own body-builder.
- Risks: company header data (name/GSTIN/address) must come from the `companies` row at print time (P2) — if absent, prints show blanks; mitigated by the Settings page already editing those fields.

---

## ADR-035: Access Control matrix — UI-only enforcement, opt-in via "unconfigured ⇒ allow-all" fallback

**Date:** 2026-05-30
**Status:** Accepted

### Context

Legacy `renderAccessControl` (L13861) defines a per-user permission matrix on top of the role enum: `fullAccess` flag, departments map (sidebar gating), and a forms map of `{form_key: {view, entry, edit}}` for 35 form keys. Helpers `canView/canEdit/canEntry/_hasDeptAccess` (L13776-13803) are called **173×** across the legacy file. Build-first-audit-later mode demands shipping the matrix end-to-end without disrupting the live system: existing non-admin users must keep working on day one even with empty grants.

### Decision

Ship as a UI-only matrix in this slice. The `user_access` table persists the admin's intent, `getMyAccess` exposes effective access to the web shell, and a single shared helper set (`canViewForm` / `canEntryForm` / `canEditForm` / `hasDeptAccess` in `packages/shared/src/schemas/access-control.ts`) gates client-side buttons + sidebar sections. Per-form server-side write gating on the ~30 existing modules is deferred to the focused logic-correction audit pass per `feedback-build-first-audit-later`.

Day-one rollout protection: client helpers treat an "unconfigured" matrix row (no full_access + empty departments + empty forms) as allow-all. The first time an admin saves *anything* for a user, that user moves into strict-mode gating. This isolates the rollout — admins enable the feature one user at a time rather than the whole company seeing an empty sidebar on the day the migration lands.

### Alternatives Considered

- **(B) Service-layer write gate** on every protected route — rejected for this slice: ~3-4 day cross-module refactor; regression risk on any route the gate misses; not needed because role-based RLS still secures writes. Kept as a deferred audit task.
- **(C) Full RLS rewrite** keying off a SECURITY DEFINER `current_user_form_perms()` fn — rejected: ~5-7 day blast radius; threat model (admin attestation + role RLS) doesn't need it.
- **Legacy backfill semantics (`full_access:true` for every user)** — rejected: replicates the legacy L1254 bug; secure-by-default is preferred for new users. The "unconfigured ⇒ allow-all" client fallback gives the same smooth rollout for existing users without baking the bug into stored state.
- **Adding new role tiers (sr_engineer / engineer / jn_engineer)** to match legacy's 7-role dropdown — rejected: our 8-role enum is domain-specialised (qc / procurement / dispatch / design) and every existing RLS policy keys off it. Legacy tier roles can be mapped to `operator` / `viewer` at user-import time if/when needed.
- **CSV / Excel user import** — skipped: Supabase Auth owns invitations, and the legacy CSV doesn't map cleanly. CSV template + JSON matrix paste (the lighter import path) is queued as a follow-up enhancement per the user's sign-off on Q4.

### Consequences

- Positive: matrix ships in one slice without disturbing other modules; existing non-admin users see no change until an admin explicitly grants/revokes; full audit-log emission on every save; the same shared helpers will plug into the deferred server-side gate when the audit pass runs.
- Negative: the matrix is *advisory* on the server until the audit pass — a sophisticated client could PUT to a hidden endpoint and bypass the UI gate. Existing role-based RLS still prevents non-admins from doing things their role can't do.
- Risks: admins forgetting to revisit a user after granting one perm could leave them stuck in strict mode with partial access — mitigated by the matrix list view showing dept and form counts per row.

---

## ADR-036: System Settings sidebar — full legacy parity in one slice

**Date:** 2026-05-31
**Status:** Accepted

### Context

User goal 2026-05-31: build out the entire System Settings sidebar to match legacy 1:1, including all logic. Audit found six gaps vs legacy renderX functions: Approval Configuration (whole module missing), Operation Log (no dedicated viewer), Trash (deferred per ADR-023), Backup & Export (deferred — Supabase handled), OSP Process Configuration (not built), Data Integrity Check (not built). Plus sidebar mislabel ("Reports" section was actually System).

### Decision

Ship all six items in one session as a layered build:

1. **Approval Configuration** — new `approval_config` table (one row per company, admin-only RLS) + `users.approval_limit` column. Editor surfaces PO/PR/Invoice toggles, manager amount limit, approvers picker, flow diagram, recent activity (`activity_log` filtered to `APPROVE`/`REJECT`/`PAYMENT`). Backend storage + UI only; actual draft/approve PO flow is a deferred audit task.
2. **Operation Log** — read-only viewer of existing `op_log` table joined with jc_ops/job_cards/items/machines/users. Paginated + filtered. **No delete** — legacy `delLog` violates CLAUDE.md Rule #8 + breaks qty-done recalc.
3. **Trash** — UNION ALL across 17 soft-deletable entity tables. Restore clears `deleted_at`; Permanent Delete is the documented admin hard-delete path per Rule #8 (typed confirmation, audit emitted before row vanishes).
4. **OSP Process Configuration** — new `osp_processes` table (process name + vendor FK + auto-PO + lead-time). Manager/admin RLS write. Case-insensitive unique. Settings page panel CRUD. The op-name → auto-PR/PO trigger on op-entry start is deferred.
5. **Data Integrity Check** — single `GET /data-integrity` endpoint runs 8 read-only SQL checks (orphan JCs, JC ops without machine, negative stock, stale Draft POs, stale Pending NCs, stale unconverted PRs, overdue JCs, zero-qty SO lines). Each result has severity + sample identifiers. Settings page panel renders coloured cards.
6. **Backup & Export** — simplified. Stats endpoint + JSON download endpoint (cap 5,000 rows/table). Restore + Factory Reset are runbook ops, not in-app. Hash-verified backup deferred. The real backup discipline is unchanged (daily pg_dump → B2).

Sidebar split out of the misnamed "Reports" section into two: Reports (ungated) + ⚙ System Settings (gated on `system` dept). Eight items under System Settings match legacy L516-524.

### Alternatives Considered

- **Multi-session, one item per slice** — rejected: user explicitly directed "build entirely, will test once module built". One session reduces context churn.
- **Defer Approval Config + Trash** — rejected: both are real legacy parity items, not nice-to-haves.
- **Port legacy `delLog` for op_log** — rejected: violates CLAUDE.md Rule #8 + breaks downstream calc.
- **Hash-verified backup format** — rejected for now: requires backup-restore parity tooling we don't have. Daily pg_dump + B2 already covers integrity at a higher level.

### Consequences

- Positive: full System Settings module ships as one unit; user can test end-to-end. Sidebar finally semantic. New tables follow existing RLS patterns (admin-write, company-read). All deferred items have a clear "audit pass picks this up" trail.
- Negative: Approval Config UI shows a flow diagram that doesn't yet wire to PO creation — the editor is honest but partial. Trash permanent-delete is irreversible (mitigated by typed-confirmation UX + audit log emit before delete).
- Risks: Data Integrity Check sample queries are read-only but inspect-everything; on a 50 GB database they may be slow. Mitigated by `LIMIT 5` per check.

---

## ADR-037: Purchase module — full legacy parity in one slice

**Date:** 2026-05-31
**Status:** Accepted

### Context

User goal 2026-05-31 (second of the day): build out the entire Purchase sidebar to match legacy 1:1, including all logic. Audit found four gaps vs legacy renderX functions: Outsource Jobs (whole page missing), Service PO (whole module missing), Supply Chain Dashboard (whole page missing), plus the deferred PO Draft/Approve/Reject flow from ADR-036.

### Decision

Ship all four items in one session as a layered build:

1. **PO Draft/Approve/Reject** — adds reject-side columns on `purchase_orders` to mirror existing approved-side. `createPurchaseOrder` consults `approval_config.po_approval` to set the initial status (`_poInitialStatus()` parity). Two new POST endpoints (`/:id/approve`, `/:id/reject`) gated on `admin || approval_config.po_approvers.includes(user.id)`. Approve flips `'draft' → 'open'`; reject flips `'draft' → 'cancelled'` and stores the reason. Activity log emits `APPROVE` / `REJECT` rows feeding the Approval Config recent-activity panel.

2. **Outsource Jobs** — new `pr_type` enum (`standard` / `jw_osp` / `service`) lets us cleanly distinguish OSP PRs from regular PRs. New `/outsource-jobs` page lists every `pr_type='jw_osp'` PR with status cards + checkbox multi-select. New `POST /purchase-orders/from-pr-batch` endpoint clubs N PRs into one PO header with one line per PR; per-line rate is editable in the modal.

3. **Service PO** — new tables `service_pos` + `service_po_lines` (header + lines). Manager/admin writes; admin approves. Five-status workflow (draft / pending / approved / completed / cancelled). 9 expense heads ported verbatim. Full CRUD + approve endpoint + soft-delete.

4. **Supply Chain Dashboard** — one read-only `GET /sc-dashboard` endpoint that runs 6 SQL aggregates (summary, by-vendor, by-SO, PO-with-tax, pending-lines, recent-GRN). Page renders 9 cards + 5 tables. No full PO list shipped to the browser.

### Alternatives Considered

- **Add OSP PR auto-generation on JC op start** — deferred. Legacy `_autoGenerateOspPR` triggers from op-entry; wiring it requires consulting `osp_processes` + conditionally inserting a PR (+ optional draft PO) inside the op-entry create transaction. Out of scope for this session.
- **Enforce po_manager_limit at approve time** — deferred. Would need PO subtotal × tax math at approve time. The approver-list gate already prevents arbitrary users from approving; the amount-limit gate is the second layer.
- **Service PO print template** — deferred to Phase F (print-templates).
- **Make PR creation default `pr_type` to `'jw_osp'` when sourceJcOpId is set** — done in the service.

### Consequences

- Positive: full Purchase module ships as one unit testable end-to-end. Draft/Approve flow finally wires Approval Config to its primary consumer. Outsource Jobs gives the shop floor a single bulk-PO surface. Service PO unblocks the labour/maintenance billing workflow. SC Dashboard gives procurement a one-glance vendor performance view.
- Negative: the Approve flow still doesn't enforce per-user `approval_limit` — a manager added to po_approvers can approve POs of any size. Tagged for the deferred audit pass.
- Risks: Service PO has its own status enum + tables but no print template — printing happens via the browser's native print until Phase F handles SPOs. Outsource Jobs auto-trigger from op-entry is the bigger missing piece; until that ships, OSP PRs must be created manually through SO/JW Planning or the standard PR flow.

---

## ADR-038: PO approval amount-limit gate + per-user `approval_limit`

**Date:** 2026-06-01
**Status:** Accepted

### Context

ADR-036/ADR-037 shipped the PO Draft→Approve/Reject flow gated only on the approver list (admin OR in `approval_config.po_approvers`). Both ADRs explicitly deferred the amount-limit gate: a manager on the approvers list could approve a PO of any size. Legacy `_approvePO` (L21731) blocks a non-admin approver when the PO value exceeds the limit. The supporting columns already existed (`users.approval_limit` + `approval_config.po_manager_limit`, both from migration 0046) but the User-edit screen had no field for the per-user limit and `approvePurchaseOrder` never read either column.

### Decision

Wire the gate into `approvePurchaseOrder` (no migration — columns exist):

1. **PO value** = `Σ(qty × rate)` over the PO's active lines — **no tax**, matching legacy `tVal` (L21727).
2. **Effective ceiling** for a non-admin approver = personal `users.approval_limit` when set (>0), else company `approval_config.po_manager_limit`, else the legacy default `100000` — mirror of `_getUserApprovalLimit` (L21602). Admins are unlimited (bypass the gate entirely).
3. Over-ceiling → `AuthorizationError` with the legacy message shape ("PO value ₹X exceeds your approval limit of ₹Y. Admin approval required.").
4. **User-edit screen** gains a "PO approval limit (₹)" field (`updateUserInputSchema.approvalLimit`, nullable number; blank clears → falls back to company limit). The field is disabled for admins (always unlimited).

### Alternatives Considered

- **Include tax in the PO value** — rejected. Legacy `tVal` is the pre-tax line sum; matching it keeps parity and avoids re-deriving tax at approve time.
- **Use the stricter of personal AND company limit** (legacy `_isPoApprover` checks personal; `_approvePO` checks company) — rejected in favour of `_getUserApprovalLimit`'s documented "personal overrides company" precedence, which is the single helper legacy uses to *describe* a user's limit. Simpler and matches the User screen's mental model.
- **Surface `approval_limit` as a number in the read shape** — rejected. The `numeric` column comes back from Drizzle as a string; kept as a string in `userSchema` (same convention as PO `rate`/`qty`) rather than coercing through the `as unknown as User` cast.

### Consequences

- Positive: closes the ADR-037 negative ("a manager added to po_approvers can approve POs of any size"). Approval Config is now fully enforced — list membership AND amount ceiling.
- Negative: the gate reads two extra rows (config + user) per approve call; negligible at this scale.
- Risks: none material. Companies with no `approval_config` row fall back to the 100000 default ceiling for non-admins — same as legacy.

---

## ADR-039: OSP auto-PR generation on JC outsource op (manager-triggered)

**Date:** 2026-06-01
**Status:** Accepted

### Context

Deferred audit item from ADR-036/ADR-037 (SYS-1 b / PUR-1 b): the legacy `_autoGenerateOspPR` (HTML L13302) fires when an operator *starts* a JC operation whose name matches a configured OSP process — it auto-creates a JW purchase request and, when the process has a vendor with auto-PO on, a draft JW PO. The React build never wired this; `osp_processes` (migration 0047) existed but nothing consumed it at op time. Outsource PRs only arose via SO/JW Planning or manual entry.

### Decision

Add an explicit endpoint `POST /op-entry/osp-pr` (service `generateOspPr` → `op-entry/osp-cascade.ts:generateOspPrForOp`). **No migration** — the link uses existing columns (`jc_ops.outsource_pr_id` / `outsource_po_line_id` / `outsource_status`, `purchase_requests.source_jc_op_id` + `pr_type='jw_osp'`).

- **Match**: `matchOspProcess` (pure, unit-tested) — first `osp_processes` row whose `processName` is a case-insensitive substring of the op's `operation` (legacy `_isOspOperation`). No match → `ValidationError` with guidance.
- **Dup guard**: op already linked (`outsource_pr_id`) or an existing non-deleted `jw_osp` PR with `source_jc_op_id = op.id` → `ConflictError`.
- **PR**: `IN-JWPR-NNNNN`, `pr_type='jw_osp'`, `status='open'`, qty = JC `order_qty`, item from the JC, `source_jc_op_id` + `source_so_line_id` carried, vendor from the matched process (sentinel `(vendor TBD)` in `vendor_code_text` when none, so `vendor_check` passes). Op linked + `outsource_status='pr_raised'`.
- **Auto draft PO** when the process has a vendor and `auto_po`: `IN-JWPO-NNNNN`, `po_type='job_work'`, `status='draft'`, one line. PR follows the React invariant (`po_id` set ⇒ `status='po_created'`); op → `outsource_status='po_created'` + `outsource_po_line_id`.
- Activity log: `CREATE PurchaseRequest` (+ `CREATE PurchaseOrder` when auto-PO), all in one transaction.

### Alternatives Considered

- **Trigger it from `startOp` like legacy** — rejected. `startOp` rejects outsource ops by design (the React build routes OSP through procurement, not the shop floor) and returns a `RunningOp`, a different shape. An explicit action is clearer and keeps `startOp` single-purpose.
- **Let operators trigger it (legacy parity)** — rejected. PR/PO inserts are gated to admin/manager at RLS (`purchase_requests_manager_write`). Gating `generateOspPr` with `requireWriteRole` matches the rest of the procurement module. **Deliberate DELTA**: in legacy (localStorage, no RLS) an operator triggers it on op-start; here a manager triggers it from the op-entry outsource panel. The op-entry UI shows the "Generate OSP PR" button only to admin/manager.
- **Keep PR `status='open'` after auto-PO (legacy keeps it 'Pending')** — rejected. The React build's PR→PO model is `po_id` set ⇒ `status='po_created'`; following it keeps Outsource Jobs / PR lists consistent.

### Consequences

- Positive: closes the last ADR-037 negative ("Outsource Jobs auto-trigger from op-entry is the bigger missing piece"). `osp_processes` config is now live. Managers get a one-click PR/PO from an outsource op.
- Negative: manager-gated, so a pure operator can't self-serve (DELTA above). Acceptable given the RLS model.
- Risks: none material — idempotent via the dup guard; whole flow is one transaction.

---

## ADR-040: Access Control enforcement stays UI-only + RLS — per-form server-side gating is a non-goal

**Date:** 2026-06-01
**Status:** Accepted (closes the AUDIT backlog)

### Context

ADR-035 shipped the Access Control matrix as UI-only enforcement (sidebar/dept gating + `canView/canEntry/canEdit` form helpers on the client) with an "unconfigured ⇒ allow-all" fallback for day-one rollout. The AC-1 PARITY doc §13 listed "service-layer write gating on the 30+ existing modules" as deferred to a focused audit. The final "wire the audit tasks" question was whether to add per-form access checks to every module's service layer.

### Decision

**Keep enforcement UI-only + RLS. Per-form server-side gating is an intentional non-goal**, not a deferral. Decided with the user 2026-06-01 (AskUserQuestion).

### Rationale

- **Legacy's own access checks are client-side.** The legacy app is a single HTML file with no server; its 173 `canView/canEdit` calls run in the browser. ADR-035's UI-only model is therefore *faithful* to legacy, not a shortcut.
- **RLS already enforces the real boundaries server-side** — company isolation on every table + role-based write policies (`*_manager_write`, admin-only on settings/users/access-control/approval-config). That is strictly more than legacy ever had.
- **Full per-form gating would be stricter than legacy and risks lockouts**, especially given the "unconfigured ⇒ allow-all" fallback (most non-admins are unconfigured on day one). Layering a fail-open server gate on top adds surface area without changing the effective boundary.
- The per-form matrix's job is to *tailor the UI* (hide forms/depts a user shouldn't see). That job is done client-side by design.

### Alternatives Considered

- **Focused gate on sensitive ops** (one `requireFormAccess()` helper on a few high-value write paths) — rejected for now; the genuinely sensitive paths (PO approve, user/access-control/approval-config/settings writes) are *already* admin/manager-gated at RLS + service `requireAdminRole`/`requireWriteRole`. No incremental boundary gained.
- **Full server-side gating across all 30+ modules** — rejected: most invasive, highest lockout risk, partially redundant with RLS, and exceeds legacy fidelity.

### Consequences

- Positive: closes the AUDIT backlog cleanly; no lockout risk; authorization model stays simple (RLS = boundary, matrix = UI tailoring).
- Negative: a determined non-admin who bypasses the UI and crafts raw API calls is still bounded by RLS/role but not by their per-form matrix. Accepted — the matrix is a UI affordance, and RLS is the security boundary.
- Re-open trigger: if a future requirement needs a hard per-form boundary (e.g. a compliance audit), revisit with the "focused gate" option as the starting point.

---

## ADR-041: Cross-cutting reports — shared SO phase-data engine; Stuck + SO Cycle Time shipped, Time Tracker deferred

**Date:** 2026-06-02
**Status:** Accepted

### Context

LEGACY_AUDIT.md flagged three cross-cutting report screens still missing (rows 90–92): Stuck Dashboard (`renderStuckDashboard` L18017), SO Cycle Time (`renderSOCycleTime` L18176), Time Tracker (`renderTimeTracker` L18954). The first two share one legacy engine, `_soPhaseData(soNo)` (L17870), which derives per-SO phase-transition timestamps and the day-gaps between them. User directed "build report" (2026-06-02). Parity spec: `docs/PARITY/reports-cross-cutting.md`.

### Decision

- **Shared engine** `apps/api/src/lib/so-phase-data.ts` (`loadSoPhaseData` + pure `computeDurations`/`diffDays`) — one correlated-subquery pass per SO over design_tracker / plans / job_cards / purchase_requests / goods_receipt_notes / op_log / assembly_units / invoices. Consumed by both report services. Read-only, no migration.
- **Stuck Dashboard** (`/stuck-dashboard`): 6 phase-level rules from the engine + 2 op-level rules (Production Op / QC Pending) from the existing `v_jc_op_status` view. Pure rule helpers extracted to `modules/stuck-dashboard/rules.ts` (DB-free → unit-tested).
- **SO Cycle Time** (`/so-cycle-time`): full phase/duration matrix + filtered-set averages (filters + averages client-side, matching legacy's per-render recompute) + client-side Excel export.
- **Time Tracker DEFERRED** — `op_log` has no `hours_worked` column (legacy sourced Production/QC hours from a mobile entry never built here). Only `design_time_log` has real hours. Build later "if required" once hours-capture exists (user direction 2026-06-02).

### Decisions within

- **Dispatch timestamp** = `assembly_units.dispatch_date` (real), falling back to SO `status IN (dispatched,closed)` → `updated_at::date` for SOs that skip assembly. Faithful for assembled equipment, approximate for pure component SOs.
- **Stuck thresholds** ship as constants (`DEFAULT_STUCK_THRESHOLDS`, legacy defaults) — no `stuck_thresholds` config store yet; legacy's editable-threshold modal is a follow-up. The legacy `db.stuckThresholds` had no server.

### Alternatives Considered

- Derive Time Tracker production hours from `running_ops` elapsed (start→ended_at) — rejected for now: elapsed ≠ hand-entered worked-hours, and the screen would still show 0 QC hours.
- Materialize phase data into a table/view — rejected: correlated subqueries are fine at our SO scale (hundreds); revisit if perf data warrants (ties to ADR-018 / T-042).

### Consequences

- Positive: two more legacy screens at parity; reusable phase engine for any future SO-lifecycle report; pure rule logic is unit-tested (16 tests) without a DB.
- Negative: Time Tracker remains a gap; dispatch phase is approximate for non-assembled SOs.

---

## ADR-042: Finance module — customer dispatch gates invoicing; full invoices + SO costing + stock valuation (migration 0050)

**Date:** 2026-06-02
**Status:** Accepted

### Context

Finance was the last largely-unbuilt sidebar section (LEGACY_AUDIT rows 9/71/72/74). Cost Center Master already shipped. User directed building the entire Finance module to legacy parity with all logic (2026-06-02 /goal). Legacy screens read: `renderInvoices` (L21096), `renderSOCosting` (L17249), `renderStockValuation` (L20927), plus the implicit customer-dispatch step. Three data-model conflicts were resolved with the user before building (AskUserQuestion 2026-06-02).

### Decision

Migration 0050 (additive + idempotent; existing data untouched) + four new modules: **customer-dispatches**, **invoices**, **so-costing**, **stock-valuation**.

1. **Customer dispatch gates invoicing (user direction).** Legacy gated invoice qty on `salesOrderLine.dispatchedQty`, which our model lacked. Built a customer Dispatch step + register: `customer_dispatches` (+`_lines`) records dispatch of **ready (produced + QC-accepted) qty** against SO lines and maintains a new `sales_order_lines.dispatched_qty` (service-incremented on create, decremented on cancel). "Ready" = final-op effective output (QC-accepted for QC/qc-required ops, received for completed outsource, else completed) via `v_jc_op_status`, minus dispatched. This also fills the long-standing customer Dispatch Register gap (our `/delivery-challans` is the *OSP/vendor* DC). **Dispatch also reduces on-hand stock** (user direction 2026-06-02): each line inserts a `store_transactions` row (`txn_type='out'`, `source_type='dispatch'`); the existing `apply_store_txn_to_balance` trigger (migration 0020) decrements `item_stock_balances`. Cancel inserts the `in` reversal. Free-text lines (no `item_id`) skip stock. Closes the produce+QC→stock-in (`qc_accept`) → dispatch→stock-out loop.
2. **Invoices.** Fleshed out the empty `invoices` table (subtotal/GST/due/status/client snapshot) + new `invoice_payments`. Create is gated on **dispatched − already-invoiced** qty per line; payments roll up `total_paid` + flip status unpaid→partial→paid; tax-invoice print (IGST vs SGST/CGST by client GSTIN state). `invoice_status` enum.
3. **SO Costing.** Material = with-material PO lines linked to the SO line (`source_so_line_id`, `po_type<>'job_work'`); Outsource = `jc_ops.outsource_po_line_id`; **Machine-Time = (cycle_min/60) × completed × machine.hour_rate** — added `machines.hour_rate` (₹/hr, default 0) + a Machine Master form field.
4. **Stock Valuation.** Value = `item_stock_balances.on_hand_qty` × rate, where rate = PO-line rate behind the latest GRN → latest PO-line rate → "No Rate" (GRN lines carry no rate in our model). Grouped by `item_type` (component/assembly), since our items lack the legacy 6-category facet.

### Alternatives Considered

- Invoice against ordered qty (no dispatch tracking) — rejected by user; per-line dispatch qty is wanted to track pending dispatch.
- Omit machine-time from costing — rejected by user; added hour_rate instead.
- Add a 6-value `category` to Item Master for valuation — rejected by user; group by existing itemType.

### Consequences

- Positive: Finance section at legacy parity; a real SO→Dispatch→Invoice→Payment chain with qty control; closes the customer Dispatch Register gap; reuses `v_jc_op_status`.
- Negative: dispatch readiness under-reports for outsource-ending JCs (edge); stock valuation rate depends on PO-linked GRNs (manual GRNs without a PO line show "No Rate"); machine-time is 0 until rates are entered.
- Validation: full typecheck + lint clean; all read SQL smoke-validated on dev DB; write paths (insert/update/RLS) validated via a transaction-rollback smoke (0 rows committed). End-to-end user testing pending per /goal.

---

## ADR-043: Tasks module — Task Board + Daily Task Reports (migration 0051)

**Date:** 2026-06-03
**Status:** Accepted

### Context

Tasks was the next unbuilt sidebar section after Finance (the legacy "Tasks" group: `taskboard` L14255 + `dailyreports` L14141). User directed building the entire Tasks section to legacy parity with all logic (2026-06-03 /goal), test once fully built, no per-step commit prompts, only surface genuine data conflicts. Both legacy `render*` functions + their helpers were read directly; PARITY spec at `docs/PARITY/tasks.md`. No data conflicts arose.

Distinct from the existing `daily-report` module, which is the **production** op-log machine report (singular `renderDailyReport` L10823) — a different screen reading `op_log`.

### Decision

Migration 0051 (additive + idempotent) + two new modules: **tasks** (Task Board) and **daily-task-reports**.

1. **Embedded arrays → own rows (CLAUDE.md anti-pattern #1).** Legacy stored `task.comments[]` and `report.tasks[]` as JSON arrays inside the Firestore blob. We split them: `tasks` + `task_comments`; `daily_reports` + `daily_report_lines`. The task's `linkedRef` value-object (contextual assignment) stays as four columns on `tasks` (it's a single embedded object, not an array, and the columns are queryable).
2. **Overdue is derived, never stored.** A task is overdue when `status != completed && due_date < today (IST)`. The status count cards count an overdue row ONLY as overdue (legacy L14270). The board's three real-status cards filter server-side; the Overdue card filters client-side on the derived flag (legacy clicking Overdue showed an empty list — a quirk; we make it usefully show the overdue rows that the count represents).
3. **Authorization.** Read = company isolation (RLS). Assign a task = admin/manager (`requireWriteRole`); legacy's board "+Assign" button is admin-only while context-assign allows admin/manager — unified to admin/manager so managers aren't locked out, matching our RLS manager-write convention. Update status / comment = the assignee OR admin/manager. Daily report create/edit = the owner OR admin (legacy `canEditThis = isAdmin || r.userId === userId`). RLS write policies use `current_user_id()` (migration 0016 helper): `tasks` self = `assigned_to`; comments/report-lines self = `created_by`; `daily_reports` self = `user_id`.
4. **Unread tracking.** A task assigned to me, `viewed_at IS NULL`, not completed → unread dot + header count. The board calls `POST /tasks/mark-viewed` once on mount (mirrors legacy `_markTasksViewed` on home render). The legacy one-per-session login toast is deferred (no global toast bus on web); the unread badge replaces it.
5. **Contextual assignment** (`_assignTaskFromContext`): the create endpoint accepts an optional `linkedRef {type,id,display,navPage}`; the source-module "Assign to user" buttons (PR/PO/SO/NC/CAPA/JC/GRN/DESIGN) are a per-screen follow-up — the data model + create path support them now.

### Alternatives Considered

- Keep comments/lines as JSONB columns (closer to legacy storage) — rejected: violates anti-pattern #1; rows are queryable/aggregatable (total-hours, counts).
- Store an `overdue` status — rejected: it's a function of due_date + today, would need a daily sweep to stay correct; derive on read instead.
- Reuse the existing `daily-report` module name — rejected: that's the production op-log report; named the new one `daily-task-reports` to avoid collision.

### Consequences

- Positive: Tasks section at legacy parity; assignee-self-service status updates with timeline + comment thread; per-user daily time reporting with hours roll-up; contextual-assignment-ready data model.
- Negative: My Work / home task surfacing (`wlRule_myTasks`) + the source-module assign buttons + a login toast remain follow-ups; no realtime (ADR-004 lists Task Allocation as a realtime candidate — deferred, polling is fine at scale).
- Validation: full typecheck + lint clean (4 pkgs); migration 0051 applied to dev DB; **16-check end-to-end smoke green** against the real dev DB (create/assign, status transitions setting started/completed dates, comments, unread + mark-viewed, non-writer authz block, daily-report create/edit/list with hours + counts), with full cleanup. End-to-end UI testing pending per user direction.

---

## ADR-044: Dashboard (home) module — role-aware landing + My Work + Widgets + Customize (migration 0052)

**Date:** 2026-06-03
**Status:** Accepted

### Context

The home landing page (`legacy renderHome` L2486) was still the thin welcome + KPI-tiles grid; the legacy home is a rich, role-aware dashboard. User directed building the entire Dashboard to legacy parity with all logic (2026-06-03 /goal), test once fully built, no per-step commit prompts, only surface data conflicts. PARITY spec at `docs/PARITY/dashboard.md`. (Note: `renderDashboard` L3658 is the **Production Dashboard**, already shipped — the "Dashboard" here is the home page.)

### Decision

Migration 0052 (`dashboard_config`) + an extended `dashboard` API module + a rewritten web home, all computed server-side (Rule #1/#6), reusing existing infrastructure.

1. **Role-aware home** (`GET /dashboard/home`). Layout resolved from `getMyAccess` (access-control): operator role → operator view; non-admin/non-manager with `!fullAccess` and a detected primary dept → specialist view (qc/purchase/design panels); else admin KPI view. Admin layout returns headline KPIs (active/overdue/due-week SOs, open/overdue JCs, machines running, today's output), a Today snapshot (GRNs/dispatches/ops running/completed), and a hand-rolled Needs Attention list (legacy L2630). Operator returns running ops + ready-to-work table + my-output. Specialist returns dept KPIs + panels.
2. **My Work engine** (`GET /dashboard/work-list`) — 9 dept-gated rules (legacy `_buildWorkList` L3196): PO-approval, PR-conversion, pending-QC, BOM-pending, my-tasks, my-CAPAs, overdue-JCs, overdue-PO, stuck-running-ops. Sorted by severity then age; each rule guarded so one failure can't sink the panel. Pure-SQL aggregation over `v_jc_op_status` + the source tables.
3. **Widgets view** (`GET /dashboard/widgets`) — 13 server-computed data widgets (numbers/bars/rows) in the user's saved order; `my_alerts` (reuses `/alerts`) + `quick_links` (registry) are composed client-side. `machine_loading` reuses the existing `getMachineLoading` utilization. Visibility gated by dept access.
4. **Per-user layout config** (`dashboard_config`, `GET`/`PUT /dashboard/config`) — `widgets` + `quick_links` as **jsonb ordered key-lists** (UI layout preference, not entity records → not the JSON-blob anti-pattern #1; null = show all). One row per user; RLS company_read + self_or_manager_write via `current_user_id()`. Customize screen reorders/toggles widgets + toggles quick links.
5. **Reuse over rebuild:** `getMyAccess` (role/dept detection + work-list gating), `v_jc_op_status` view (op/JC aggregates), `runAllAlerts` (Alerts view + my_alerts widget), `getMachineLoading` (loading widget), tasks/capa tables (My Work). The home also calls `POST /tasks/mark-viewed` on mount (legacy `_markTasksViewed`).

### Alternatives Considered

- Compute the dashboard client-side from raw data (legacy `calcEngine`) — rejected: violates "no business logic in the frontend"; everything aggregated server-side.
- `dashboard_config` as child tables (one row per selected widget) — rejected: widgets/quick-links are an ordered preference list of enum-like keys, not business records; jsonb mirrors legacy 1:1 and is queryable enough. Documented as an internal layout-preference choice, not a data conflict.
- Build a fresh alert engine for Needs Attention — rejected: Needs Attention is the legacy hand-rolled admin list (distinct from the `/alerts` registry which powers the Alerts view + my_alerts widget); both kept as in legacy.

### Consequences

- Positive: home at legacy parity — role-aware KPIs/operator/specialist, a cross-module My Work list, configurable Widgets + Quick Links with per-user persistence, classic Alerts view. Heavy reuse keeps it thin.
- Negative: operator/specialist layouts depend on access-control dept flags being set (else everyone gets the admin view — a safe default); `quickFill` deep-link into Op Entry from operator rows navigates to `/op-entry` without prefill (follow-up); login toast deferred (unread badge covers it).
- Validation: full typecheck + lint clean (4 pkgs); migration 0052 applied to dev DB; end-to-end smoke green against the real dev DB (home admin layout with real KPIs [2 active SOs/1 overdue/2 open JCs/12 machines], 9-rule work-list sorted, 15 widgets computed, config screen 15 widgets + 30 quick links, save/read/revert, widgets respect saved order). End-to-end UI testing pending per user direction.

---

## ADR-045: JW Master — client material moved to header + per-line rate (migration 0053)

**Date:** 2026-06-04
**Status:** Accepted

### Context

Screen-by-screen parity review of JW Master (legacy `renderJWMaster` L12642, `jwHeaderForm` L12784). Two model gaps vs legacy, both confirmed with the user (AskUserQuestion + /goal "build same as HTML"): (1) legacy has ONE header-level "CLIENT MATERIAL DETAILS" section per JW; our model stored the 4 material fields per-line. (2) Legacy JW lines carry a Rate ₹ + Amount (processing charge); our line had no `rate`.

### Decision

Migration 0053 (additive, non-destructive):
1. **Client material → header.** Added `client_material`, `client_material_qty`, `material_received_date`, `material_received_qty` to `job_work_orders`. Existing per-line material is copied up (SUM qtys, first material, max date). The old per-line columns are **left orphaned** (Drizzle no longer maps them) rather than dropped — non-destructive per rule #8 spirit.
2. **Per-line rate.** Added `rate numeric(12,2) default 0` to `job_work_order_lines`; the form/detail show Rate ₹ + Amount (qty×rate); JW value total = Σ line amounts.

Shared schema, service, web form/list/detail all refactored to the header-material + line-rate model. The JW create form gained the consistency features from the SO form (auto `IN-JW-#####`, client + New, item + `-rm` datalists, per-line amount).

**List = ONE ROW PER LINE (legacy parity).** Per the user's "same column / sequence / count / font" requirement (screenshot 23), the JW Master list was flattened to one row per `job_work_order_line` joined to its header — columns in exact legacy order: JW NO. · LINE · DATE · CLIENT · CLIENT PO · ITEM CODE · PART NAME · QTY · JC QTY · MATERIAL · DUE · STATUS · REMARKS · (Edit/Del). MATERIAL renders as legacy colored TEXT (✓ Full green / ◑ Partial amber / ✕ Not Received red) keyed on header `material_received_qty` vs the line's `order_qty` (legacy L12648). `listJobWorkOrders` returns line rows (`JobWorkOrderListItem` redefined: jwId/lineId/code/lineNo/itemCode/partName/orderQty/jcQty/dueDate/status/remarks/header-material); the party-grn JW picker dedupes by `jwId`.

### Alternatives Considered

- Keep material per-line (more granular) — rejected by user; legacy is header-level and that matches the real workflow (one client-material batch per JW order).
- Drop the orphaned per-line material columns — deferred; leaving them is non-destructive and they're ignored by the ORM. Can drop in a later cleanup migration.

### Consequences

- Positive: JW Master 1:1 with legacy — header CLIENT MATERIAL DETAILS section, per-line Rate + Amount, JW order value. Material status correct from header.
- Negative: 4 orphaned columns remain on `job_work_order_lines` (cosmetic DB debt).
- Validation: typecheck + lint clean (3 pkgs); JW service test updated to the new model; migration 0053 applied to dev DB; 8-check end-to-end smoke green (header material persist/format, per-line rate, list aggregates + material badge, update merge). End-to-end UI test pending per /goal.

---

## ADR-046: "+ Add User" creates the Supabase Auth account from the API (admin sets initial password)

**Date:** 2026-06-09
**Status:** Accepted

### Context

User Management (legacy `renderUsers` / `_addUserFull`) had a "+ Add User" button; our
rebuild dropped it on the theory "Supabase Auth owns invites." The `on_auth_user_created`
trigger (`0001_post_init.sql`) does seed a `public.users` row on every auth signup — but with
`company_id=NULL`, `is_active=false`, `role=viewer`. The admin list is company-scoped
(`where company_id = <admin company>`), so a freshly-provisioned user is **invisible and
unassignable through the UI** — onboarding required raw SQL. The screen's own subtitle ("once
they sign in, they appear here") was therefore misleading.

### Decision

Add `POST /users` (admin-only). The service calls `supabaseAdmin.auth.admin.createUser(...)`
with `email_confirm: true` and the admin-supplied password; the insert fires the existing
trigger, then the service **promotes** that row (sets `company_id`, `role`, `full_name`,
`phone`, `is_active`, `approval_limit`) via the RLS-bypassing `db` client — needed because the
row's `company_id` is still NULL and a company-scoped context can't see it. The Supabase
service-role client was extracted to `lib/supabase-admin.ts` and reused by the auth plugin.
New web route `users/new`. Access matrix + PO-approver flag stay on their own screens (same
split as legacy).

**Credential method:** admin sets an initial password (handed to the user directly) rather
than email-invite links — the factory's Supabase Auth SMTP isn't configured, and an
email-dependent flow would block onboarding entirely.

### Alternatives Considered

- **Email invite link (`inviteUserByEmail`)** — rejected: requires Supabase Auth SMTP, not set up; no email = no onboarding.
- **Auto-provision into a company on first login (change `auth.ts`)** — rejected: users land with zero access until edited, and `company_id` assignment from a login event is ambiguous in a multi-company schema.
- **Leave as-is, document the SQL** — rejected: onboarding a user is an admin task, not a developer task.

### Consequences

- Positive: full legacy parity; admin onboards end-to-end in one screen; no SQL.
- Negative: API now holds the create-auth-user capability (already had the service-role key for token verification, so no new secret/surface).
- Risks: initial passwords are admin-chosen — operational hygiene (rotate on first login) is a training point, not enforced.

## ADR-047: SO Documents on a unified `file_registry` table (migration 0055)

**Date:** 2026-06-11
**Status:** Accepted

### Context

Legacy `renderSODocs` (L19478) reads ONE system-wide `db.fileRegistry` array that
aggregates every uploaded file (drawings, QC docs, inspection, TPI, PO docs, dispatch…)
keyed — among other ids — by `soNo` + `soLineNo`. Our architecture instead stores files
per-module (item `drawing_file_path`, the `qc_documents` table), so there was no place to
back an SO Documents screen. User was presented three options (extend `qc_documents`, a
dedicated `so_documents` table, or a full unified registry) and chose the **full unified
registry** plus surfacing existing QC docs read-only.

### Decision

New `file_registry` table — the canonical general-purpose file-metadata store going forward
(nullable links: `sales_order_id`, `so_line_id`, `so_line_no`, `job_card_id` + `*_code_text`
snapshots; `category`, `doc_type`, `file_name`, `storage_path`, `file_size`, `file_type`,
`status` active|archived; audit + soft-delete). RLS: company read; write to any company
member except `viewer`. Files live in the existing `qc-docs` Storage bucket (`so-docs/`
folder); the client uploads direct then POSTs metadata. The **SO Documents screen is the
registry's first producer/consumer**. `qc_documents` keeps its own table (it carries the QC
matrix columns) and is **UNION'd read-only** into the SO Documents detail (matched to a line
via the JC's `source_so_line_id`) — not duplicated into the registry. Other producers
(item drawings, dispatch, PO) can register here incrementally; not rewired in this pass.

### Alternatives Considered

- **Extend `qc_documents`** — rejected: overloads QC semantics and inherits its qc/admin/manager-only write policy for general docs.
- **Dedicated `so_documents` table** — rejected by user in favour of a single registry that other modules can grow into.
- **Rewire every upload path at once** — deferred: large multi-module change; the table is ready, producers wire in incrementally so we ship a testable slice now.

### Consequences

- Positive: legacy SO-Documents parity (one pane per SO, files by line→category); a real registry other modules can adopt.
- Negative: two file-metadata tables co-exist (`qc_documents` + `file_registry`) until/unless QC migrates; SO Documents must UNION them.
- Risks: registry isn't yet the single source of truth (only SO-docs uploads + read-only QC today); ZIP/archive power features deferred to backlog.

## ADR-048: Backlog cleanup pass — ISSUES 013–016 (migration 0056)

**Date:** 2026-06-13
**Status:** Accepted

### Context

Four backlogged parity gaps were cleared in one pass after the user asked to "complete all
issue at once": 013 (SO Master client-PO 📎), 014 (contextual "Assign to user 👤+"), 015
(SO delivery-schedule milestones), 016 (click-to-sort master list headers).

### Decision

- **016 — server-side sort, not client.** The master lists are server-paginated, so
  `getSortedRowModel` would reorder only the visible 25 rows. Added `sortBy`/`sortDir` to the
  clients/items/vendors list query + service (`ORDER BY` on code|name, default code asc) and a
  reusable `<SortTh>` header (asc→desc→none) driving URL search params. Scoped to the three
  canonical master lists where the gap surfaced; other lists extend on demand via `SortTh`.
- **014 — reuse the Tasks `linkedRef` path (ADR-043), build only the UI.** One reusable
  `<AssignTaskButton>` (wraps `AssignTaskModal`, lazy user-options fetch so it costs no request
  until opened, self-gates to admin/manager) dropped into all 8 legacy `_assignTaskFromContext`
  call sites.
- **015 — dedicated `so_milestones` table (migration 0056).** SO-level lots {lotNo, qty,
  dueDate, remarks}, merged with the same id→update / new→insert / absent→soft-delete semantics
  as sales_order_lines. Repeatable form section (component SOs) + read-only detail panel.
- **013 — reuse `file_registry`, no new SO column.** Client-PO file is a `file_registry` row
  with the new `client_po` category. Upload + ⬇View on the SO detail (`ClientPoFileBar`); SO
  Master list LATERAL-joins the latest active client_po file → 📎 link. Create-form-time upload
  deferred (the SO id only exists post-create); upload-from-detail covers the gap.

### Alternatives Considered

- 013 add `client_po_file_url` columns to `sales_orders` — rejected: `file_registry` (ADR-047)
  already models exactly this; a column would fork file storage again.
- 015 store milestones as jsonb on `sales_orders` — rejected: violates the no-JSON-blob rule
  (CLAUDE.md §12); a child table merges cleanly and is queryable.
- 016 client-side `getSortedRowModel` — rejected: only sorts the loaded page, misleading on
  paginated data.

### Consequences

- Positive: four parity gaps closed; reusable `SortTh` + `AssignTaskButton` primitives for the rest of the app; `file_registry` gains its second producer (client-PO), validating the ADR-047 unified-registry bet.
- Negative: `so_milestones` is a new table to back up/migrate; sort is only on three lists so far (inconsistent until others adopt `SortTh`).
- Risks: low — all additive; 11/11 SO service tests green after the SO read/write changes.

## ADR-049: Admin sets/resets passwords directly (no email); first-admin bootstrap script

**Date:** 2026-06-13
**Status:** Accepted

### Context

During the trial-run go-live, Supabase password-recovery emails failed with
`email rate limit exceeded`. Supabase's built-in email service is testing-only:
a low per-hour cap, sends only to addresses in the project org, no delivery SLA.
Resend (the stack's intended provider) is not yet configured (empty creds), and
wiring real SMTP requires a Resend account + DNS domain verification at GoDaddy.
The team needs to log in now. The login-link flow is also unreliable here because
eScan/Seclore + Gmail link-scanners consume the single-use OTP before the user
clicks (the earlier `otp_expired`).

### Decision

Add an admin-only **Set / reset password** action that sets a user's Supabase
Auth password directly via the service-role Admin API
(`auth.admin.updateUserById`) — no email, so it's immune to the email rate limit.
- API: `POST /users/:id/set-password` (admin-only; verifies the target is a live
  user in the admin's company before touching Auth). `public.users.id` ==
  `auth.users.id`, so one id addresses both.
- Web: a "Set / reset password" panel on the user edit screen.
- First-admin bootstrap (chicken-and-egg: you must be logged in to use the
  feature): gitignored `apps/api/src/_set_password.ts` sets any user's password
  via service role from `.env.local` — run once to set the admin's password.

This extends the create-flow choice (ADR-046: admin sets the initial password
instead of email invites) to the whole password lifecycle.

### Alternatives Considered

- Custom SMTP via Resend now — rejected for the trial: needs a Resend account +
  GoDaddy DNS verification; deferred to post-trial. Still the long-term fix so the
  self-service "Forgot password?" link (shipped) works for everyone.
- Raise Supabase's built-in email rate limit — rejected: the built-in service
  caps regardless and only sends to org addresses; not a real fix.

### Consequences

- Positive: team can be onboarded + recovered with zero email dependency; works
  behind DLP link-scanners; no rate limit.
- Negative: admins handle password distribution manually (acceptable for an
  internal tool at this scale); self-service reset still needs SMTP later.
- Risks: low — admin-only, company-scoped target check, same Admin API already
  trusted by create (ADR-046). 18/18 users service tests green (+2).

## ADR-050: Re-adding a soft-deleted user's email revives the account

**Date:** 2026-06-13
**Status:** Accepted

### Context

During trial onboarding, an admin deleted a user ("japan") then tried to + Add
User with the same email and got "A user with this email already exists." Cause:
`softDeleteUser` only sets `public.users.deleted_at` (rule #8 — no hard deletes);
the **Supabase Auth account is never removed**, and Trash (ADR-036) doesn't cover
users. So the email stays registered in `auth.users`, `createUser`'s
`auth.admin.createUser` collides, and the deleted profile is unreachable (hidden
from the list, not restorable via Trash).

### Decision

When `createUser` hits "already registered", look up the existing auth user and
the matching `public.users` row, and **revive** it (clear `deleted_at`, re-promote
into the admin's company with the new role, reset the password to the one just
entered) — but ONLY if the existing profile is soft-deleted or orphaned
(`company_id` NULL). A live, company-assigned user still returns `ConflictError`,
so we never silently reset a colleague's password or absorb another company's
user. `createUser` now also sets `deleted_at = null` on the promote/update.

### Alternatives Considered

- Hard-delete the auth account on user delete — rejected: violates the
  soft-delete-only rule and destroys the audit/identity link irreversibly.
- Add "User" to the Trash registry for restore — viable later, but doesn't fix
  the "re-add same email" reflex the admin actually used; revive-on-recreate is
  the expected UX. May still add Trash support separately.

### Consequences

- Positive: delete-then-re-add an email "just works"; no orphaned-auth dead-end.
- Negative: a deleted user's history rides along on revive (same row/id) — usually
  desirable, but it's not a clean-slate account.
- Risks: low — company/active guard prevents cross-company or live-duplicate
  takeover. 19/19 users service tests green (+1 revive test).

## ADR-051: Job Cards write layer — legacy parity for create/edit/delete

**Date:** 2026-06-13
**Status:** Accepted (in progress — create + delete shipped; update + React modal next)

### Context

Job Cards was read-only (list + view + print). Legacy has a full create/edit
modal (`jcModalBody` L5943, `addJC` L6020, `editJC` L6076) with SO/JW cascade +
balance validation, operation routing (machine/QC/outsource), QC documents,
route-card auto-load/save, and admin delete (`delJC`). Goal: build Job Cards 1:1
with legacy including all logic.

### Decision

Add a write layer to the job-cards module mirroring the legacy logic, mapped to
the relational schema:
- **Codes:** `IN-JC-#####` series, per company (legacy `nextJCNo`).
- **Source link + balance:** input carries `sourceSoLineId` XOR `sourceJwLineId`;
  qty validated against `line.order_qty − Σ(other active JCs on that line)`
  (legacy `CASCADE.orderBalance`, now per-line not per-order — the relational model
  links a JC to a specific SO/JW line).
- **Ops:** machine + outsource vendor chosen by CODE in the modal, resolved to IDs
  server-side with the code kept as text fallback (`machine_code_text` /
  `outsource_vendor_text`). Validations mirror `addJC` (process ⇒ machine+op, qc ⇒
  op name, outsource ⇒ vendor).
- **opType:** `process | qc | outsource` only — `jc_ops.op_type` has no `osp`
  value. Legacy's create-time OSP reclassification is intentionally dropped: OSP is
  handled at **op-entry start** via the existing `osp_processes` cascade
  (`op-entry/osp-cascade.ts`), the correct place in this architecture.
- **Drawing → Storage** (`drawing_file_path`); **QC docs → unified file_registry**
  (ADR-047, `job_card_id` link, category `qc-docs`). Both uploaded client-side first.
- **Delete:** admin-only **soft** delete of the JC + its ops; op_log is never
  hard-deleted (FK `op_log.jc_op_id` is ON DELETE CASCADE), preserving history.

### Consequences

- Positive: JC create/delete reach legacy parity with full server-side validation;
  no schema migration needed (tables already supported it).
- Negative: route-card auto-save and the update (ops-replace) path are follow-ups
  in this same ADR; update must guard ops that have started (`_hasOpStarted`).
- Risks: low — additive endpoints, 11/11 job-cards service tests green (+ create/delete).

## Pending Decisions

- **ADR-020 (pending):** Domain name and transactional email-from address.
- **ADR-021 (pending):** How to handle Seclore FileSecure DLP tagging on legacy spec source and migration scripts (egress policy).

## ADR-052: Bug-report fixes — server-authoritative codes, read-side item-code resolution, dropdown/auto-fill UX

**Date:** 2026-06-23
**Status:** Accepted

### Context

Bug report (Vinay, 23 Jun 2026) — 16 listed / 12 documented issues across JWSO, Item
Master, Party Material, Outward DC, Client, Sales Order. Root themes: codes generated
only in the frontend (race/blank), item codes lost on read after write-time resolution,
and type-to-search pickers that read as free-text and silently failed to commit a value.

### Decision

- **Codes are server-authoritative** (Rule 6.1 — no business logic in frontend).
  `nextJwCode` (IN-JW-#####) and `nextClientCode` (CLI-###) added, mirroring `nextJcCode`.
  `code` made optional on the JWSO + Client **create** schemas; server generates when
  blank, still honours a caller-supplied code. Frontend code fields are read-only.
- **Read-side item-code resolution** (bugs 1.3/1.4): `job-work-orders` get/update/create
  reads back-resolve `item_id → items.code` and surface it on `itemCodeText`, so the
  detail page and edit form show the readable code (was null / "— linked —"). Round-trips
  safely — the write path re-resolves code → id.
- **Line auto-fill** (2.1/6.1): SO + JWO item-code change fills Part Name / Material /
  Drawing / UOM from the master, fill-only (never clobbers manual edits). No "Buy" field
  exists in the SO schema — 6.2 maps to these item-derived fields.
- **Picker UX** (3.1/3.2/3.4/4.1): Party-material item/client pickers open on focus;
  Party-GRN save resolves typed material code → id before failing; JWPO converted to a
  native `<select>`; JW-line item codes surfaced via datalist after JWSO select (3.3).

### Alternatives Considered

- Frontend-only code preview kept as authoritative — rejected: violates Rule 6.1, races
  across concurrent users (the original bug).
- New `resolvedItemCode` field on the line read shape — rejected: overloading the existing
  `itemCodeText` round-trips cleanly with the write path and needs no schema/UI churn.

### Consequences

- Positive: codes never blank, item codes always visible, pickers behave as dropdowns,
  Party-GRN saves. Typecheck + lint clean.
- Negative / Risks: `MAX+1` code generation is not concurrency-proof (established repo
  convention; acceptable at 15–20 users). DB-backed service tests run in CI only.

## ADR-053: "+ New SO" brought to 1:1 legacy parity, with 3 deliberate deviations

**Date:** 2026-06-28
**Status:** Accepted

### Context

Live-trial request (Vinay) to map the entire "+ New Sales Order" form against the legacy
HTML (`soHeaderForm` L12183 / `_soLinesHtml` L12158 / `addSO` L12413) and rebuild it
1:1 including all logic. Mapping surfaced parity gaps (plain selects vs. type-to-search,
card line layout vs. table, no PO-doc upload, no duplicate-PO guard, no item-master
enforcement) and three genuine conflicts between the legacy spec and recent product
decisions / existing ADRs, each resolved by the user before building.

### Decision

Rebuilt `sales-order-form.tsx` to mirror the HTML, **no DB/schema change**:

- **Searchable master pickers** — client and per-line Item Code are now server-searched
  `SearchableSelect`s (scales past the old 200-row datalist cap; 1149 items in trial).
- **Inline client quick-add** — "+ New" opens a modal (mirrors legacy `addClientQuick`)
  instead of navigating away; created client is auto-selected.
- **Line items as a table** with per-line Amount, SO totals (subtotal / GST / grand) +
  an "N items / M pcs" count (legacy `_soTotalsHtml` L12366).
- **Client-PO document upload** — captured in the form, uploaded after save against the
  new SO into `file_registry` category `client_po` (legacy post-save upload, `addSO` L12459).
- **Duplicate Client PO No. guard** — `createSalesOrder` rejects a `client_po_no` that
  already exists on another SO **or** JWSO (legacy L12431). App-level (no DB unique index).
- **Item Master required on SO component lines** — the master-only picker + a submit guard
  reject any component line without a master item (legacy `_badIC` L12443). **Supersedes
  ADR-012 #10 for SO component lines** (off-master `itemCodeText` still allowed for
  equipment Part No. and other modules).
- Milestones saved only when `qty > 0` (legacy `_getSoBaseData` L12310).

**Three deliberate deviations from the HTML (user-approved):**

1. **Status** is NOT shown on create (defaults `open`); selectable only on edit.
2. **Cost Center** field removed from the SO form; Finance/SO-costing derives the cost
   centre from the SO No. via `COALESCE(so.cost_center, so.code)`. Legacy `cost_center`
   column retained for legacy rows.
3. **Equipment value** captured as ₹/unit (total = rate × qty), not the legacy absolute
   `SO Total Value`.

### Alternatives Considered

- Restore Status + Cost Center to match HTML exactly — rejected by user (settled product
  decisions; cost centre = SO No.).
- Keep ADR-012 #10 free-text item codes on SO lines — rejected by user (wants Item-Master
  enforcement like legacy); achieved via the picker so off-master is structurally impossible.
- Enforce item-master server-side for all line types — rejected: equipment Part No. is
  legitimately free text in legacy; enforcement is scoped to component lines (client-side
  via picker + submit guard).

### Consequences

- Positive: form matches legacy behaviour + layout; pickers scale; duplicate POs blocked;
  master-only items. Shared/API/web typecheck + lint clean, web build green.
- Negative / Risks: duplicate-PO + item-master checks are app-level (not DB constraints) —
  consistent with the repo's `MAX+1` / app-guard convention. Skipped the cosmetic
  green/amber item-code border cue (the picker shows the resolved item instead).

## ADR-054: Document-number override — editable codes with live duplicate/format check (Phase 1: SO/PO/GRN)

**Date:** 2026-06-28
**Status:** Accepted

### Context

Document numbers were auto-generated and uneditable for SO, and user-typed-required for
PO/GRN, with no live duplicate feedback. Request: prefill the next number but let the user
override it, check uniqueness in real time, show inline feedback, and disable Save on
error — built once as reusable parts, then wired to SO/PO/GRN (12 more types in Phase 2).

### Decision

- **One backend endpoint** `GET /doc-numbers/check?type=&code=` returns `{ exists, nextCode,
  formatValid }` — per-company, soft-delete-aware. Per-type table/prefix/digits live in a
  shared `DOC_NUMBER_FORMATS` map + `TABLE_NAME` (extend both for Phase 2).
- **One hook** `useDocNumber` (TanStack Query + a new shared `useDebounce`, 500 ms) and **one
  component** `DocNumberInput` (prefill, ✓/✗/Checking indicator, blur auto-pad,
  `onValidityChange` to disable Save). Pure logic (`evaluateDocNumber`/`docNumberError`/
  `padDocNumber`) lives in `@innovic/shared`, unit-tested without a DOM.
- **PO/GRN gained auto-generation** (`nextPoCode`/`nextGrnCode`, MAX+1, `IN-PO-/IN-GRN-#####`);
  their create `code` became optional (blank = server auto). SO was already so.
- **Two duplicate layers:** the live frontend check (UX) + the existing partial unique index
  `(company_id, code) WHERE deleted_at IS NULL` (data safety). No migration.
- Added a **jsdom test setupFile** so RTL tests run (the env was already configured).

### Deviations (user-approved)

- SO format is **`IN-SO-#####`** (project reality), not the spec's `SO-#####`.
- **Strict format is enforced at the form** (DocNumberInput) + endpoint `formatValid`, but the
  backend Zod create schema keeps the loose `codeRegex` so bulk-import and legacy codes like
  `SO-436/A` aren't rejected.
- The earlier bespoke `/sales-orders/next-code` + `useNextSoCode` are left in place but
  superseded by the generic endpoint/component.

### Consequences

- Positive: one reusable trio drives all doc-number fields; Phase 2 = add a config row +
  drop in `<DocNumberInput>`. Tests: shared 11, api 6, web hook 5 + component 5; build green.
- Negative / Risks: format strictness is UI-side, not DB-enforced (matches the repo's
  app-guard convention). New `/doc-numbers/check` endpoint needs an API redeploy.

## ADR-055: JW full plan parity — plans.jw_line_id, not a parallel table
**Date:** 2026-07-10
**Status:** Accepted

### Context
JWSOs (IN-JW-00001, IN-JW-00002) never appeared in SO/JW Planning. Root cause:
`getPlanningSoList` queried only `sales_orders`, and `job-cards/service.ts` had an
explicit guard ("...until JW is supported in Planning") — JW planning was a deferred
migration gap, not a regression. Legacy `renderSOPlanning` merged SOs + JWs via
`CASCADE.allOpenOrders()`. User chose **full plan parity** (JWs get the same
Mfg/Buy/OSP → execute → JC lifecycle as SOs), not a lighter visibility-only path.

### Decision
Extend the existing `plans` table with a nullable `jw_line_id` FK
(`job_work_order_lines`), rather than build a parallel `jw_plans` table. A plan carries
at most one of (`so_line_id`, `jw_line_id`); the service sets whichever the source is.
On execute, `executeManufacture` passes both `sourceSoLineId`/`sourceJwLineId` to the
JC (job_cards CHECK `num_nonnulls(...) <= 1` guarantees ≤1 is set). so-planning list +
detail union JWs: list appends JW headers (planned via `jw_line_id`, direct JCs via
`source_jw_line_id`); detail falls through to `getJwPlanningDetail` when the id isn't an
SO. Wire shape gains a `source: 'so' | 'jw'` discriminator so the Create-Plan modal
posts `jwLineId` vs `soLineId`.

### Alternatives Considered
- Parallel `jw_plans` + `jw_plan_ops` tables — rejected: doubles the plan lifecycle,
  the dashboard, execute, and every rollup query; the plans CHECKs never referenced the
  source line, so one nullable column is enough.
- Visibility-only JW (show + "Create Job Card", no Plan step) — offered; user rejected,
  wants full make/buy/outsource planning for JWs.

### Consequences
- Positive: JWs reuse the entire plan engine (types, ops, execute, PR/JC creation,
  dashboard) with one additive column; no constraint relaxation → low migration risk.
- Negative: PRs from JW Buy/OSP plans have no JW source-line link (`purchase_requests`
  has no `source_jw_line_id`); they still carry item/qty + a "from plan PLN-xxxx" remark.
  Acceptable for now — revisit if PR→JW traceability is needed.
- Risks: `0060_plans_jw_line.sql` is **deploy-blocking** — so-planning reads now
  reference `plans.jw_line_id`; must be applied before/with the deploy or all Planning
  reads 500. Pending prod apply alongside 0058/0059.

## ADR-056: JWSO create/edit header brought to Sales-Order parity
**Date:** 2026-07-14
**Status:** Accepted

### Context
The "+ New JWSO Order" header lagged the "+ New Sales Order" header: plain
auto-generated JWSO No. (no live check), a native `<select>` client picker capped
at 200 with a navigate-away "+ New", a visible Status dropdown on create, no
GST %/totals, no header-level Due Date, and a plain optional Client PO No. with no
Email Ref option. User asked for the JWSO header to behave exactly like the SO
header.

### Decision
Mirror the SO header on JWSO, minus the fields that don't fit the job-work domain:
- **JWSO No.** → `DocNumberInput type="job_work_order"` (live duplicate/format check
  + prefill). Added `job_work_order` → `IN-JW-#####` to `DOC_NUMBER_FORMATS` +
  `TABLE_NAME` (`job_work_orders`) — no migration; reuses the existing series.
- **Client** → server-searched `SearchableSelect` + inline quick-add modal.
- **GST %** → new `job_work_orders.gst_percent numeric(5,2) NOT NULL DEFAULT 18`
  (migration 0061) + a subtotal / GST / grand totals box under the lines.
- **Header Due Date** → UI-only, applied to every line on save (as SO does); the
  per-line due-date input is removed from the JWSO line card.
- **Client PO No. required OR Email Ref** → on create at least one is required; the
  Email Ref uploads under the existing `email_reference` category (no backend change
  — JWSO documents already reuse `soDocCategorySchema`) and is viewable inline + in
  the JWSO Documents panel.
- **Status** → hidden on create (defaults to `'open'`); still editable on the edit form.

Kept JWSO-specific: the free-text line editor (JWSO does NOT enforce Item Master)
and the Client Material Details block.

### Alternatives Considered
- **Also add Order Type + BOM/equipment branch (full SO parity)** — rejected by the
  user: "no type field in create jwso" and "in jwso we don't create bom". Type/BOM
  don't fit job-work (client supplies material, we bill a processing charge).
- **Add Delivery Schedule / Milestones** — deferred: not a header field, needs a new
  `job_work_order_milestones` table.
- **`gst_percent` as a UI-only field (no column)** — rejected: SO persists it; parity
  means the JWSO remembers its GST % on reopen.
- **`gstPercent` with `.default(18)` in the create schema** — rejected: the inferred
  output type then makes it required and breaks 13 direct-construction service tests.
  Used `.optional()` + service/DB default 18 instead (identical behaviour).

### Consequences
- Positive: one consistent order-header UX; JWSOs now show priced totals; stronger
  proof-of-order (PO No. or email) on create.
- Negative: JWSO lines lose their independent per-line due dates (collapse to the
  header Due Date on save, same trade-off SO made).
- Risks: `0061_jw_gst_percent.sql` is **deploy-blocking** — the JWSO service selects
  `gst_percent`; must be applied before/with the code deploy or every JWSO read 500s.

## ADR-057: Never nest `withUserContext` — read-back goes through an `*Internal(tx, …)` helper

**Date:** 2026-07-16
**Status:** Accepted

### Context

Creating an OSP process in Settings failed with `NotFoundError: OSP process <uuid>
not found` — naming the very row it had just inserted. Downstream, "Generate OSP PR"
on a JC op then reported `Operation "Machining" does not match any configured OSP
process`, because no OSP process had ever actually persisted.

One root cause. `withUserContext` opens a real transaction (`db.transaction`), and on
the postgres-js driver `db.transaction` → `sql.begin()` **reserves a separate
connection from the pool**. `createOspProcess` INSERTed on its own transaction, then
called `getOspProcess(id, user)` — a *second* `withUserContext`, therefore a second
transaction on a second connection, which by read-committed isolation cannot see the
outer transaction's uncommitted INSERT. It threw `NotFoundError`, and that throw
unwound the outer transaction, rolling the INSERT back. The write was lost, and the
user's error message pointed at a row that momentarily existed.

`updateOspProcess` had the same nesting with a quieter failure mode: the read landed
on a connection that couldn't see the uncommitted UPDATE, so it returned **stale**
data rather than erroring.

### Decision

`withUserContext` is never nested. Any function that must read a row back while
inside a transaction calls a private `*Internal(tx, id, companyId)` helper that runs
on the **existing** `tx`. The public `getX(id, user)` becomes a thin
`withUserContext(user, (tx) => getXInternal(tx, id, companyId))` wrapper, so route
handlers are unaffected.

This is already the dominant repo pattern — `purchase-orders`, `invoices`, `plans`,
`tasks`, `service-pos`, `customer-dispatches`, and `daily-task-reports` all use
`*Internal(tx, …)`. `osp-processes` was the outlier.

### Alternatives Considered

- **Move the read-back outside the transaction** (as `job-cards` does — it awaits
  `withUserContext` to completion, *then* calls `getJobCard`) — works, and is not a
  bug, but costs a second round trip and can observe a concurrent writer's changes.
  Fine where it stands; not worth churning.
- **Pass `tx` through the public `getX`** (make the param optional) — rejected: an
  optional-`tx` signature makes the unsafe call the default and the safe one opt-in,
  which is exactly backwards for a footgun this quiet.
- **Savepoints** (postgres.js `sql.savepoint()`) — rejected: only reachable from the
  transaction-scoped handle, so it would require threading `tx` anyway, and the
  nesting buys nothing here.

### Consequences

- Positive: OSP process create/update persist correctly; update returns fresh rows.
  One fewer connection held per write (nested transactions held two, which under the
  pool's default max can deadlock at concurrency).
- Negative: `getX` and `getXInternal` duplicate a signature.
- Risks: **the same nesting is live in `goods-receipt-notes/service.ts:610` and
  `:681`** — `createGoodsReceiptNote` / `updateGoodsReceiptNote` both `return
  getGoodsReceiptNote(header.id, user)` from inside their own `withUserContext`.
  Same shape, same predicted failure. Untouched here (one module at a time) and not
  yet reproduced at runtime — **needs its own task**.
- Test gap that let this ship: `osp-cascade.test.ts:157` seeds `ospProcesses` with a
  raw `db.insert`, so it covered the *matching* logic while the *create* path had no
  service test at all. `osp-processes/service.test.ts` now covers create→list
  round-trip and the update-freshness assertion.

## ADR-058: ADR-057 applied to GRN — and why our integration tests did not catch it

**Date:** 2026-07-16
**Status:** Accepted (closes the open risk in ADR-057)

### Context

ADR-057 flagged the same `withUserContext` nesting live in
`goods-receipt-notes/service.ts:610` / `:681` but had not reproduced it.

Fixing it surfaced a contradiction worth recording: unlike `osp-processes`,
**GRN already has thorough create coverage** — `goods-receipt-notes/service.test.ts`
calls `createGoodsReceiptNote` in ~10 tests and asserts on the returned detail
(`:153` onward). If create were broken, those tests would fail loudly. So either the
nesting was harmless, or the tests never run.

Rather than reason further, the driver semantics were probed directly (read-only,
`pg_backend_pid()`, no application data touched), reproducing the exact nesting shape
against the real DB:

```
outer connection pid : 1302602
inner connection pid : 1302603   -> DIFFERENT
```

A nested `db.transaction()` is definitively a **separate connection**, hence a
separate transaction that cannot see the outer's uncommitted rows. ADR-057's
mechanism is confirmed, not inferred.

### Decision

Apply ADR-057 to GRN: extract `getGoodsReceiptNoteInternal(tx, id, companyId)` and
call it from create/update on the existing `tx`. `getGoodsReceiptNote` stays a thin
`withUserContext` wrapper, so routes are unchanged.

### Consequences

- Positive: `createGoodsReceiptNote` / `updateGoodsReceiptNote` persist correctly;
  update returns fresh rows. ADR-057's open risk is closed.
- **The real finding — our integration tests cannot run.** They require a live DB,
  but `innovicerp/.env.local` carries a placeholder `DATABASE_URL`, and the only real
  database is production (which CLAUDE.md §9 forbids testing against). So the GRN
  suite has never executed, and coverage that exists on paper caught nothing. This
  bug reached production *through* a well-tested module.
- Risks: **this is systemic, not a GRN quirk.** Every service integration suite in
  the repo is in the same position. Until a dev/test database exists (CLAUDE.md §9:
  "a separate Supabase project for tests, OR a local Postgres container"), service
  correctness is only ever verified by typecheck + review, and any bug of this class
  ships silently. **Provisioning that test DB should be a task.**
- Both fixes here are verified by typecheck, lint, the pid probe above, and review —
  **not** by executing the test suites.

## ADR-059: PR detail carries its vendor/item display joins (`purchaseRequestDetailSchema`)

**Date:** 2026-07-16
**Status:** Accepted

### Context

Reported as two symptoms: "vendor and prices are updated in PR, but unable to create
PO" and "selected vendor does not show in PR".

The data said the PR was **fine**. `IN-JWPR-00001` had `vendor_id` → "priya
industries" and `est_cost` 1500.00 — both edits had persisted. The bug was entirely
on the read/display side, and it was two independent defects on the same screen:

1. **No vendor join on the detail read.** `purchaseRequestSchema` is the bare table
   row; only `purchaseRequestListItemSchema` extended it with `vendorName`/`itemCode`.
   `getPurchaseRequest` returned the bare row, so the two pages fed by it had no name
   to render and each hand-rolled a placeholder instead:
   - `from-pr.tsx:169` → `vendorCodeText ?? (vendorId ? '— linked —' : '—')`
   - `purchase-requests/routes/detail.tsx:199` → `vendorId ? '— linked —' : …`

   Every *other* module in the app renders `vendorName ?? vendorCodeText ?? '—'`
   (verified: GRN, PO, DC, JW-DC, and the PR **list** itself). These two were the only
   outliers, and both were outliers *because* the join was missing.

   It stayed invisible until OSP: `osp-cascade.ts` stamps `vendor_code_text =
   '(vendor TBD)'` (the `NO_VENDOR_TEXT` sentinel) when the matched OSP process has no
   vendor. The user then picked a real vendor — which sets `vendor_id` but leaves the
   sentinel in place — so the page kept rendering "(vendor TBD)" over a perfectly good
   vendor link. Any PR whose `vendorCodeText` was null would instead have shown the
   equally useless "— linked —".

2. **Create PO failed silently.** `from-pr.tsx` registered `code` with
   `required: 'PO No. is required'` but **rendered no field errors at all**
   (`grep -c formState.errors` → 0). The field defaulted to empty and, unlike the main
   PO form, did not use `DocNumberInput`. So the user had to know and hand-type
   `IN-PO-NNNNN`; pressing "✓ Create PO" with it blank made react-hook-form abort the
   submit with **no visible feedback** — the button simply did nothing.

### Decision

Add `purchaseRequestDetailSchema = purchaseRequestSchema.extend({ vendorName,
itemCode })` and return it from `getPurchaseRequest` via `LEFT JOIN vendors/items` —
the same joins the list already runs, per docs/PARITY/linked-display-audit. Both
consumer pages then use the app-wide `vendorName ?? vendorCodeText ?? '—'` precedence
and drop their placeholders.

On `from-pr.tsx`, replace the manual PO No. input with `DocNumberInput
type="purchase_order"` (prefills the next number, live duplicate check, gates submit
via `onValidityChange`) and render the `poDate` error.

### Alternatives Considered

- **Add `vendorName` to `purchaseRequestSchema` itself** — rejected: that shape is the
  table row and is also the create/update return; it would force a join into write
  paths that have no display consumer.
- **Resolve the name client-side from `useVendorsList`** — rejected: re-introduces a
  200-row cap as a correctness dependency and duplicates a join the server already does.
- **Only fix the display precedence** — rejected: without the join there is no name to
  show, so the page could only ever pick between two placeholders.

### Consequences

- Positive: PR detail and Create-PO show the real vendor and item code. Create PO
  works from a fresh page load with no manual number entry, and cannot fail silently.
- Negative: `getPurchaseRequest` grows two LEFT JOINs (indexed FKs, single row).
- Note: the `(vendor TBD)` sentinel is now cosmetic-only on a PR that has a real
  `vendor_id`. Not cleared on vendor pick — worth deciding separately whether the PR
  update should null `vendorCodeText` when `vendorId` is set.
- Verified by typecheck + lint across shared/api/web, and by running the new join
  against the live row (returns "priya industries "). **Not** verified by test suite —
  see ADR-058.

## ADR-060: Auto-generated document numbers made visible in create forms (per-module next-code preview)
**Date:** 2026-07-20
**Status:** Accepted

### Context
Many documents auto-generate their code server-side at insert (MAX+1 per company),
but the create form showed nothing — a blank/placeholder field ("Auto-generated on
save", "(auto on save)", "PLN-NNNN (auto if blank)"). Users couldn't see the number
they were about to get. Only the 5 central DocNumberInput types (SO/JW/PO/GRN/DC) and
party-materials/party-grn prefilled. This is Task 1 of the 2026-07-20 batch.

### Decision
Follow the existing party-materials/party-grn pattern: expose a per-module
`GET /<module>/next-code` endpoint whose service wrapper (`getNext*Code(user)`) reuses
that module's OWN generator, so the previewed number is computed the exact same way the
insert assigns it — preview == actual, by construction. The web side adds a
`useNext*Code()` query hook and prefills the code field once on create while blank
(read-only master-data fields show it; editable "auto if blank" fields prefill the value
but stay overridable). First increment (Class A): clients (CLI-###), vendors (VND-###),
operators (OP-###), plans (PLN-####), bom-master (BOM-#### on the `bom_no` column),
route-cards (IN-RC-#####), job-cards (year-scoped IN-JC-YY-#####, display-only field).

### Alternatives Considered
- **Extend the central DOC_NUMBER_FORMATS registry to cover all types** — rejected: the
  central `computeNext` hardcodes the `code` column + a simple `^prefix\d+$` shape, which
  breaks on bom-master (`bom_no` column) and job-cards (year segment), and risks the
  preview diverging from the module's real generator.
- **Prefill client-side from the recent list (like nc-register)** — rejected: racy and
  can disagree with the server's authoritative MAX+1.

### Consequences
- Positive: the next number is visible before save across all Class A create forms; one
  uniform, low-risk pattern; each module's generator stays the single source of truth.
- Negative: one small endpoint + hook per module (mechanical boilerplate).
- Note: editable fields submit the shown code, so a rare concurrent create can surface a
  ConflictError (server still enforces uniqueness); master-data forms keep the existing
  "blank → server generates" race-safety. Class B (forms with no code field yet) and the
  remaining tasks are separate increments.
- Verified by api+web typecheck and api+web lint (all green). **Not** verified by test
  suite — see ADR-058.

## ADR-061: Resolve the SO code on reads that show an "SO" column/field (SO-dash fix)
**Date:** 2026-07-20
**Status:** Accepted

### Context
Two reads displayed an SO column/field that rendered "—" even when the row's SO link
was set — the linked-display-audit gap (docs/PARITY) applied to sales orders. Task 2 of
the 2026-07-20 batch. (a) Purchase-request LIST "SO / JC" column only rendered
`sourceJcCode`; the list query never joined sales_orders, so an SO-sourced PR
(source_so_line_id set, jc null) showed a dash — even though getPurchaseRequest (detail)
already resolves soCode. (b) Service-PO LIST + DETAIL "SO / Cost Center" read the
denormalized `so_no_text`, which is never populated (create only ever stores so_ref_id),
so every SO-linked SPO showed a dash.

### Decision
Resolve the SO code on read via the FK join, mirroring the job_cards template
(source_so_line_id → sales_order_lines → sales_orders). PR list: add the two LEFT JOINs
+ `so.code AS "soCode"`, `sol.line_no AS "soLineNo"`, carry them through toListItem, add
both to purchaseRequestListItemSchema, and render the SO branch of the "SO / JC" column
(SO first, else JC, else dash). Service-PO: LEFT JOIN sales_orders on so_ref_id in both
listServicePos and getServicePoInternal, expose `soCode`, add to the list-item + detail
schemas, and render `soCode ?? soNoText ?? '—'` in both UI spots.

### Consequences
- Positive: SO-sourced PRs and cost-center SPOs now show the real SO in the list/detail
  instead of a dash. No schema/data change — pure read-side resolution.
- Negative: two more indexed-FK LEFT JOINs on those reads (single/limited rows).
- Note: the never-populated so_no_text on service_pos is now a harmless fallback behind
  the resolved soCode. Verified by shared+api+web typecheck and api+web lint.

## ADR-062: Show the Sales Order on the JW Outward DC (OSP returnable gate pass)
**Date:** 2026-07-20
**Status:** Accepted

### Context
The JW Outward DC (OSP returnable gate pass) had no SO column/field at all — the user
expected to see which Sales Order the outsourced parts belong to. The SO is not stored on
jw_dc_outward; it is reachable through the JWPO: jw_dc_outward.purchase_order_id →
purchase_orders → purchase_order_lines.source_so_line_id → sales_order_lines →
sales_orders. The OSP cascade (osp-cascade.ts) stamps the JWPO line's source_so_line_id
from the JC's sourceSoLineId, so the link is reliable — and null when the JC originated
from a JWSO rather than an SO (no SO to show).

### Decision
Add a resolved `soCode` to the JW Outward register list and detail. Both reads resolve it
via a LATERAL/aggregate over the JWPO's lines (string_agg DISTINCT so.code — a JWPO can in
principle span more than one SO). Add `soCode` to jwDcOutwardListItemSchema (detail extends
it), add an "SO" column to the outward register (between JWPO and Vendor) and an "SO" field
to the detail grid, each rendering `soCode ?? '—'`.

### Alternatives Considered
- **Resolve via the JC-op path (source_jc_op_id → jc → sourceSoLineId)** — unnecessary: the
  OSP cascade already copies the JC's SO line straight onto the PO line, so the direct
  source_so_line_id path is both simpler and what the data carries.
- **Denormalize an so_code onto jw_dc_outward at create** — rejected: read-side resolution
  needs no migration/backfill and can't go stale.

### Consequences
- Positive: the JW Outward DC list and detail now show the real SO; a JWSO-sourced outward
  correctly shows "—" (there is no SO). No schema/data change.
- Negative: one LATERAL subquery per outward row on the list read (bounded by page size,
  indexed FKs).
- Note: Inward DC not touched (user asked for Outward). Verified by shared+api+web
  typecheck and api+web lint.

## ADR-063: Resolve item code/name on detail reads that showed the snapshot/blank (item-dash fix)
**Date:** 2026-07-20
**Status:** Accepted

### Context
Task 3 of the 2026-07-20 batch. Six detail reads displayed the item code/name from the
denormalized `item_code_text`/`item_name_text` snapshot (or, for party_materials, blank —
its snapshot column is nullable) instead of resolving the live items master via the row's
item_id FK — the linked-display-audit gap for items. Item code is manual, so a document
holding an item_id must JOIN items on read to show the live code/name. The GRN and PR
detail reads already do this; these six did not: nc_register (header item), delivery_challans
(lines), invoices (lines), customer_dispatches (register + detail lines — `itemCode` was an
alias of the snapshot), jw_dc outward (lines; inward detail is served by the same outward
read), party_materials (header; could render blank).

### Decision
Mirror the GRN pattern in each: LEFT JOIN items on the row/line item_id (AND items deleted_at
IS NULL), expose nullable `itemCode`/`itemName`, keep the `*_text` snapshot as a fallback,
add the fields to the module's shared line/detail schema, and render
`itemCode ?? itemCodeText ?? '—'` (and name likewise) in the UI. Implemented per-module in
parallel; each kept its own read style (drizzle vs raw SQL).

### Consequences
- Positive: all six detail surfaces show the live item code/name; party_materials no longer
  goes blank. Read-side only — no schema/data change.
- Negative: one indexed-FK LEFT JOIN added per affected read.
- Notes: customer_dispatches — the API's `itemCode` was previously the snapshot alias, so the
  UI looked fine but showed stale data; now `itemCode` is JOIN-resolved with `itemCodeText`
  fallback (register search/summary/print/export updated so free-text lines don't regress to
  blank). jw_dc — inward has no standalone detail read; fixing the outward read covers the
  inward modal that consumes it; inward line schema fields added as optional (nothing populates
  them yet). Verified by shared+api+web typecheck and api+web lint.

## ADR-064: Auto-number preview for create forms that had no code field (Class B)
**Date:** 2026-07-20
**Status:** Accepted

### Context
Class B of Task 1 (ADR-060 was Class A). Nine create forms auto-generated their code
server-side but showed NO field for it, so the user never saw the number before saving:
customer-dispatches (DSP-), invoices (INV-), capa (CAPA-), design-projects (DP-),
design-tracker (DSN-), store-issues (ISS-), tool-issues (TIS-), tasks (TSK-), and jw-dc
(both modals: JWDC-OUT- and JWIN-).

### Decision
Same per-module `/next-code` endpoint pattern as Class A/party-materials (a `getNext*Code`
wrapper reusing the module's own generator + a `useNext*Code()` hook), but because these
create inputs have NO code field (the server always generates on save), the added field is
a READ-ONLY PREVIEW only — it displays `next?.code ?? '(auto on save)'` and is never added
to the submit payload. jw-dc got two endpoints/hooks (outward + inward).

### Consequences
- Positive: every listed create form now shows the next number up front; submit paths and
  server-side generation are unchanged (zero write-path risk).
- Negative: one small endpoint + hook per module (mechanical).
- Note: preview is informational — under a rare concurrent create the saved number could be
  the previewed one +1; acceptable since nothing is typed and the server stays authoritative.
  With this, Task 1 (make auto-generated numbers visible) is complete across all in-scope
  modules. Verified by api+web typecheck and api+web lint.

## ADR-065: Resolve the SO on the OSP Delivery Challan via the PO (the real "OSP Outward DC")
**Date:** 2026-07-21
**Status:** Accepted

### Context
User reported the "OSP Outward DC" detail header SO field still showed a dash after ADR-062.
Live-DB diagnosis (read-only) revealed the OSP outward is NOT the jw_dc_outward table
(0 rows in prod) — it is the **delivery_challans** module ("New DC → pick a JW PO → ship
qty"). Every OSP DC stores only purchase_order_id; its own SO fields (sales_order_line_id,
so_ref_text) are empty, and the reads resolved soCode only from sales_order_line_id → so.
Confirmed on all 12 live DCs: sales_order_line_id/so_ref_text null on every row, but the SO
is reachable via purchase_order_id → purchase_order_lines.source_so_line_id →
sales_order_lines → sales_orders (11/12 resolve; IN-DC-00007's PO line has no SO link, so a
dash there is correct).

### Decision
In delivery-challans list + detail reads, add a LATERAL that resolves the SO through the
PO's lines (string_agg DISTINCT) and change the projection to
`COALESCE(so.code, po_so.so_code) AS "soCode"` — direct sales_order_line_id first, PO-path
fallback second. UI unchanged (already renders `soCode ?? soRefText ?? '—'`). Verified the
exact new SQL against live data before shipping (11/12 now show the real SO).

### Consequences
- Positive: OSP Delivery Challans now show their SO in list + detail. Read-side only; no
  schema/data change.
- Negative: one more LATERAL per DC read (indexed FKs, bounded rows).
- Note: ADR-062's jw_dc_outward SO column is on an unused table (0 prod rows) — left as-is;
  it is harmless and correct should JW-DC ever be used. Verified by api typecheck + lint.
