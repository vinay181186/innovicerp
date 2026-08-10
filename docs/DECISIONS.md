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

## ADR-066: OSP At-Vendor / WIP reconciliation register (read-only, increment #1 of the OSP inventory fix)
**Date:** 2026-07-21
**Status:** Accepted

### Context
The SO-517 / CONNECTING ROD trace showed on-hand stock going negative (−30) and job-card
status wrong throughout, because outsource (OSP) send debited finished stock (`jw_out`) while
receive credited it (`grn_qc`) — netting to zero production, then dispatch drove it negative —
and because there was nowhere to see "how much is physically at the vendor / in process". The
agreed fix is four gated increments (Option A: make OSP send stock-neutral; a document-derived
at-vendor register; qty-driven JC/SO status; a backfill). This ADR is **increment #1** — the
safe, read-only foundation shipped first so the numbers can be eyeballed before any posting,
status view, or data is touched.

### Decision
Add a read-only view `v_osp_wip` (migration 0064) — one row per outsource `jc_op` reconciling
every ordered unit as `order_qty = accepted + at_vendor + not_sent`, all derived from existing
documents (JC op counters + outward-DC receipt lines; identical receipt rollup to
`v_jc_op_status` so they stay consistent). Surfaced through a new module `osp-wip`
(service → `GET /osp-wip` → `useOspWip` → **Store ▸ OSP At-Vendor Register** page) with KPI
tiles (Outsourced Ops · At-Vendor pcs · Not-Sent pcs · Total Sent) and a filterable table.
No writes, no schema change beyond the additive view. Validated against IN-JC-26-00020
(SO-517): order 60 = accepted 30 + at_vendor 0 + not_sent 30.

Also fixed a latent typecheck error in items/routes/list.tsx (`p.code` became optional after
ADR item-code auto-assign; import result lists now fall back to `p.code ?? p.name`).

### Consequences
- Positive: at-vendor / in-process qty is now visible and reconciles to ordered — without
  polluting the finished-stock ledger. Foundation for increments #2–#4.
- Negative: none functional; one more read-only view + page to maintain.
- Next: increment #2 (OSP send → stock-neutral, `delivery-challans/cascades.ts`), #3
  (qty-driven `v_jc_op_status`), #4 (one-time backfill of negatively-driven items). Verified
  by workspace typecheck + api/web lint before ship.

## ADR-067: OSP send is stock-neutral — stop debiting finished stock on JW outward DC (increment #2)
**Date:** 2026-07-21
**Status:** Accepted

### Context
Root cause of the SO-517 negative-stock bug: issuing an OSP outward Delivery Challan
(delivery_challans — "New DC → pick JW PO → ship qty") debited finished stock
(`store_transactions` txn_type='out', source_type='jw_out'), and receiving the processed
goods back credited it (grn_qc, +). With no BOM (one item code end-to-end), that send(−)/
receive(+) pair nets to **zero production**, so a later dispatch(−) drove on-hand negative
(−30). The material sent out is not "gone" and not "in finished store" — it is *at the vendor
in process*, which is now tracked document-derived via `v_osp_wip` (ADR-066), not the ledger.

### Decision
Remove the stock-ledger movement from the OSP DC lifecycle (Option A):
- `delivery-challans/service.ts`: drop the `writeStoreTxnOnDcIssue` call on create and the
  `reverseStoreTxnOnDcCancel` call on cancel (both removed together — reversing a debit that
  no longer happens would have *inflated* stock on cancel).
- `delivery-challans/cascades.ts`: delete `writeStoreTxnOnDcIssue` / `reverseStoreTxnOnDcCancel`
  / `DcStockTxnArgs` (now dead) and their `sql`/`storeTransactions` imports.
- The jc_op cascades (`applyOutwardToJcOp` / `reverseOutwardFromJcOp`) are UNCHANGED — sent-qty
  and outsource_status still update, so the register and status stay correct.
- Updated the unit test to assert **no** ledger row is written on OSP send.
Production is credited only on QC-accept of the return (existing qc_accept path); dispatch still
debits; the loop closes at 0 instead of −30.

### Alternatives Considered
- Option B (keep the debit, add a separate "at vendor" liability account and net it in the
  stock view) — rejected: more moving parts, still double-represents the same pieces, and the
  no-BOM shop has no use for a WIP sub-ledger. Option A is simpler and matches how the floor
  actually thinks ("it's at the vendor, it'll come back").

### Consequences
- Positive: OSP send no longer moves finished stock; combined with the register (ADR-066) the
  identity Ordered = In-store + At-vendor + On-PO + Dispatched holds. New DCs post nothing to
  the ledger.
- Negative: historical `jw_out` rows already posted remain until the one-time backfill
  (increment #4) recomputes `item_stock_balances`. Until #4 runs, previously-affected items
  keep their old (wrong) on-hand; go-forward is correct.
- Known dead path left as-is: `jw-dc/service.ts` still writes `jw_out`, but that module's table
  has 0 prod rows (unused; see ADR-062/065) — out of scope, noted so it isn't a surprise if
  JW-DC is ever activated. Verified by api typecheck + lint; integration test updated (cannot
  run locally — only prod DB is available and must never be used for tests).

## ADR-068: Qty-driven OSP op status + one-time backfill (increments #3 & #4)
**Date:** 2026-07-21
**Status:** Accepted

### Context
Two residual effects of the OSP bugs remained after ADR-066/067:
1. `v_jc_op_status` marked an outsource op `complete` on the flag
   `outsource_status = 'received'`. But `receipt-cascades.ts` sets 'received' when everything
   *sent* comes back (`cumulative >= sent_qty`), not when everything *ordered* is done — so
   SO-517 (sent 30 of 60, 30 back) was flagged received → op complete → `v_jc_status` complete
   → `tryCascadeJcComplete` set `job_cards.closed_at` and closed the SO line — with 30 pieces
   never sent. Live-verified: IN-JC-26-00020 op read `complete`, JC `closed`, SO line `closed`.
2. Historical `jw_out` debits (ADR-067) had already driven 10 items' on-hand down, several
   negative (CONNECTING ROD −30, LOCKING LEVER −32, LEVER −34, SUPPORT −100, …).

### Decision
**#3 — 0065 (qty-driven status, CREATE OR REPLACE `v_jc_op_status`):** replace the flag
short-circuit with a quantity test — an outsource op is `complete` only when accepted
(received − rejected) ≥ the op's required input qty (order_qty for op 1, else prev output);
add an outsource term to the `in_progress` rung so a partially-returned op reads `in_progress`,
not the bare `received` sub-state. Column set unchanged, so dependent `v_jc_status` is
untouched. Applied + validated: IN-JC-26-00020 op now `in_progress` (input 60, accepted 30).

**#4 — 0066 (idempotent, data-only backfill):**
- Stock: post one compensating `in` ledger row per item = net `jw_out` debit (source_type
  `manual_adjust`, marker source_ref `OSP-BACKFILL-ADR067`, guarded by NOT EXISTS so re-runs
  no-op). Uses the ledger — not a direct balance edit — so the trigger-maintained
  `item_stock_balances` and any future 0020-style reconcile stay consistent. Dry-run: all 10
  items land non-negative; every pure-OSP item (CONNECTING ROD, CONNECTING LEVER, LEVER,
  SUPPORT, COVER) returns to exactly 0.
- Closures: clear `closed_at` on JCs closed but not complete under the corrected view, and
  reopen the SO/JW line + header auto-closed off the back of it (each UPDATE self-limiting).
  Dry-run scope: exactly IN-JC-26-00020 + SO IN-SO-00517 line 23 (header already open).

### Alternatives Considered
- Recompute `item_stock_balances` directly, excluding `jw_out` rows — rejected: leaves the
  erroneous rows in the ledger, so a future reconcile (0020 backfill block) would re-introduce
  the debit and drift. Compensating ledger entries keep ledger = balance.

### Consequences
- Positive: OSP ops/JC/SO reflect real qty; SO-517 lands at 0 stock, JC 30-done/30-pending, SO
  line reopened. Model consistent end-to-end (register + neutral send + qty status + clean data).
- Negative / ops note: 0066 is a **prod data mutation** — it is applied via `apply-sql.ts` with
  explicit operator approval (the auto classifier blocks unattended prod data writes), separate
  from the code push. 0065 (view) is already applied. Both migration files are version-controlled.
- The compensating rows show in the Stock Ledger as `manual_adjust` with an ADR-067 remark
  (auditable, not silent).

## ADR-069: Default terminal DIR QC op so every produced JC credits finished stock ("Rule B")
**Date:** 2026-07-21
**Status:** Accepted

### Context
Finished-goods stock is credited by exactly one event per JC: `qc_accept` fires only on a QC
*last* op (op-entry/qc-stock-cascade.ts), and an outsource op credits via `grn_qc` when its work
is received. A JC whose routing is pure in-house **process** ops with **no QC** therefore never
credits stock — dispatching it drives on-hand negative. Found while backfilling the OSP fix:
SPACER / IN-JC-26-00007 (3 process ops, produced 60, dispatched 60 → −60), a different root cause
from the OSP `jw_out` bug (no `jw_out` row on it).

### Decision
Guarantee a terminal QC gate. When a JC's routing needs one, append a default **DIR** (Dimensional
Inspection Report — a standard shop QC stage) QC op as the final op, at every jc_ops creation path:
manual JW create/edit (`job-cards/service.ts`) and plan execution (`plans/service.ts`). Centralised
in `lib/jc-default-qc.ts` (`needsDefaultQcOp` + `DEFAULT_FINAL_QC_OP`).

**Trigger — deliberately narrower than "last op isn't QC".** Append DIR only when the last op is
`process` AND the JC has **no outsource op anywhere**. An outsource op already credits the same
pieces on receive (`grn_qc`); adding a terminal QC on top would DOUBLE-credit in the no-BOM
single-item model (this is why SO-517 must be left alone while SPACER needs the gate). A JC that
already ends in QC is gated; an empty routing has nothing to inspect. Encoded + unit-tested in
`jc-default-qc.test.ts`.

**Historical backfill — 0067 (idempotent, data-only):** for each already-complete JC matching the
same rule (pure in-house, no QC, no outsource, produced > 0), post one compensating `in` = the
produced output (last op `completed_qty`) — the credit a DIR acceptance would have made. Dry-run
scope: exactly SPACER (+60 → 0). Guarded by a per-JC marker source_ref; ledger-based to keep
`item_stock_balances` reconcile-consistent.

### Alternatives Considered
- "Credit stock on any final process 'complete'" (no QC op) — rejected: adds a second crediting
  code path and double-credits JCs that also have a QC/outsource step; the QC-op approach reuses
  the single tested `qc_accept` path.
- Trigger on "last op isn't QC" (my first framing of "Rule B") — rejected once tracing showed it
  double-credits any JC containing an outsource op.

### Consequences
- Positive: every produced JC now passes a QC gate that credits stock exactly once; SPACER-type
  negatives cannot recur. SPACER lands at 0 after 0067.
- Negative: one extra shop-floor action — a no-QC in-house job isn't "complete" until its DIR QC is
  accepted (accepted trade-off; it's the crediting event). Edits churn the DIR op (soft-delete +
  re-insert) when the payload omits it. Zero-op supplementary JCs (NC `make_fresh`) are untouched.
- Ops note: 0067 is a prod data write applied via `apply-sql.ts` with operator approval, separate
  from the code push. Verified by api typecheck + lint + the `needsDefaultQcOp` unit test (7/7).

## ADR-070: Outsource op numeric columns (completed_qty / available) reflect accepted qty
**Date:** 2026-07-23
**Status:** Accepted

### Context
0065 made an outsource op's *status* qty-driven but left `v_jc_op_status.completed_qty` and
`available` deriving from op_log 'complete' rows — which outsource ops never have. So the Job Card
op detail showed "Order 60 / Input 60 / Done 0 / Avail 60" for IN-JC-26-00020, contradicting the
OSP At-Vendor register (accepted 30, not-sent 30) and the op's own `in_progress` status. Found
during test Part-B (user: "order 60, input 60, avail 60").

### Decision
0068 (CREATE OR REPLACE `v_jc_op_status`): for OUTSOURCE ops only, both numeric columns use the
accepted qty (received − rejected) as "done" — the same figure the register and the prev_op_output
LAG already use:
`completed_qty = accepted` (was 0); `available = input − accepted` (was input). Non-outsource ops
and the status CASE are unchanged. A consumer sweep (Explore agent) confirmed it safe:
`so-costing` machine cost excludes `op_type IN ('outsource','qc')` (no money impact; outsource cost
is PO qty×rate); op-entry gates + the OSP send/PR/PO path short-circuit outsource before any numeric
gate (send qty is order_qty-driven); dispatch + the so_progress widget already special-case
outsource. Last-op "production credit" for an outsource-last JC now credits accepted (30) instead
of 0 — more correct.

### Consequences
- Positive: JC detail, jc-ops board, and every op-qty display now agree with the register for
  outsource ops (IN-JC-26-00020 → Done 30 / Avail 30).
- Negative: none functional. Ops note: 0068 is a view change applied via `apply-sql.ts` with
  operator approval, separate from the code push (the auto classifier now gates all prod applies).
## ADR-071: Canonical Job Card op-quantity columns — Order Qty / Completed Qty / Pending Qty
**Date:** 2026-07-23
**Status:** Accepted

### Context
The JC Status op table showed five overlapping quantity-ish columns (Order, In[put], Done, Avail,
Progress %). "Avail" was mislabelled (it meant remaining balance, not machine-availability) and
"Input" (qty handed from the previous op) read as jargon and looked redundant on single-op JCs
(Order 34 / Input 34). User: "we just need order qty, completed qty and pending qty; everything
else is confusing."

### Decision
Canonicalise every op-quantity display to three columns: **Order Qty · Completed Qty · Pending Qty**,
where Completed = the op's done qty (QC → accepted; process/outsource → completed_qty, which for
outsource is accepted-back per 0068) and **Pending = Order − Completed**. Applied to the JC Status
op table (`jc-status-content.tsx` — dropped In + Progress, colSpan 13→11, removed the now-unused
`barColor`), the JC-Ops board (`jc-ops/routes/list.tsx` — dropped In; kept the per-op remaining
value for Pending to avoid a QC-accepted data gap in that query; kept Pend Hrs), and the op-entry
compact table (`jc-ops-table.tsx`). Display-only — no API/view/gate changes.

### Consequences
- Positive: op tables read Order → Completed → Pending, consistent with the JC summary cards and the
  OSP At-Vendor register. IN-JC-26-00023 → 34 / 0 / 34; IN-JC-26-00020 → 60 / 30 / 30.
- Negative: none functional. Regression-checked: op-entry gates, the Create-PR modal default
  (`row.available`) and costing all read API fields, not the removed columns; typecheck + lint green.
- Follow-up option: the JC-Ops board's Pending for QC ops is input-based (no qcAccepted in that
  query) — add qc_accepted_qty there if full order-based canon is wanted on the board too.

## ADR-072: Show "At Vendor" qty on the Job Card op table
**Date:** 2026-07-23
**Status:** Accepted

### Context
After ADR-071 the outsource op showed Order/Completed/Pending only, so an outsource op's Pending
(34 for IN-JC-26-00023) hid that 10 were physically at the vendor in process and 24 not yet sent.
User wanted the at-vendor portion visible on the JC.

### Decision
Add `at_vendor_qty` (= outsource_sent_qty − received, floored at 0; 0 for non-outsource) to
`v_jc_op_status` (migration 0069) — mirrors v_osp_wip. Surface it through op-entry `listJcOps`
(`atVendorQty`) + the shared `jcOpEnrichedSchema`, and add an "At Vendor" column to the JC Status op
table (outsource ops show the number, others "—"). So an outsource row reads
Order 34 · Completed 0 · Pending 34 · At Vendor 10 (Pending = At-Vendor + Not-Sent).

### Consequences
- Positive: the in-process-at-vendor qty is visible per op on the JC. Verified: IN-JC-26-00023 → 10;
  process ops → 0.
- Note: 0069 appends the column at the END of the view — CREATE OR REPLACE VIEW rejects
  mid-list/reordered columns (first attempt failed with checkViewColumns). The view must be applied
  to prod BEFORE the API deploys (the API selects the new column). Verified by workspace typecheck +
  web/api lint.

## ADR-073: Outsource op qty is QC-accepted, not received — add "In QC" + "Incoming QC" (received ≠ accepted)
**Date:** 2026-07-23
**Status:** Accepted

### Context
An OSP return writes BOTH a physical DC receipt (delivery_challan_receipt_lines.received_qty) AND
an auto-created GRN with a separate incoming-QC step (goods_receipt_note_lines.qc_accepted_qty);
stock only credits (grn_qc) at QC-accept. ADR-065/068/069 derived the outsource op's
"accepted/done" from the DC receipt (received − rejected), i.e. physically returned — NOT
QC-accepted. So JC 23 (received 10, incoming QC pending) showed "Completed 10", and the
completion test keyed off received, so a fully-received-but-unQC'd op would auto-complete/close the
JC before QC ran (same family as SO-517's premature close).

### Decision
Source outsource quantities from the OSP-return GRN QC columns, joined via
goods_receipt_note_lines.purchase_order_line_id = jc_ops.outsource_po_line_id:
- **0070 (v_jc_op_status):** completed_qty = SUM(qc_accepted_qty); available = input − accepted;
  at_vendor_qty = sent − received; NEW **in_qc_qty** = received − accepted − rejected (appended
  last); completion requires accepted ≥ input; a returned-but-unQC'd op computes 'received'
  (relabelled **"Incoming QC"** in the UI), not complete/in_progress. prev_op_output for an
  outsource op now flows accepted (not received) to the next op.
- **0071 (v_osp_wip):** accepted_qty = qc_accepted; add in_qc_qty; register reconciles
  Ordered = Accepted + In-QC + At-Vendor + Not-Sent.
- Surfaced inQcQty through op-entry + osp-wip shared schemas/services; added an **In QC** column to
  the JC Status op table and the OSP At-Vendor Register; relabelled the 'received' computed_status
  badge to "Incoming QC" (jc-status-content, status-badge, job-queue, print-job-card). Raw
  outsource_status 'Received' labels left as-is (different field).

### Consequences
- Positive: Completed = truly QC-accepted; received-pending-QC is visible ("In QC") and can no
  longer be mistaken for done, nor auto-close a JC before QC. Verified: SO-517 (QC done) stays
  Completed 30 / In-QC 0; JC 23 (QC pending) → Completed 0 / In-QC 10 / "Incoming QC". Both views
  agree; register reconciles 34 = 0 + 10 + 0 + 24. No JC was found prematurely closed (no backfill
  needed). Views applied to prod before the code deploy (they select the new column).
- Negative: two more view recreates to maintain; the outsource rollup now joins GRN lines.

## ADR-074: Related Documents panel is compact/navigation-only everywhere except SO
**Date:** 2026-07-23
**Status:** Accepted

### Context
The shared RelatedDocsPanel rendered a heavy Upstream/Downstream/Related status-table + timeline on
every document detail page. User: the Related Documents section is for ease of navigation — show a
minimal doc-type-wise list of doc names (clickable), no status/date/timeline — everywhere EXCEPT the
Sales Order detail (which keeps the full traceability view).

### Decision
Add a `variant` prop to `components/shared/related-docs-panel.tsx` defaulting to `'compact'`: one
line per document type (section icon+title) with the doc codes as clickable links only — no
StatusBadge, no date column, no Document Timeline. The full view (SectionBlock tables + Timeline) is
retained behind `variant="full"`, passed only by `sales-orders/routes/detail.tsx`. All 14 other
detail pages (design-projects, jw-dc, bom-master, assembly, delivery-challans, invoices,
goods-receipt-notes, job-work-orders, job-cards status, plans, nc-register, purchase-requests,
purchase-orders, service-pos) call the panel with no variant → compact automatically. Atomic: two
files changed, every location resolved.

### Consequences
- Positive: clean minimal navigation list everywhere; SO keeps the rich traceability. No per-page
  edits, no API change. Verified by web typecheck + lint.
- Negative: none; the full renderer is dead only if SO ever drops variant="full".

## ADR-075: Consolidate redundant QC pages — drop QC Dashboard + QC History from nav
**Date:** 2026-07-23
**Status:** Accepted

### Context
A QC page audit found 12 QC pages, all nav-linked, with three redundancy groups reading the same
data: (A) QC History is a read-only subset of QC Call Register (same /qc-history endpoint; its
pending rows link into the Call Register, the only page with the accept/reject write form);
(B) QC Dashboard's three panels are each reproduced by a QC Command Center tab (Command is a strict
superset with FPY/Rework/assign); (C) Incoming QC's queue duplicates the Call Register (its Inspect
already links out).

### Decision
Phase 1 — remove QC Dashboard and QC History from the sidebar (Quality section). Routes stay
registered (no 404; bookmarks/deep-links keep working). Preserve capability: add a
"📊 History & Export" link on the QC Call Register header → /qc-history (keeps History's date
filters + Excel export one click away); QC Dashboard's content is fully covered by QC Command
Center, so the home-alerts QC deep-link (home-alerts.tsx DEPT_NAV) is repointed
/qc-dashboard → /qc-command. Incoming QC left as-is for now (unique pipeline metrics; action
already links to the Call Register). Sidebar reordered: entry/action pages first
(Call Register, Command Center, Incoming QC, TPI), then SO QC Status, QC Documents, NC, CAPA.

### Consequences
- Positive: two redundant top-level QC pages removed from nav with zero capability loss; no route
  deletion, so fully reversible and no broken deep-links. Web typecheck + lint green.
- Follow-up (not done): optionally demote Incoming QC to a metrics-only view, fold History's
  export directly into the Call Register, and eventually retire the two unlinked routes.

## ADR-076: QC Call Register — two tagged QC types, uniform display, mandatory "QC By"
**Date:** 2026-07-23
**Status:** Accepted

### Context
The QC Call Register mixes two QC types (incoming material QC + in-process JC-op QC) with
inconsistent presentation: only incoming rows were tagged, both showed a "days waiting" pill, MFG
rows showed a produced/order qty bifurcation, incoming led with GRN, and the inspector was optional
(process) or implicit-login (incoming).

### Decision
Make both QC types uniform and canonical:
- **Tags:** every row carries a type badge — "INCOMING" (existing) and new "IN-PROCESS" (cyan).
- **Drop:** the waiting-days pill (both), and the produced/order bifurcation on MFG rows
  (removed the now-dead waitColor/waitBg helpers).
- **Show:** Vendor + SO on both. Incoming leads with 🏭 vendor · SO, keeping GRN as a small muted
  reference. In-process shows 🏭 In-house · SO. Added `soCode` to the incoming pending payload,
  resolved via PO line → jc_op → JC → SO (null for raw-material GRNs).
- **Mandatory "QC By":** a required typed inspector field on both forms, prefilled with the logged-in
  user (session email), editable. Process → op_log.operator_name (now required); incoming → new
  `goods_receipt_note_lines.qc_inspected_by_text` (migration 0072; `qc_inspected_by` stays as the
  user FK for audit). New shared field `submitIncomingQcInput.qcInspectedByName` (min 1).

### Consequences
- Positive: consistent, minimal QC rows keyed on Vendor/SO/tag; QC attribution is captured on every
  entry. Verified SO resolution on GRN-00012 → SO IN-SO-00517. Workspace typecheck + web/api lint
  green; migration 0072 applied to prod before the code deploy (API writes the new column).
- Note: completed-log rows don't yet surface the QC-By name (entry-only for now). Raw-material GRNs
  show vendor + GRN with SO blank.

## ADR-077: Full-outsource plan execution seeds a Job Card with a default OSP op
**Date:** 2026-07-25
**Status:** Accepted

### Context
Executing a `full_outsource` plan previously created only a JW PR (status `pr_created`), so the
outsourced work never landed as a trackable Job Card op — the user had to build the JC/op manually,
and the OSP At-Vendor/QC chain (ADR-066..073) had no jc_op to trace back to.

### Decision
`executeFullOutsource` now, when the plan has a resolved `itemId` (job_cards.item_id is NOT NULL),
seeds a Job Card with **one outsource jc_op** as the default OSP route: `op_type='outsource'`,
`operation = plan.foProcess`, `outsourceVendorId/Text` + `outsourceCost` prefilled from the plan's
`fo*` fields (all editable on the JC). The auto-raised JW PR is linked to that op
(`prType='jw_osp'`, `source_jc_op_id`, and `jc_op.outsourcePrId` / `outsourceStatus='pr_raised'`) —
no duplicate PR — so the PO→DC→GRN→incoming-QC chain traces back to the op and OSP stock/QC stay
correct. Plan status becomes `jc_created` with `plan.jcId` set. **No QC op is added** — OSP returns
are QC'd via incoming QC (`grn_qc`), consistent with Rule B (`needsDefaultQcOp` skips outsource JCs,
ADR-069). A **text-only plan (no itemId)** keeps the prior PR-only path.

### Consequences
- Positive: a full-outsource plan lands as an editable JC op that flows through the OSP register /
  qty-driven status / QC pipeline built in ADR-066..073; the material-PR branch is unchanged.
- Negative: none for existing already-executed plans (unchanged). The full_outsource unit test was
  updated to the new contract (jc_created + jcId + jcCode); it can't run locally (prod-only DB), so
  verified by api typecheck + lint + diff review.

## ADR-078: Availability guard on OSP send (cannot outsource more than the previous stage cleared)
**Date:** 2026-07-25
**Status:** Accepted

### Context
The in-house progress paths enforce "you can't work quantity you don't have": `submitOpLog` and
`submitQcLog` reject `qty > available`. The OSP-send path had no equivalent check —
`applyOutwardToJcOp` (delivery-challan outward cascade) blindly did `outsource_sent_qty += qty`.
Audit of IN-SO-00537 / IN-JC-26-00034 found op S2 (outsource, op_seq 4) with `input_avail = 0`
(upstream MIR/MCR/S1 never cleared) yet `outsource_sent_qty = 10` — 10 pieces issued to a vendor
with zero upstream progress. Company-wide audit found this was the only offending record.

### Decision
`applyOutwardToJcOp` now caps the send at the op's **upstream cleared input minus what's already
sent**: `sendable = v_jc_op_status.input_avail − outsource_sent_qty`; `qty > sendable` throws a
`ValidationError` and the whole DC transaction rolls back (the cascade runs inside the DC-create tx).
`input_avail` is the previous op's cleared output (or the JC order qty for op_seq 1), so a
first-op / whole-op outsource still sends freely — only sending *ahead of* un-cleared upstream work
is blocked. Chosen the cascade (single choke point for `outsource_sent_qty`) over per-caller checks.

### Alternatives Considered
- Guard in the DC-create service before the cascade — rejected: duplicates logic and misses any
  future caller; the cascade is the one authoritative writer of `outsource_sent_qty`.
- Cap by the op's `available` (input − accepted) instead of `input − sent` — rejected: `available`
  reflects remaining-to-accept, not remaining-to-send; multi-batch sends need the sent-based cap.

### Consequences
- Positive: OSP send now obeys the same availability rule as in-house op/QC logging; the SO-537 class
  of error is impossible. Existing tests unaffected (their outsource ops are op_seq 1, input = order).
- Negative: none for valid flows. Integration test added (guard rejects send with 0 upstream); the
  write-test suite runs against the dev DB in CI (not run locally — DB safety), verified by api
  typecheck + lint + diff review.

## ADR-079: Job-Work cycle completion — issue party material, return goods, bill labour
**Date:** 2026-07-25
**Status:** Accepted

### Context
The customer-material job-work (JWSO) flow was half-built: Party GRN received client material
into a separate party-stock ledger (party_materials), and a JW-sourced Job Card machined it, but
three steps were missing — consuming (issuing) party material to the JC (`issued_qty` was never
mutated), returning processed goods to the customer, and billing labour (no JW branch in invoices).

### Decision
Three lean single-line documents + two reconciliation counters (migration 0074):
- **Party Material Issue** (`IN-PMI-#####`) — issues client material to a JC; debits
  `party_materials.stock_qty`, credits `issued_qty`. Guard: `qty <= stock_qty`. Never writes
  own-stock `store_transactions` (party material stays isolated).
- **JW Return Challan** (`IN-JWRC-#####`) — returns machined goods to the customer against a JW
  line. Guard: `qty <= produced − already_returned`, where produced = terminal QC-accepted qty over
  the line's Job Cards (read from `v_jc_op_status`, mirroring customer-dispatch readiness). Bumps
  `job_work_order_lines.returned_qty`; flips the JWSO to `dispatched` when every line is fully returned.
- **JW Invoice** (`IN-JWINV-#####`) — bills labour only: `qty x rate (+ GST% from JWSO header)`, no
  material value. Guard: `qty <= returned − already_invoiced`. Bumps `invoiced_qty`.

Every guard follows the upstream/downstream availability rule (ADR-078 lineage): you can't issue more
than received, return more than produced, or bill more than returned.

### Consequences
- Positive: the JWSO loop now reconciles received → issued → produced → returned → invoiced, with
  party stock tracked separately from own inventory. Additive migration (new tables + default-0
  columns), no existing behaviour changed.
- Negative: no web create screens yet (API + list views only); flagged for a follow-up.

## ADR-082: Reject decision belongs at Incoming QC, not at any receive step
**Date:** 2026-07-27
**Status:** Accepted (partially implemented — see Status of implementation)

### Context
Vendor-return rejects were captured at the OSP Delivery Challan RECEIVE gate,
which (a) raised a defect (NC) only for whole `op_type='outsource'` ops — so an
ADR-081 dual-lane PROCESS op that carried an OSP balance had its reject silently
dropped (no NC), and (b) meant rejects lived in two inconsistent places. Incoming
QC — the natural, GRN-line-driven, dual-lane-aware inspection surface — did
NOT raise an NC on reject at all, unlike production QC (`op-entry` submitQcLog,
which calls `autoCreateNcFromQcReject`).

### Decision
Reject is decided ONLY at Incoming QC. At any receive step the user enters
**received qty only**; everything received lands on a GRN as `qc_status='pending'`.
Incoming QC decides **Accept / Reject**, and a Reject raises a defect record (NC),
mirroring production QC. Terminology: the good qty is **"Accept"**, never "OK".

### Alternatives Considered
- Broaden the two `op_type='outsource'` filters on the DC-receive path (fix the
  dual-lane NC only) — rejected as the whole answer: leaves the two-surface
  inconsistency and the Incoming-QC no-NC gap.
- Keep reject at both receive and QC — rejected: double capture, double NC risk.

### Consequences
- Positive: one reject surface; dual-lane split-job reject bug eliminated by
  construction (no gate reject to miss); received qty always flows through
  Incoming QC before crediting stock.
- Negative: raw-material (non-job-work) rejects still raise no NC until the
  Phase-2 schema change (nc_register.job_card_id is NOT NULL today) — tracked in
  docs/PENDING-qc-reject-refactor.md.
- Risks: a second QC write surface (GRN-detail update) may need the same NC
  treatment; flagged for verification.

### Status of implementation
- DONE: Incoming QC raises NC on reject for job-work returns; OSP DC receive is
  received-only (gate-reject field + dead gate-NC code removed). Typecheck + lint
  clean; integration tests updated but not executed (no test DB in env).
- PENDING: manual/PO GRN create → pending-only; legacy JW-DC inward; raw-material
  NC (schema change); disposition whitelist. See docs/PENDING-qc-reject-refactor.md.

## ADR-083: Job-Card operation-edit guards (lock started / OSP-committed / finished)
**Date:** 2026-07-28
**Status:** Accepted

### Context
`updateJobCard` let you reorder/add/remove/retype ops on an existing JC. The only
guard was "op has an op_log" (blocks remove + retype). Three gaps let an operator
silently corrupt the routing math (each op's input = the previous op's output):
(A) a started op could still be **re-sequenced**; (B) an outsource op already
committed to a PR/PO/DC (but with no op_log) could be removed/retyped/moved,
orphaning that paperwork; (C) a **complete/closed** JC could still be edited.

### Decision
Three server guards in `updateJobCard` (apps/api/src/modules/job-cards/service.ts),
plus UI: grey the ▲/▼ move buttons for started ops in both edit surfaces.
- **Reorder lock:** a started op's new op_seq must equal its old op_seq (append
  downstream is still allowed). Error: "Cannot re-sequence an operation that
  already has logged work."
- **OSP-committed lock:** an op with `outsource_status`/`outsource_pr_id`/
  `outsource_po_line_id` set is locked from remove/retype/reorder like a started
  op. Error directs the user to cancel the PR/PO first.
- **Freeze:** when the JC is complete/closed (`closed_at` set or `v_jc_status`
  computed_status in complete/closed), any structural op change is rejected.
- **Machine lock:** a started op's machine can't be changed via the edit form —
  the op board (`changeJcOpMachine`) already forbids it (waiting/available only),
  but `updateJobCard` did not, letting the recorded machine drift from where the
  logged production was actually done. Error: "Cannot change the machine of an
  operation that already has logged work."

### Alternatives Considered
- Cascade-cancel the PR/PO when an OSP op is removed — rejected: implicit
  document cancellation is surprising; require the explicit existing cancel flow.
- Block ALL edits on a complete JC (incl. header) — rejected: only structural op
  changes are frozen; header edits still allowed.

### Consequences
- Positive: routing math can no longer be silently scrambled on a live JC; no
  orphaned OSP paperwork; finished JCs are immutable (mirrors PO/JWSO pattern).
- Negative: to remove a committed OSP op you must first cancel its DC/PO/PR.
- Note: the UI only greys move buttons for *started* ops (edit model lacks the
  OSP-committed flag); the server enforces the OSP-committed + freeze cases with
  clear messages. Threading a committed flag into the edit model is a follow-up.

## ADR-084: Block outsource-balance while an in-house machine session is running
**Date:** 2026-07-28
**Status:** Accepted

### Context
The ADR-081 "Outsource balance" action guards only on `v_jc_op_status.available`
(= order − completed − already-outsourced). An **open in-house running session**
carries no committed qty, so it does NOT reduce `available`. Result: an op that a
machine has just started (0 completed) shows `available = full qty`, and a user
can outsource 100% of it — double-booking the same pieces to the machine AND a
vendor. After that, `available` is 0, so the still-running operator can't even log
output — the machine is tied up on a fully-outsourced job.

### Decision
`outsourceOpBalance` (jc-ops/outsource-balance.ts) now rejects when the op has an
active in-house running session (`running_ops.status='running' AND is_osp=false`):
> "Stop the running machine session before outsourcing this operation — finish or
>  stop the in-house run, then outsource the remaining balance."
Correct workflow: stop the session (records what was actually completed) → the
true remaining balance is now outsourceable.

### Alternatives Considered
- Subtract the "in-session" qty from `available` — rejected: a running session has
  no committed quantity to subtract.
- Require completed > 0 before outsourcing — rejected: doesn't close it (complete
  1, keep a live session on the rest, outsource the rest).

### Consequences
- Positive: can't outsource pieces a machine is actively producing; no double-book.
- Negative: one extra step (stop the session first) when a machine is mid-run.
- Note: server-enforced. UI still shows the "🏭 Outsource balance" button during a
  running session (the edit model doesn't carry a running flag) — the server
  rejects with the message above. Disabling the button while running is a follow-up.

## ADR-085: JC edit → OSP op auto-raises the JW_OSP PR (matches plan-execute)
**Date:** 2026-07-30
**Status:** Accepted (partially supersedes the manual-OSP-PR stance for the edit path)

### Context
Executing a Plan (`executeManufacture` / `executeFullOutsource`, plans/service.ts)
auto-raises one `jw_osp` IN-JWPR per outsource op and stamps the op `pr_raised`.
But `updateJobCard` (job-cards/service.ts) had **no PR logic**: editing a JC and
flipping an op from in-house → OSP only wrote `op_type='outsource'` with
`outsource_status=NULL`, which the UI renders as "awaiting PR" — yet no PR ever
appeared. Users reasonably expected edit to behave like create ("same function"),
but they were two separate functions and only plan-execute carried the PR loop.
An earlier stance made OSP-PR a manual, manager-triggered action (`POST
/op-entry/osp-pr`) to avoid accidental PRs; the user explicitly chose to have the
edit path auto-raise instead, for parity with plan-execute.

### Decision
`updateJobCard` now, after the op-upsert, re-queries ops that are `op_type=
'outsource'` with `outsource_pr_id IS NULL AND outsource_status IS NULL` and
raises one `jw_osp` PR each — same insert as `executeManufacture` (vendor id/text
with `(vendor TBD)` fallback, item + `order_qty`, `source_jc_op_id` +
`source_so_line_id`), then stamps the op `outsource_pr_id` + `pr_raised`. The
NULL-pr/NULL-status filter is the duplicate guard (a committed op is never
re-raised; the ADR-083 lock guard already blocks retyping a committed op). Raised
PR codes are appended to the JC EDIT activity-log line.

### Alternatives Considered
- One-click "Raise PR" button on the edit UI (keeps PRs explicit) — rejected by
  the user in favour of automatic parity with plan-execute.
- Reuse `generateOspPrForOp` (op-entry/osp-cascade) — rejected: it requires the op
  name to match a configured OSP process and would throw for arbitrary ops;
  plan-execute does not require that, so mirroring plan-execute's raw insert keeps
  create and edit behaviour identical.

### Consequences
- Positive: edit-to-OSP now produces the PR exactly like creating via a Plan;
  "awaiting PR with no PR" is gone; back-fills any pre-existing OSP op that had no PR.
- Negative: a mis-ticked OSP checkbox that is then saved will spawn a real PR
  (writes are admin/manager-only via `requireWriteRole` + RLS, so scope is limited).
- PR qty = the JC `order_qty` (full-op outsource); partial/remaining outsourcing
  still goes through the ADR-081 "Outsource balance" lane, unchanged.

## ADR-086: PO type is derived from the source PR, not the convert form
**Date:** 2026-07-30
**Status:** Accepted

### Context
`poType` distinguishes a plain buy (`standard`, received via GRN) from outward
job-work / OSP (`job_work`, shipped out on a DC). The PR→PO convert paths
(`createPurchaseOrderFromPr` service.ts, and the bulk batch) copied the form's
`poType` verbatim, defaulting to `job_work` (from-pr.tsx + purchase-order schema
defaults). A `direct_purchase` plan's PR is a plain buy (`pr_type='standard'`, no
`source_jc_op_id`), so converting it produced a `job_work` PO — which wrongly
exposed the outward "Create DC" action (jw-dc guards only on `poType='job_work'`)
AND hid the Receive/GRN button (gated `!== 'job_work'`). Live case: IN-PO-00004 ←
PLN-0006 / IN-JWPR-00010. The discriminator (`pr_type`, `source_jc_op_id`) was
already on the loaded PR and simply ignored. Separately, the PO_TYPES enum carried
two junk values: `outsource` (never set by any code, no gate reads it — behaves
like `standard`) and `service` (real Service POs use the separate `service_pos`
table, so picking it mis-files an orphan into `purchase_orders`).

### Decision
Both convert paths now derive `poType` from the PR, ignoring the form value:
`pr_type='jw_osp' OR source_jc_op_id IS NOT NULL → 'job_work', else 'standard'`
(bulk: `job_work` only if EVERY PR in the batch is OSP). The manual PO create form
and the from-pr convert form dropdowns are filtered to only `standard` + `job_work`
(hiding `outsource`/`service`) to prevent mis-filing.

### Alternatives Considered
- Guard the DC action on OSP linkage (PO line `source_jc_op_id`) instead of type —
  kept as a possible defense-in-depth follow-up, but fixing the type at the source
  is the root cause and also restores the correct Receive button for buys.
- Remove `outsource`/`service` from PO_TYPES entirely — rejected for now: existing
  rows carry those values, so the enum stays; only the dropdowns are filtered.

### Consequences
- Positive: a direct-purchase buy now converts to a `standard` PO — no bogus DC,
  Receive/GRN restored; OSP PRs still correctly become `job_work` (unchanged).
- Data: pre-existing mislabeled POs (e.g. IN-PO-00004) need a one-off backfill to
  `standard` where the linked PR is `standard`/no-jc-op and no DC was issued.
- The two junk dropdown options are hidden; the dead `service` PO orphan path is
  closed at the UI (the Service PO module remains the canonical service path).

## ADR-087: Service PO state machine — dedicated complete/cancel + no status-via-edit
**Date:** 2026-07-30
**Status:** Accepted

### Context
`service_pos.status` is `draft|pending|approved|completed|cancelled`, but the app
only ever reached `approved` (via the admin-only `approveServicePo`). `completed`
and `cancelled` were dead labels — no action produced them. Worse, `updateServicePo`
applied `input.status` verbatim under `requireWriteRole`, so a **manager** could
PATCH a draft straight to `approved`, bypassing the admin approval + `approved_by/at`
stamp (`updateServicePoInputSchema` was `create.partial().omit(spoNo)`, which still
carried `status`).

### Decision
- Omit `status` from `updateServicePoInputSchema` (now `.omit({ spoNo, status })`),
  and drop the `updates.status` line in `updateServicePo`. State changes go ONLY
  through dedicated actions with role + transition guards.
- Add `completeServicePo` (requireWriteRole; `approved → completed`) and
  `cancelServicePo` (requireWriteRole; `draft|pending|approved → cancelled`, blocks
  completed/cancelled), with `POST /service-pos/:id/complete` and `/cancel` routes.
- Web: `useCompleteServicePo` / `useCancelServicePo` hooks + "Mark Completed" and
  "Cancel PO" (with confirm) buttons on the SPO detail, gated on manager/admin.

### Consequences
- Positive: full lifecycle create → approve → complete / cancel; the approval
  back-door is closed (approve stays admin-only via the dedicated action).
- Still open (separate follow-ups, not lifecycle): no SPO edit screen (the PATCH +
  `useUpdateServicePo` hook exist but no route); Service PO spend still excluded
  from vendor/procurement reports; ₹0 SPOs allowed; free-text `spo_no` (no series);
  `service_po_lines` has no `deleted_at` (hard-deleted on line replace).

## ADR-088: Service PO simplified to Open → Completed (no submit/approval step)
**Date:** 2026-07-30
**Status:** Accepted (supersedes the approval flow of ADR-087)

### Context
Per user direction, the Service PO approval workflow (draft → submit → admin
approve) was unnecessary friction for a simple non-inventory expense doc. Desired
model: **Save → "Open" → Mark Completed** (with Cancel), no approval.

### Decision
Reuse the existing `service_po_status` enum — **no DB migration** (migrations are
not auto-applied on deploy: the Railway Dockerfile just runs the server; `db:migrate`
is manual, and prod writes are classifier-gated). The single active state is stored
as `pending` and surfaced everywhere in the Service PO UI as **"Open"**; the legacy
`draft`/`approved` values also render as "Open" (so existing rows read sensibly).
- Create: one **"Save Service PO"** button; the server forces `status='pending'`
  and ignores any client status (closes the create-side back-door too).
- `completeServicePo`: now completes from any non-terminal state (was approved-only).
- Approval removed from the UI (the `approveServicePo` service/route/hook remain but
  are unused/dead — left in place, harmless, removable later).
- List: "Open"/"Completed" stat cards; status filter = All / Open (=pending) /
  Completed / Cancelled. Status label + colour maps show draft/pending/approved → Open.

### Consequences
- Positive: exactly the requested UX, deployed with zero DB/schema change and no
  manual migration step.
- Trade-off: internal DB value `pending` ≠ its UI label "Open" — documented here to
  avoid future confusion. A later migration could add a real `open` enum value and
  retire the dead approve path if desired.
- The ADR-087 back-door fix still holds: status never moves via a raw edit.

## ADR-088: JC Operations Detail — table → card layout (design-only)
**Date:** 2026-07-30
**Status:** Accepted

### Context
The Job Card Operations Detail read as a 13–15 column table on all three surfaces
(create `job-card-form.tsx`, view + edit `jc-status-content.tsx`). The user supplied
a card mock-up and asked for it on all three, explicitly scoped as **design-only**:
no logic, calculation, API or save-payload change.

Three near-duplicate op editors also meant three copies of the same markup, two
copies of the `OP_STATUS` map, and two files well past the 400-line rule
(`jc-status-content.tsx` 1709 L, `job-card-form.tsx` 1127 L).

### Decision
Extract the row into two shared components and re-lay-out the columns as card
slots, copying every value, badge, button, condition and destination verbatim:
- `lib/jc-op-labels.ts` — `OP_STATUS`, `OUTSOURCE_STATUS_LABEL` (moved, byte-identical)
  + `opAccentColor(cls)`, which derives the card's left bar from the SAME class the
  status badge uses, so bar and badge cannot disagree.
- `components/jc-op-card.tsx` — read-only card (view). The table's Action cell
  becomes a footer strip; ▶ Start / ✚ Log / 🔬 QC(n) / ✓ Done / PR:/PO: keep their
  exact conditions and destinations.
- `components/jc-op-edit-card.tsx` — editable card (edit + create), exporting
  `JcOpEditValues` (the old local `EditOp` / `FormOp` shape).
- `components/jc-op-card-parts.tsx` — `QtyTile` / `SetupChip` / `SetupField` / `secLabel`,
  shared so view and edit cannot drift visually.

Per-screen wording is preserved via props rather than normalised: `cycleLabel`
(create keeps its accurate "Cycle (min)"; view/edit keep legacy's "Cycle(h)"),
`toolDetailsPlaceholder`, and an optional `logs` (omitted on create, whose table
had no logs column).

### Alternatives Considered
- One card component with a `mode` prop — rejected: the read-only and editable
  bodies share almost no markup, and the branchy result would be harder to review
  than two focused files.
- Normalising "Cycle(h)" → "Cycle (min)" everywhere — correct (the column is
  `jc_ops.cycle_time_min`) but out of scope for a design-only change; logged as a
  follow-up instead.

### Consequences
- Positive: one card definition per mode; `jc-status-content.tsx` 1709 → ~1065 L and
  `job-card-form.tsx` 1127 → ~849 L; the duplicate `OP_STATUS` copy in
  `job-card-form.tsx` is gone.
- Change beyond pure layout (deliberate, flagged to the user): the create form's
  machine `<datalist>` is now the shared `SearchableSelect` the edit screen already
  used (T32a — the datalist collapsed on a pre-filled value).
- Deferred, NOT fixed here (all pre-existing, all reported to the user): op numbering
  is stale after a re-sequence in edit (`en.opSeq`, so a moved op reads 3,2,1);
  `pendingQty` is `orderQty − done` and ignores `inputAvail`; the per-op log strip is
  capped at 3 out of a JC-wide 300-row fetch; `{opCount} op{ops.length !== 1 …}`
  renders "1 ops"; `toolNo` is written but has no input on any screen.

## ADR-089: JC op cards — unit label, log caption and plural corrected (labels only)
**Date:** 2026-08-03
**Status:** Accepted

> Numbering note: the previous entry ("JC Operations Detail — table → card layout")
> was written as a second **ADR-088**, colliding with the Service PO entry authored
> in a concurrent session. Both are kept verbatim (this log is append-only); read the
> JC one as **ADR-088b**. This entry takes 089 so the sequence continues cleanly.

### Context
Three cosmetic defects survived ADR-088b because that port was scoped to layout only
and reproduced the old table's wording byte-for-byte, including its mistakes:

1. `jc_ops.cycle_time_min` is **minutes**, but the view and edit cards inherited the
   legacy table header `Cycle(h)`. The create form and the Excel export already said
   `Cycle (min)` — so the same column was labelled two different units in one module.
2. The per-op log strip caption read `latest 3 logs` regardless of how many entries
   were actually rendered, so an op with one log claimed three.
3. The ops counter pluralised off the **total** row count while printing the
   **non-QC** count, so `1 process op + 1 QC op` rendered "1 ops".

### Decision
Fix the labels, touch no logic. The rendered numbers, the queries, the save payload
and every button condition are unchanged.

- `Cycle(h)` → `Cycle (min)` on the view card, the edit-card default prop, and the
  print template — all four surfaces (create / view / edit / print) now agree with the
  Excel export and with the column's actual unit.
- Log caption derives from the array it renders: `latest ${logs.length} log entr(y|ies)`.
- Plural follows the number actually shown: `{opCount} op{opCount !== 1 ? 's' : ''}`.

### Alternatives Considered
- Convert `cycle_time_min` to hours for display — rejected: a data-presentation change
  in a labels-only pass, and shop-floor cycle times are quoted in minutes.
- Rename the DB column to remove the ambiguity — rejected: a migration for a typo in
  one header, with every reader and the API contract to follow.

### Consequences
- Positive: one unit for one column across the whole module; captions can no longer
  contradict what is on screen.
- Neutral: `job-card-form.tsx` drops its now-redundant `cycleLabel` override — the
  shared default already carries the correct text.
- Still deferred (unchanged from ADR-088b): `pendingQty = orderQty − done` ignores
  `inputAvail` (awaiting the user's call); `toolNo` has no input on any screen; the
  log strip is still capped at 3. **Edit-screen op numbering after a re-sequence is
  explicitly to be left as-is** — the user reviewed it and chose to keep the current
  behaviour; the save order is correct, only the printed label lags.

## ADR-090: Op-card PENDING counts what reached the op; Tool No. gets an input
**Date:** 2026-08-03
**Status:** Accepted

### Context
Two defects deferred by ADR-088b/089, both confirmed against the live DB before
any code changed.

**1. PENDING advertised work that did not exist.** The tile was
`jc.orderQty − done`, inherited from the legacy table. It never consulted how much
the upstream op had released, so a blocked op claimed the whole batch. Real rows,
`IN-JC-26-00003`, order 50:

```
seq  operation    upstream_cleared  done  status         PENDING now   PENDING fixed
1    machining    50                50    complete       0             0
2    machinning   50                50    complete       0             0
3    machining    50                0     ready_for_pr   50            50
4    DIR          0                 0     waiting        50            0   <-- differs
```

Op 4 has received nothing — zero parts are at that operation — yet the card told
the operator 50 were pending.

**2. `tool_no` could not be filled.** The column was save-wired
(`build-jc-write-input.ts`, and both the create and update branches of
`job-cards/service.ts`), rendered on the view card, and carried by the print
template and the Excel export — but no screen had an input bound to it. Create
initialised it to `''`; edit round-tripped the DB value untouched. Live DB: **14
`jc_ops` rows, 0 with `tool_no`, 0 with `program`.** The chip and both export
columns were structurally always blank.

### Decision
1. `pendingQty = max(0, inputAvail − done)` on both the view card and the edit
   card. `input_avail` (from `v_jc_op_status`) is the qty upstream has cleared.
2. Add a `Tool No.` input to the edit card's SETUP row, next to Program,
   `maxLength={120}` to match `z.string().max(120)` in the shared schema.

### Alternatives Considered
- Keep `order − done` and add a second "READY" tile — rejected: two qty tiles
  answering nearly the same question, and PENDING would still be the misleading
  one an operator reads first.
- Keep `order − done` — rejected: the number is wrong for its position on a
  per-op card. Order-level remaining is already legible from the ORDER tile.
- Leave `tool_no` write-only, or drop the column and its display/export sites —
  rejected: the user confirmed tool numbers are wanted; adding the input is
  smaller than removing four call sites.

### Consequences
- Positive: PENDING now means "what I can work on", matching what `available`
  and `computed_status` already say; a `waiting` op reads 0 instead of the full
  order. Tool No. becomes capturable, so the view chip, print column and Excel
  column can hold real data.
- Safe by inspection of live data: op 1 always has `input_avail = order_qty`
  (verified across all 14 rows), and **every `jc_op` has a status-view row**
  (0 missing), so `inputAvail` is never an absent-row 0. Only downstream-blocked
  ops change; every op in the sample except `IN-JC-26-00003` seq 4 is unaffected.
- This is a **display** change only — no query, no write path, no save payload,
  and no button condition was touched. `available`, `computedStatus` and the
  action ladder are untouched.
- Negative: any user who read PENDING as "order-level remaining for this op"
  loses that reading; the ORDER and COMPLETED tiles still give it.

## ADR-091: Full-Outsource Material Source — buy only on "Purchase New"
**Date:** 2026-08-03
**Status:** Accepted

### Context
A full_outsource plan has a Material Source of "From Stock" (raw material already
in our store → use it, buy nothing) or "Purchase New" (we don't have it → raise a
material PR). The plan-execute code (`plans/service.ts`) raised a material PR
whenever `foMaterialSrc` was anything except the words `self`/`inhouse`/`in-house`.
The dropdown only ever emits "From Stock" | "Purchase New" — neither word is in
that exclude-list, so BOTH options raised a PR. The option that means *don't buy*
("From Stock") wrongly triggered a purchase. Second defect: the PR's
`vendorCodeText` was set to the source label itself (`plan.foMaterialSrc`), a
leftover from when this column was free-text vendor name (ISSUE-253). Compounding
it, `plan-form.tsx` (new/edit routes) rendered Material Source as a FREE-TEXT box
("'inhouse' or supplier code") while `edit-plan-modal.tsx` used the 2-option
dropdown — the two entry points disagreed on what values the column holds.

### Decision
- Raise a material PR **only** when `foMaterialSrc?.trim().toLowerCase() === 'purchase new'`.
  "From Stock" (and any legacy/empty value) raises nothing. Matches legacy intent.
- Stop writing the source label into the vendor field; raise the material PR with
  `vendorCodeText: '(vendor TBD)'` (vendor unknown at plan time — mirrors the OSP flow).
- Unify the entry forms: `plan-form.tsx` Material Source is now the same 2-option
  dropdown (From Stock / Purchase New) as the modal, coercing any legacy value to
  the safe "From Stock". Closes the ISSUE-253 free-text/select mismatch.
- Backend-only + a UI field swap. **No DB migration.** Tests updated to use the
  real dropdown values (Purchase New = buys, From Stock = does not).

### Consequences
- Positive: "From Stock" no longer double-buys material already in store; material
  PRs no longer carry a bogus "From Stock"/"Purchase New" vendor name.
- Negative: a legacy full_outsource plan that stored a supplier code in
  `foMaterialSrc` (meaning "buy") now reads as "From Stock" and would NOT raise a
  PR if re-executed. Plans execute once, so already-executed plans are unaffected;
  risk is limited to un-executed legacy rows with a free-text supplier value.
- Does NOT touch stock: "From Stock" still consumes nothing from the store ledger
  (no reservation/deduction). Stock double-commit remains a separate, deferred
  feature — see the audit notes on reservation risks.

## ADR-092: Mid-route OSP returns credit WIP, not store — store is credited once at JC close
**Date:** 2026-08-03
**Status:** Accepted

### Context
Innovic runs **no BOM**: the raw bar and the finished part carry the same item code
end-to-end (e.g. 554117146000 LEVER CATCH RAMMER on the SO line, plan, PR, PO, DC,
GRN). A job-work return is therefore byte-identical to a purchase receipt at the
GRN, and `creditGrnQcStock` (goods-receipt-notes/cascades.ts) credited stock for
**any** GRN line with a resolved item — no check on where the outsource op sits in
the routing.

The business rule (confirmed with the user, 2026-08-03):
1. No BOM → track material in/out on the actual item code.
2. Full outsource starts with zero stock; nothing is issued from store, so the
   outward DC must not debit (already true — ADR-067).
3. A **mid-route** OSP return feeds the **next operation's input qty**, not store.
4. Store stock is credited **once**, at JC close, via final QC — internal QC when
   the last op is in-house, incoming QC when the last op is the vendor return.

Rule 4 was already satisfied for the common case: 9 of the 10 outsource ops in prod
are `op_seq 1 of 1` on `full_outsource` JCs, so the OSP op *is* the last op and the
grn_qc credit is correct. Audit confirmed IN-GRN-00016 (+10, PLN-0009) and
IN-GRN-00002/00004 (+45/+4, PLN-0003) are all legitimate last-op credits — an earlier
reading of these as "phantom stock" was wrong and is retracted.

Rule 3 was violated. The one mid-route op in prod is IN-JC-26-00003 (PLUNGER, 50):
op1 machining (process) → op2 machinning (process) → **op3 machining (outsource)** →
op4 DIR (qc). When op3's parts return, the GRN would credit store +50 even though the
parts still owe op4; op4's internal QC then credits +50 again via
op-entry/qc-stock-cascade → **+100 booked for 50 physical pieces**. Latent only
because op3 has `outsource_status = NULL` (never sent).

### Decision
Guard inside `creditGrnQcStock` — the single choke point for grn_qc credits (the
three `writeStoreTxnOnQcAccept` call sites in goods-receipt-notes/service.ts delegate
to it, and incoming-qc/service.ts:322 calls it directly, so one guard covers all four
paths). Skip the ledger write when the GRN line is the return of an outsource op whose
`op_seq < MAX(op_seq)` for its Job Card.

The GRN line resolves to its jc_op by two paths, because
`jc_ops.outsource_po_line_id` is only stamped once the outward DC is issued (populated
on 2 of 10 prod ops):
1. `jc_ops.outsource_po_line_id = grn_line.purchase_order_line_id`
2. GRN → PO → `purchase_orders.pr_id` → `purchase_requests.source_jc_op_id`
An ordinary purchase GRN resolves to no op and is never blocked.

Mirrors the `MAX(op_seq)` last-op test that op-entry/qc-stock-cascade.ts already
applies before crediting on internal QC — same rule, now enforced on both paths.

### Alternatives Considered
- Blanket "never credit on `po_type='job_work'` GRNs" — rejected: correct for the
  mid-route case but breaks the 9 last-op full_outsource JCs, which would then never
  credit finished goods at all (a full_outsource JC has no final QC op to fall back on
  — executeFullOutsource seeds exactly one outsource op).
- Restore a `jw_out` debit on OSP send and keep both legs — rejected: this is what
  ADR-067 removed after SO-517 drove on-hand to −30. Reintroduces negative-stock
  exposure on mid-route ops, where nothing was ever in store to debit.

### Consequences
- Positive: the double-credit is closed before it ever fires; last-op behaviour is
  untouched, so no existing ledger row changes meaning and no data repair is needed.
- Positive: the "credit once, at JC close" rule is now enforced identically whether
  the last op is in-house (qc_accept) or outsourced (grn_qc).
- Negative: adds one SQL round-trip per credited GRN line. Bounded (per line, per QC
  accept) and indexed on PK/FK columns.
- Open: `plans.fo_material_src = 'From Stock'` on a full-outsource plan raises no
  material PR and issues nothing from store. Given rule 2 (full outsource starts with
  zero stock), the label's intended meaning is unresolved — see TASKS.md.

## ADR-093: Store/Inventory gains an "At Vendor" column
**Date:** 2026-08-03
**Status:** Accepted

### Context
ADR-067 made OSP send stock-neutral and put "material at the vendor" in
`v_osp_wip`, not the ledger. That is correct accounting, but the Store screen
(`store-inventory/service.ts`) only ever selected in_stock / min_qty / on_po_qty /
mfg_pending_qty — three of the four terms in ADR-067's own identity
(Ordered = In-store + At-vendor + On-PO + Dispatched).

With no BOM the pieces at the vendor carry the same item code as the pieces on the
shelf, so the omission is invisible: LEVER CATCH RAMMER read `in stock 5 · on PO 15`
while 5 more sat at VND-004 on IN-DC-00004. That row is what prompted the
"why does stock still show 5?" investigation — the number was right, the screen just
could not say where the material was.

Compounding it, `on_po_qty` blends two different meanings: genuinely inbound
purchases (IN-PO-00004, 10 pcs from VND-005) and the shop's own pieces returning on
a job-work PO (IN-PO-00008, 5 pcs). Left as-is for now; the At-Vendor column gives
the missing signal without changing an existing number's definition.

### Decision
Add `atVendorQty` to `storeInventoryRowSchema` and a matching `at_vendor` CTE
(`SUM(v_osp_wip.at_vendor_qty)` grouped by item, company-scoped) to the Store
rollup query, surfaced as an "At Vendor" column between On PO and Mfg Pending,
coloured `--orange` with a hover title. Read-only and additive — no ledger,
filter, summary-tile or write path changes.

Verified against live data: the one item with material out now reads
`in stock 5 · at vendor 5 · on PO 15`.

### Alternatives Considered
- Net at-vendor *into* in_stock — rejected: in_stock must stay the shelf count and
  the ledger's balance; conflating them re-creates the ambiguity ADR-067 removed.
- Split `on_po_qty` into purchase vs job-work in the same change — deferred: it
  redefines an existing displayed number, so it wants its own decision.

### Consequences
- Positive: the storekeeper can see that 5 pcs are out at a vendor and will return.
- Negative: one more CTE per Store list query; `v_osp_wip` is document-derived, so
  the cost scales with jc_ops rather than items.
- Note: `atVendorQty` is NOT part of in_stock and must not be summed into the
  totalStockPieces tile (left untouched deliberately).

## ADR-094: "From Stock" removed — full-outsource material is always purchased
**Date:** 2026-08-03
**Status:** Accepted (supersedes the choice introduced in ADR-091)

### Context
The Material Source picker on a full-outsource plan offered "From Stock" and
"Purchase New". ADR-091 fixed the backend so only "Purchase New" raised a
material PR — correct as far as it went, but it left "From Stock" meaning
nothing coherent: it raised no material PR AND issued nothing from the store
ledger, so selecting it sent the vendor no material at all.

The user's rule (2026-08-03): **a full-outsource plan is created at the initial
stage, before any stock exists** — "so there is no question to send material from
stock". With no BOM the raw and finished part share one item code, and the store
holds nothing for that code at plan time. "From Stock" therefore described a
situation that cannot occur.

Live data agreed: all 8 full_outsource plans carried 'From Stock', and not one of
them ever produced a store issue — because there was never anything to issue.

### Decision
Remove the option. Material source is fixed at `FO_MATERIAL_SRC = 'Purchase New'`,
exported from `packages/shared/src/schemas/plan.ts` so both UIs and any future
caller share one literal.

- `plans/components/plan-form.tsx` and `so-planning/components/edit-plan-modal.tsx`:
  the `<select>` becomes a read-only display of the constant with a caption
  ("Material PR is raised on execute"). The field is kept visible rather than
  deleted so the planner can still see what will happen on execute.
- Both payload builders send `FO_MATERIAL_SRC` for `full_outsource` and `null`
  otherwise, so a legacy row is normalised off 'From Stock' when re-saved.
- `plans/service.ts` keeps its `matSrc === 'purchase new'` test rather than
  raising unconditionally. This is deliberate: an un-executed legacy plan still
  holding 'From Stock' keeps its original no-PR behaviour instead of silently
  buying material the planner never asked for. New plans can only be 'Purchase New',
  so the guard is a legacy shim, not a live branch.

### Alternatives Considered
- Leave a one-option `<select>` — rejected: a dropdown with a single choice reads
  as broken and invites re-adding the retired value.
- Delete `fo_material_src` from the schema — rejected: 8 prod rows carry it and the
  plan detail screen displays it; dropping the column loses history for no gain.
- Raise the material PR unconditionally on execute — rejected for now, see above:
  it would change behaviour for un-executed legacy 'From Stock' rows.

### Consequences
- Positive: the option that could leave a vendor with no material is gone; every
  new full-outsource plan raises a material PR on execute.
- Positive: one shared constant replaces two hand-typed string literals across
  two modules, so the value can't drift.
- Negative: if a shop ever genuinely does have shelf stock to send a vendor, this
  needs revisiting — that flow would also need a real store issue on the outward
  DC, which does not exist today (ADR-067 made the send stock-neutral).
- Open: whether "the vendor supplies his own material" deserves its own explicit
  option. Not modelled; today it is indistinguishable from 'Purchase New'.

## ADR-095: Full outsource raises ONE PR — no material PR at all
**Date:** 2026-08-03
**Status:** Accepted (supersedes ADR-091 and ADR-094)

### Context
ADR-094 removed the "From Stock" option and made every full-outsource plan
'Purchase New', so every plan raised a material PR alongside the JW PR. Testing
PLN-0019 (LOCKING LEVER, 30) exposed why that is wrong.

With no BOM the raw bar and the finished part share one item code, and a
full-outsource JC has exactly one op — the outsource op, which is therefore the
JC's LAST op. So the ADR-092 guard does not fire and the vendor's return credits
stock. Buying material as well would credit the same 30 pieces twice:

  material GRN  +30  →  30
  DC to vendor    0  →  30   (stock-neutral, ADR-067)
  vendor return +30  →  60   ← 60 booked for 30 physical pieces

The missing leg is a debit when the material ships out, which ADR-067 removed
after SO-517. Rather than reintroduce a conditional debit, the user's answer was
simpler and matches how the shop actually buys: **"we do not want to generate
material pr. single jwpr we are ok with it."** On a full-outsource job the vendor
supplies his own material; Innovic buys the finished part, not the raw stock.

### Decision
`executeFullOutsource` raises exactly one PR — the JW PR for the vendor's work.
The material-PR block is deleted outright, not gated behind a value test, so no
legacy `fo_material_src` value can resurrect it. `fo_mat_pr_id` is written NULL
going forward.

- `plans/service.ts`: material PR insert removed; `materialPrCode` no longer set
  on `ExecutePlanResult`; activity-log detail drops the "+ material PR" clause.
- Material Source field removed from `plans/components/plan-form.tsx` and
  `so-planning/components/edit-plan-modal.tsx`; `foMaterialSrc` dropped from
  `PlanFormValues` and always written null. `FO_MATERIAL_SRC` (added in ADR-094,
  live for one afternoon) deleted from `packages/shared`.
- `fo_material_src` and `fo_mat_pr_id` columns are KEPT — 9 prod rows carry a
  material source and PLN-0003 / PLN-0009 / PLN-0019 carry a material PR id. The
  read paths (plan detail "Mat PR", SO-planning workflow PrLink) still render
  theirs; new plans simply show "—".

Net stock effect is now correct with no further change: nothing is bought, the
vendor's return is the single credit, +30 for 30 pieces.

### Alternatives Considered
- Debit stock on the outward DC when material was purchased for that JC
  ("Option 1", offered to the user) — rejected: reintroduces the debit ADR-067
  removed after SO-517, needs a plan → material PR → PO → GRN trace to stay safe,
  and models a material purchase the shop does not actually make.
- Suppress the credit on every job_work return instead — rejected: a
  full-outsource JC has no final QC op to credit later, so the finished parts
  would never reach store at all.

### Consequences
- Positive: one PR, one PO, one DC, one GRN. The double-credit cannot occur
  because there is no second receipt.
- Positive: ADR-092's mid-route guard is untouched and still needed — it covers
  manufacture JCs with an outsource op in the middle, a different case.
- Negative: if a job ever genuinely needs Innovic to supply material to the
  vendor, there is now no way to express it. That would need both a material PR
  and the outward-DC debit from "Option 1" above.
- Housekeeping: IN-JWPR-00020 (PLN-0019's material PR, status open) was raised
  under ADR-094 before this change and should be cancelled by hand.

## ADR-096: Client-material gate — first op of a JWSO Job Card is capped at Party-GRN received qty
**Date:** 2026-08-04
**Status:** Accepted

### Context
In job-work (JWSO), the client supplies the raw material, recorded via a Party
Material GRN. Audit found NO gate: `startOp`/`submitOpLog` only checked
`v_jc_op_status.available` (derived from `jc.order_qty`), never material
received. A JWSO Job Card could be started and fully completed with zero client
material recorded — the only signal was a display-only "Not received" badge.
Requirement from the operator: work must be limited to the quantity of material
actually received for that part, rising automatically as more material arrives
(order 50, received 30 → only 30 workable; +20 received → remaining 20 unlock).

### Decision
Enforce a client-material cap in the op-entry service guards:
- New helper `loadMaterialCap(tx, op, companyId)` in `op-entry/service.ts`.
- Applies ONLY to the FIRST op (lowest non-deleted `op_seq`) of a JWSO-sourced
  Job Card (`job_cards.source_jw_line_id IS NOT NULL`). Later ops need no check
  — they are already bounded by the previous op's output. SO-sourced / direct
  Job Cards are never capped.
- Received-for-part = SUM(`party_grn_lines.received_qty`) for the JC's JWSO.
  Single-line JWSO → all receipts count (robust even if line-no text is blank);
  multi-line JWSO → matched on `jw_line_no_text = line_no` so one part's
  material never covers another.
- `startOp`: block when `available - shortfall <= 0`
  (`shortfall = max(0, orderQty - received)`).
- `submitOpLog`: cap loggable qty at `available - shortfall`.
- Recomputed on every start/log, so posting a new Party GRN lifts the limit
  automatically. No DB migration, no schema change — pure code, computed from
  existing Party-GRN data.

### Alternatives Considered
- Add a real FK `party_grn_lines.jw_line_id` + per-line expected qty + a
  "client supplies material" flag — rejected FOR NOW: needs a migration,
  backfill, and a Party-GRN form change; higher risk, can't be applied/tested
  from this environment. Left as future hardening (see Consequences/Risks).
- Enforce in the `v_jc_op_status` view — rejected: the view is shared and
  critical; a surgical guard-layer change is lower blast-radius.
- All-or-nothing hard block until fully received — rejected: the operator
  explicitly wants partial progress up to the received qty.

### Consequences
- Positive: closes the biggest control gap — no JWSO production without recorded
  client material; partial-material flow works; limit self-updates on each GRN.
- Negative / behavior change: any in-flight JWSO Job Card with no recorded Party
  GRN will now be blocked at op 1. Must be validated in staging before prod;
  do NOT flip on a live floor without checking GRN-recording habits first.
- Risks: multi-line JWSOs with a BLANK `jw_line_no_text` compute received=0 for
  that part and block — intended safety direction, but surfaces sloppy GRN data.
  Not covered: QC-first-op (uses qc-log, not guarded here), and OSP first ops
  (separate procurement path). Future: add the `jw_line_id` FK for exact
  per-line matching independent of the free-text line number.

## ADR-097: Client-material gate extended to ALL first-op doors (QC + outsource)
**Date:** 2026-08-04
**Status:** Accepted (extends ADR-096)

### Context
ADR-096 gated only the machining doors (`startOp` + `submitOpLog`). Operator
requirement clarified: the restriction must apply to the FIRST op of a JWSO Job
Card WHATEVER its type — no client material → no action at all.

### Decision
`loadMaterialCap` is now exported and reused across the three first-op doors:
- **Machining** (`op-entry/service.ts` `startOp`, `submitOpLog`) — ADR-096.
- **QC / inspection** (`op-entry/service.ts` `submitQcLog`) — cap the inspected
  qty (`qty + rejectQty`) at material received when the QC op is the first op.
- **Outsource / send-to-vendor** (`delivery-challans/cascades.ts`
  `applyOutwardToJcOp`) — cap the sendable qty at material received, so client
  material cannot be dispatched to a vendor before it has arrived. Reduces the
  existing ADR-078 `sendable` by the material shortfall.

Rule everywhere: first op of a JWSO Job Card, capped at Party-GRN received qty,
zero received → fully locked, limit rises automatically on each new GRN.

### Consequences
- Positive: the gate now holds regardless of routing shape (machining-first,
  QC-first incoming inspection, or full-outsource send-first).
- Not covered: the alternate `jw-dc` outward path is op-unaware (does not touch
  `jc_ops`) — it stays ungated until the duplicate OSP-outward system (Stage-4
  audit) is consolidated onto the canonical `delivery-challans` path. Flagged.
- Verified: `pnpm --filter api typecheck` + `lint` both clean; no import cycle
  (op-entry deps do not import delivery-challans).

## ADR-098: Phase-A guard rails — over-plan/over-ship caps, on-hand floors, concurrency locks
**Date:** 2026-08-04
**Status:** Accepted

### Context
Verification audit confirmed several qty-conservation holes were still live:
over-planning and over-dispatch had no server cap; customer-dispatch and the
jw-dc outward path could drive on-hand negative; concurrent op logs / dispatches
could both pass a read-then-write check and over-commit. These are the quick,
no-migration "Phase A" guard rails.

### Decision
Pure-code guards (no schema change):
- **Over-plan cap** (`plans/service.ts`): new `assertPlanQtyWithinRemaining`,
  called in `createPlan` + `updatePlan`. Reads authoritative `order_qty` from
  the SO/JW line and sums non-cancelled sibling plans; rejects planQty beyond
  remaining. Also confirms the line exists in-company.
- **Over-ship cap** (`customer-dispatches/service.ts`): `availableQty` capped at
  `min(ready, orderQty) - dispatched` so over-production can't ship past order.
- **Dispatch on-hand floor** (`customer-dispatches/service.ts moveDispatchStock`):
  reject when `qty > on_hand` (was silently going negative).
- **JW-DC outward on-hand floor** (`jw-dc/service.ts`): lock the items row +
  reject when `sentQty > on_hand` (was clamping the snapshot while the trigger
  drove the real balance negative).
- **Concurrency locks**: `SELECT ... FOR UPDATE` on the jc_ops row in
  `submitOpLog` + `submitQcLog` (over-production race); `FOR UPDATE` on the SO
  lines in `createDispatch` before the availability read (double-dispatch race).

### Deferred (not in Phase A)
- The store_transactions insert RLS-role fix (#6 second half) needs a DB
  migration and the audit found the policy may not be enforced at runtime
  (pooled connection role). Moved to Phase D with the other migrations.

### Consequences
- Positive: closes over-plan, over-ship, negative-stock (dispatch + jw_out), and
  the two read-then-write races — all without a migration.
- Verified: `pnpm --filter api typecheck` + `lint` clean. Not run against the
  test suite (hits prod DB, per standing constraint).
- Note: over-plan cap now rejects direct API attempts to plan/dispatch beyond
  order qty — a behavior change for any caller that relied on the old freedom.

## ADR-099: Qty-aware SO/JW line close — don't close until fully produced (Phase B #1a/#9)
**Date:** 2026-08-04
**Status:** Accepted

### Context
`tryCascadeJcComplete` closed a SO/JW line the instant ANY of its Job Cards
reached `complete`, with no comparison to the line's order qty. A line of
orderQty 100 served by a JC of 40 closed on that JC's completion, stranding the
60 balance — and because planning lists only `open` lines, the balance vanished
from planning (could never be planned).

### Decision
`op-entry/sales-cascade.ts`: new `producedForLine(tx, lineCol, lineId)` sums the
FINAL-op effective output across all non-deleted JCs for the line (QC-accepted /
Incoming-QC-accepted GRN qty for outsource / completed qty) — the SAME calc the
dispatch-readiness query uses, so "fully produced" and "fully dispatchable"
agree. `cascadeSo` / `cascadeJw` now load the line's `order_qty` and return a new
skip (`so_line_qty_incomplete` / `jw_line_qty_incomplete`) when produced <
ordered, closing the line only once the whole qty is produced.

### Consequences
- Positive: partial JCs no longer close a bigger line; the balance stays `open`
  and visible in planning. Fixes the stranded-balance bug.
- Nuance: a complete JC on a not-yet-fully-produced multi-JC line no longer sets
  the JC's `closed_at` (only the JC that finishes the line does). Informational
  only.
- Follow-up (not in this change): a legitimate short-close (order reduced, e.g.
  make 95 of 100 and stop) now leaves the line open — a manual "close short"
  action is still needed. Pairs with the JWSO close-out / dispatch-reconcile work.
- Verified: `pnpm --filter api typecheck` + `lint` clean.

## ADR-100: Party GRN over-receipt block — cannot receive more than the line's order qty
**Date:** 2026-08-04
**Status:** Accepted

### Context
Party Material GRN had no ceiling: cumulative received for a JW line could exceed
the order qty (e.g. IN-JW-00002 line 1 ordered 100, received 60 then 100 = 160).
Nothing stopped it.

### Decision
`party-grn/service.ts createPartyGrn`: before inserting each line, sum existing
received for that JW line (matched by `jw_line_no_text` = line_no, across all
non-deleted GRNs for the order) plus earlier lines in the same receipt; reject
when it would exceed the line's `order_qty`. Friendly message names the part and
the remaining receivable qty. Lines with no line number are not attributable to
a part and are not capped (data-quality gap, flagged).

### Consequences
- Positive: hard stop on receiving more material than ordered, per part.
- Existing over-received rows are NOT retroactively corrected (Party GRN has no
  edit/delete path); the block applies to new receipts only.
- Verified: `pnpm --filter api typecheck` + `lint` clean.

## ADR-101: Cancelling a PR must release its JC op — dead paperwork commits nothing
**Date:** 2026-08-04
**Status:** Accepted

### Context
Reported against SO-002 → PLN-0022 → IN-JWPR-00024 → IN-JC-26-00022. The user
raised a full-outsource plan, decided the operation should be done in-house
instead, **cancelled the PR**, then opened the JC to retype op 1 from
`outsource` to `process`. The save was refused with:

> Cannot change the type of an outsourced operation that already has a PR/PO —
> cancel the PR/PO first.

They had already done exactly that. The instruction was unsatisfiable.

Root cause, confirmed against the live DB:

* `rejectPurchaseRequest` (`purchase-requests/service.ts`) set
  `purchase_requests.status = 'cancelled'` and appended the reason to remarks.
  That is **all** it did.
* The stamp the PR had written onto its source operation —
  `jc_ops.outsource_pr_id` + `jc_ops.outsource_status = 'pr_raised'` — was left
  in place. A grep of the whole API found **no code path anywhere** that ever
  sets either column back to NULL (only a test fixture). The stamp was a
  one-way latch.
* The JC-edit lock guard (`job-cards/service.ts`) computed `committed` from
  those three columns alone:
  `outsourceStatus != null || outsourcePrId != null || outsourcePoLineId != null`.
  It never checked whether the PR behind the stamp was still alive.

Live state of the reported op: `outsource_status = 'pr_raised'`,
`outsource_pr_id → IN-JWPR-00024 (cancelled)`, `outsource_po_line_id = NULL`,
`outsource_dc_no = NULL`, `outsource_sent_qty = 0`, zero `op_log` rows. Nothing
was committed to anything, and the op was frozen permanently.

Not a one-off — four prod ops were in this state:
IN-JC-26-00005/00013/00014/00022, all op 1, all against a cancelled PR.

A second, related gap: `POST /jc-ops/:id/outsource-balance` (ADR-081) goes
in-house → OSP. There is no reverse action, so the JC-edit retype is the only
OSP → in-house route — and it was the blocked one.

### Decision
Dead paperwork commits nothing. Fixed on both sides:

1. **Release on cancel** (`purchase-requests/service.ts`). A new
   `releaseSourceJcOps(tx, prId, user)` helper clears `outsource_pr_id` and
   `outsource_status` on any op stamped by that PR. Called from
   `rejectPurchaseRequest` and from `softDeletePurchaseRequest`. Scoped to ops
   with **no** `outsource_po_line_id` and a pre-PO status
   (`'pending' | 'pr_raised'`) — a real commitment is never unwound. The
   activity-log line records that the op was released.
2. **The lock guard reads the PR's real state** (`job-cards/service.ts`). The
   `existing` op select now LEFT JOINs `purchase_requests`, and `committed`
   requires one of: a PO line pointing at the op, an outsource status in
   `OSP_MOVED_STATUSES = {po_created, sent, received}` (material has moved), or
   a PR that is still alive (not `cancelled`, not soft-deleted). A bare
   `pr_raised` stamp behind a dead PR no longer latches.
3. **Migration `0082_release_jc_ops_from_dead_prs.sql`** — data-only,
   idempotent, clears the stale stamp on rows written before this fix, using the
   same PO-line / status safety filter.

Clearing the stamp also makes the op eligible for the auto-raise in step 3b of
`updateJobCard` again (its filter is `outsource_pr_id IS NULL AND
outsource_status IS NULL`). That is the intended next state: an op that is still
`op_type = 'outsource'` with no live PR does need one.

### Alternatives Considered
- **Guard fix only** — rejected: the four legacy rows would keep a stamp
  pointing at a cancelled PR, so the DB would keep lying about op state and the
  OSP register could show phantom rows.
- **Clear the stamp in `updateJobCard`'s upsert whenever an op is not
  `outsource`** — rejected, and it would have been a regression: ADR-081
  dual-lane deliberately puts `outsource_pr_id` + `pr_raised` on a
  **`process`** op, so a plain no-change JC save would have wiped a live
  dual-lane link.
- **Auto-cancel the PR from the JC edit screen** — rejected: silently killing
  procurement paperwork as a side-effect of an ops edit. Cancelling a PR should
  stay an explicit, logged act on the PR.

### Consequences
- Positive: the error message is now satisfiable — cancel the PR, then retype
  or remove the op. This is the OSP → in-house route that was missing.
- Positive: `jc_ops` outsource columns now mean what they say. An op carrying
  `pr_raised` has a live PR behind it.
- Positive: fixes the four stuck prod ops without hand-editing rows.
- Negative: after cancelling a PR, re-saving the JC with the op still typed
  `outsource` auto-raises a fresh PR. Correct, but it will surprise anyone who
  expected the op to stay bare.
- Risk: an op whose real commitment lives *only* in a status past PO issue and
  nowhere else stays locked. Deliberate — `sent`/`received` means material is
  physically at a vendor.
- **The new tests are UNRUN.** `pnpm --filter api test` seeds and deletes on the
  prod DB, so the suite was not executed. Verified by typecheck + lint only;
  treat the first CI run as their real verification.

## ADR-101: Direct Purchase disabled for JWSO plans (UI + server)
**Date:** 2026-08-04
**Status:** Accepted

### Context
Direct Purchase = buy the finished item outright; meaningless for job-work,
where the client owns the job and supplies material. The plan-edit modal still
offered it for JWSO plans and there was no server guard.

### Decision
- Web `edit-plan-modal.tsx`: hide the Direct Purchase tab when `plan.jwLineId`
  is set (`isJw`).
- API `plans/service.ts`: `createPlan` + `updatePlan` reject
  `planType='direct_purchase'` when a `jwLineId` is present.

### Consequences
- JWSO plans can only be Manufacture / Full Outsource (+ Assembly). SO plans
  keep all types. Verified: api+web typecheck + lint clean.

## ADR-102: Party GRN must name a real JWSO line, and the material must be that line's part
**Date:** 2026-08-04
**Status:** Accepted

### Context
Audit of the live Party GRN data for IN-JW-00002 (client Arindam, CLI-009):

```
JWSO lines:  1 LEVER (559918174000) 100 | 2 SINGLE FIRE CHECK LEVER (554117165000) 100 | 3 SPACER 100
PGRN-00001 14:19  PM-0001 (LEVER) -> line 1 -> 60
PGRN-00002 14:37  PM-0001 (LEVER) -> line 1 -> 100      line 1 total = 160 vs order 100
PGRN-00003 15:12  PM-0001 (LEVER) -> line 2 -> 1        WRONG PART
```

Three separate defects, one screen:

1. **`jwLineNoText` was optional free text.** The ADR-100 over-receipt cap only
   ran `if (lnKey && lineByNo.has(lnKey))` — so a blank line number, or one that
   did not exist on the JWSO, silently disabled the cap entirely. The UI made
   this easy: an `<input list="dlPGrnJwLine">`, and a datalist is a suggestion,
   not a constraint.
2. **Nothing checked that the material was that line's part.** PM-0001 is pinned
   to item `559918174000` by the party-material master (which has a proper
   Client → order → item cascade). JW line 2 is item `554117165000`. The two
   were never compared. PGRN-00003 is the result.
3. **No way to undo.** The module had three read routes and one create route.
   A wrong receipt was permanent.

Consequence beyond the party stock number: `op-entry/service.ts` caps a JWSO
Job Card's first operation at the party-GRN received qty for that line
(ADR-096/097), matching on the *same* `jw_line_no_text`. So line 1 could start
160 pieces on a 100-piece order, while line 2 believed it had 1 piece of client
material that does not exist — and the real LEVER was not counted where it
belonged.

The over-receipt on line 1 predates ADR-100: PGRN-00001/00002 were entered at
14:19 and 14:37, the cap was written at 14:45.

### Decision
1. **`jwLineNoText` is REQUIRED** (`packages/shared/src/schemas/party-grn.ts`,
   `.min(1)`), and `createPartyGrn` additionally verifies the number is a real
   line on *that* JWSO — unknown line numbers are rejected by name, listing the
   valid ones. This restores ADR-100's cap unconditionally rather than leaving
   it opt-in.
2. **Part identity is enforced.** `party_materials.item_id` must equal
   `job_work_order_lines.item_id`. Skipped only when either side has no item
   link (legacy rows) — those cannot be checked, and refusing them would block
   otherwise-valid receipts.
3. **Client identity is enforced.** Party material is customer-owned; it cannot
   be received against another customer's JWSO.
4. **`cancelPartyGrn(id, reason, user)`** + `POST /party-grn/:id/cancel`.
   Soft-deletes header and lines, subtracts the qty from
   `party_materials.stock_qty` / `received_qty`, writes an activity log.
   Refused when the reversal would drive stock negative — those pieces are
   already issued to a Job Card, and that issue must be reversed first.
5. **UI matches the server.** The JWSO Line box is now a real `<select>` of that
   JWSO's lines; the material picker is filtered to the JWSO's client and
   disabled until a JWSO is chosen; the material's linked item code is shown
   beside its name and a part mismatch is flagged in red *before* Save.

### Alternatives Considered
- **UI-only fix (dropdown, no server guard)** — rejected: the API is reachable
  directly, and the existing bad rows prove free text is not survivable.
- **Warn instead of refuse on a part mismatch** — rejected: the mismatch
  silently corrupts two production gates at once, and there is no legitimate
  reason to receive part A's material against part B's line.
- **Hard-delete on cancel** — rejected, violates rule 8 (soft delete only) and
  destroys the audit trail of a receipt that physically happened.
- **Renumbering the duplicate ADR-101** — not done; see Consequences.

### Consequences
- Positive: the order-qty cap can no longer be bypassed by leaving a box blank.
- Positive: wrong-part receipts are impossible, and existing mistakes are now
  reversible.
- Negative: a Party GRN line without a JWSO line number is now rejected. No
  legitimate caller sends one — the only UI always had the box — but a stale
  browser tab will get a validation error until it reloads.
- Negative: the material picker is empty until a JWSO is selected. Intentional,
  since the client is unknown before that.
- **Existing bad data is NOT repaired by this change.** Line 1 still reads 160
  against an order of 100, and PGRN-00003's misfiled LEVER still sits on line 2.
  Both are now cancellable through the UI, but which way to correct them is a
  business call (did the client ship 160 or 100?), so nothing was touched.
- **Numbering note:** `ADR-101` appears twice in this log. "Cancelling a PR must
  release its JC op" (commit `740a0b7`) landed first; "Direct Purchase disabled
  for JWSO plans" (commit `0015007`) reused the number afterwards. Both are
  referenced by that number in their own code comments, so neither was
  renumbered — this entry takes 102.
- **The new tests are UNRUN.** `pnpm --filter api test` seeds and deletes on the
  prod DB. Verified by typecheck + lint only; the first CI run is their real
  verification. `party-grn` had no test file at all before this change.

## ADR-103: JWSO production is gated on material ISSUED, not merely RECEIVED
**Date:** 2026-08-05
**Status:** Accepted

### Context
ADR-096/097 capped the first op of a JWSO Job Card at the Party-GRN **received**
qty for the part. Receiving was therefore sufficient to start work, which made
the Party Material Issue document optional in practice. The live database held
exactly **one** issue — and my own e2e run created it.

The consequence, from live rows:

```
IN-JW-00002  received 161 · issued 0 · returned to customer 50
PM-0001      received 161 · issued 0 · on hand 161      ← 111 is the truth
PM-0003      received 100 · issued 10 · on hand 90      ← 20 machined, so 80
```

Party stock never came down, because nothing forced the document that draws it
down. A Party Material Register built on those numbers would publish stock the
company does not hold.

User's rule (2026-08-05): *"user can only start log after issuing qty — party
material issued. in case of qty 0 no start log"*, with 1 piece received = 1
piece issued = 1 piece machinable, the customer always supplying material on a
JWSO, and existing job cards left alone.

### Decision
1. **The gate measures ISSUED to the job card.** `loadMaterialCap` returns the
   qty issued to THIS Job Card; `shortfall = orderQty − issued`. Zero issued
   blocks `startOp` outright, not just `submitOpLog` — an operator cannot even
   open a session.
2. **Cutover flag, not a hidden date.** `job_cards.client_material_gate`
   (migration 0083). All 26 job cards existing at cutover were set `false` and
   keep the ADR-096/097 received-based behaviour; new ones default `true`.
   Switching them would have frozen five live jobs with zero issued
   (IN-JC-26-00005/00021/00024/00025/00028) and IN-JC-26-00027, which has
   already machined 20 against 10 issued.
3. **No material gate on QC.** Client-supplied material never goes through
   inspection — Incoming QC has no reference to `party_grn` at all, and the
   flow is GRN → Issue directly. The cap was removed from `submitQcLog`:
   QC only ever sees what production already made, and production is capped, so
   capping again double-counted the same restriction.
4. **The issue document is tightened** (the ADR-102 treatment, applied here):
   - **Job Card is mandatory.** It is the ONLY link from an issue to a JWSO
     *line* — the table has no `job_work_order_line_id` — and the gate is
     per-line. While it was optional, a blank job card made the issue invisible
     to the gate: material issued, operator still blocked, no explanation.
   - **Client identity** — the material must belong to the JWSO's customer.
   - **Part identity** — `party_materials.item_id` must equal the JW line's
     `item_id`.
   - **Per-line ceiling** — issued for a line may not exceed received for that
     line. The old per-material check let all 100 pieces received for
     IN-JW-00005 line 1 (COVER) be issued to line 2's job card instead.
   - **Job-card ceiling** — never issue more than the job card is making, with
     a plain message naming what is already issued and what remains.
5. **`cancelPartyMaterialIssue`** + `POST /party-material-issues/:id/cancel`.
   Required, not optional: once issued qty controls whether anyone may work, a
   typo would unlock production for the wrong quantity permanently, and the
   ADR-102 Party GRN cancel already refuses while material is issued — a
   deadlock. **Guarded**: material already machined cannot be un-issued, since
   that would drive the job card's remaining material negative and freeze it.
6. **RM AVAIL tile** on the JC status page beside ORDER, first op only, showing
   `issued − produced on the first op` with the issued figure beneath. Null (and
   hidden) for SO-sourced and pre-cutover job cards, so a Job Card the rule does
   not govern never shows a misleading zero.

### Alternatives Considered
- **Auto-issue on op log** (my recommendation at the time) — the system writes
  the issue itself when work is logged. Rejected by the user in favour of an
  explicit document. Auto-issue assumes 1:1 silently and leaves no human record
  of who released the customer's material.
- **Switch every job card at once** — rejected: five live jobs would have
  stopped dead on deploy.
- **Derive consumption from production output instead of an issue document** —
  rejected: least typing, but the register would disagree with the paperwork.

### Consequences
- Positive: party stock now moves when material actually leaves the store, so a
  client-wise Party Material Register can be built on numbers that mean
  something.
- Positive: wrong-client, wrong-part and wrong-line issues are all refused.
- Positive: the Party GRN cancel deadlock is resolved — cancel the issue first.
- Negative: one more compulsory document before production can start on a JWSO
  job. That is the user's explicit trade.
- Negative: the RM AVAIL tile reads `issued − produced`, so a job card that
  over-produced under the old rule shows 0. Correct, but it will look odd on
  IN-JC-26-00027 (20 made, 10 issued) — which is exempt anyway.
- **Not addressed, and still open:** scrap has nowhere to go (make 20, reject 2,
  and the 2 pieces of customer material are unaccounted for); there is no
  document for returning UNUSED raw material to a customer; and a part needing
  two different party materials is not modelled.
- **PM-0003 still reads 90 on hand against a true 80** — pre-existing data, not
  corrected here.
- **The new tests are UNRUN.** `pnpm --filter api test` seeds and deletes on the
  prod DB. Verified by typecheck + lint only.

## ADR-104: Return + Invoice must offer CLOSED JWSOs — a finished job is exactly when they are due
**Date:** 2026-08-05
**Status:** Accepted

### Context
Found by the end-to-end chain run (`flow-jwso-chain.spec.ts`). IN-JW-00004 was
driven the whole way — material received, issued, machined, QC passed — and then
stalled:

```
IN-JW-00004  status: closed      line 1 status: closed
jw_return_challans for it: 0
jw_invoices for it:        0
```

The Playwright run confirmed it through the UI: the JWSO is not offered by the
picker on either screen.

Cause: a JWSO closes automatically when its Job Card's final QC passes
(ADR-099, qty-aware close). Both `jw-returns` and `jw-invoices` asked for
`status: 'open'` JWSOs only. So the order disappeared from the two screens that
finish it, at the precise moment it became ready for them — the goods cannot be
sent back and the work cannot be billed.

Neither service checked JWSO status. `createJwReturnChallan` bounds a return by
`produced − already returned` and by the ordered qty; the invoice path has no
status check at all. The block was purely the picker.

### Decision
Drop the `status: 'open'` filter from the JWSO picker on **jw-returns** and
**jw-invoices**. Both pickers are search-driven (the user types the JWSO number
or customer), and the real limits already live in the service.

**Party GRN keeps its `status: 'open'` filter** (ADR-102). Receiving raw material
against a finished order is a genuine mistake worth blocking; returning and
billing a finished order is the whole point of finishing it.

### Alternatives Considered
- **Show only closed JWSOs with unreturned/unbilled qty** — better filtering,
  but it needs a rollup the list endpoint does not expose today, and it would
  still hide a legitimately re-opened order. The qty guards already refuse an
  over-return, so the extra filtering buys correctness we already have.
- **Stop auto-closing the JWSO at final QC** — rejected: ADR-099 close
  behaviour is correct and other screens depend on it.
- **Server-side allowance with the UI unchanged** — pointless; the user could
  never reach the form.

### Consequences
- Positive: a finished JWSO can be returned and invoiced. IN-JW-00004 is
  reachable again.
- Negative: the picker now lists closed JWSOs too, so an old fully-returned
  order can be selected. Selecting one is harmless — the service refuses the
  return (`only 0 produced & available`) and the qty ceiling holds.
- Not changed: the auto-close itself, and the Party GRN filter.
- Verified by typecheck + lint on all 4 packages. The end-to-end evidence for
  the bug is in `flow-jwso-chain.spec.ts` steps 08/09, which record the
  blockage explicitly rather than failing silently.

## ADR-105: A JWSO Job Card's final QC must NOT credit own stock
**Date:** 2026-08-05
**Status:** Accepted

### Context
Found by the end-to-end chain run. Driving IN-JW-00004 through to QC produced
this ledger row:

```
in | qty 10 | qc_accept | IN-JC-26-00026 Op #2 | 35 → 45   (item 554117146000)
```

Those ten pieces are **the customer's**. Arindam supplied the material
(PGRN-00004, 10 pcs), it was issued to the job card (IN-PMI-00001, party stock
10 → 0), and the finished parts go back to them on a JW Return Challan.

The full picture, confirmed in code:

* `party-material-issues/service.ts` correctly writes **no** own-stock ledger
  row — its own header comment says so.
* `jw-returns/service.ts` writes **no** ledger row when the goods ship back.
* `op-entry/qc-stock-cascade.ts` credited own stock on the last QC op with **no
  exclusion for JWSO-sourced Job Cards**.

So the credit went in and nothing ever took it out. Every customer-material job
overstated inventory by its full quantity, permanently. This is the same
no-BOM failure mode as ADR-067 and ADR-092: raw and finished share one item
code, so the customer's part is indistinguishable from ours.

User's instruction, 2026-08-05: *"customer goods credited to your own stock —
do not do that."*

### Decision
`tryApplyQcStockCascade` returns `{ fired: false }` when the Job Card has a
`source_jw_line_id`. The JC's source link is already loaded for `itemId`, so
this is one extra column and one guard — no new query.

The test asserts the distinction with two Job Cards identical in every respect
**except** their source link, so the JWSO link is the only thing that can
explain the different outcome.

### Alternatives Considered
- **Credit at QC, then debit on the return challan** — rejected: it would book
  the customer's goods as ours for the window between machining and dispatch,
  where they would appear available to sell or issue. They are never ours.
- **Gate on "was party material issued to this JC"** rather than the JWSO link
  — rejected as more fragile: an operator who skips the issue document would
  silently get the wrong behaviour, and ADR-103 already makes the issue
  mandatory for new job cards anyway.
- **A compensating ledger entry on return** — rejected for the same reason as
  the first option, plus it leaves two wrong numbers instead of none.

### Consequences
- Positive: own-stock figures stop drifting upward on every job-work order.
- Positive: the party-material side is now the single place customer material
  is tracked, which is what it was designed for.
- Negative: a JWSO job card now writes nothing to the stock ledger at all, so
  there is no own-stock trace of it. That is correct — the trace lives on the
  party material, the return challan and the invoice.
- **Existing wrong rows are NOT repaired by this change.** Two exist, totalling
  **60 pieces**, both still inflating on-hand:
  | Ledger row | Item | Qty |
  |---|---|---|
  | `IN-JC-26-00024 Op #3` | 559918174000 LEVER | +50 (0 → 50) |
  | `IN-JC-26-00026 Op #2` | 554117146000 LEVER CATCH RAMMER | +10 (35 → 45) |
  Correcting them needs a compensating `out` entry per item, which is a data
  decision for the user — deliberately not taken here.
- **The new test is UNRUN.** `pnpm --filter api test` seeds and deletes on the
  prod DB. Verified by typecheck + lint only.

## ADR-106: JWSO stock mirrors SO — final QC credits, JW Return Challan debits
**Date:** 2026-08-06
**Status:** Accepted — **supersedes ADR-105**

### Context
ADR-105 (one day old) stopped a JWSO Job Card's final QC from crediting own
stock, on the reasoning that the finished parts belong to the customer.

The user rejected that framing: *"i want jwso job card. final qc accept qty.
credits my own stock. as so jc is already doing."*

They are right, and ADR-105 diagnosed the wrong half. The machined parts **are**
physically in the store between QC passing and the lorry leaving — the ledger
should say so. The actual defect was never the credit; it was the **missing
debit**. `jw-returns/service.ts` wrote nothing to `store_transactions` when the
goods went back, so the credit had no counterpart and own stock climbed by the
full qty of every job-work order, permanently.

The sales side has always had both legs:

```
SO   : qc_accept (in)  →  dispatch  (out)     ← both existed
JWSO : qc_accept (in)  →  (nothing)           ← the hole
```

### Decision
Make the job-work side symmetric with the sales side.

1. **Revert the ADR-105 guard.** `tryApplyQcStockCascade` credits stock for a
   JWSO Job Card exactly as it does for an SO one. The JWSO link makes no
   difference to that cascade, and the test now pins that explicitly with two
   Job Cards identical except their source link.
2. **`moveReturnStock` in `jw-returns/service.ts`** posts the missing leg:
   `out` on create, compensating `in` on cancel. It deliberately mirrors
   `moveDispatchStock` in `customer-dispatches/service.ts`, including the
   **on-hand floor** — a return is refused when the ledger says the parts are
   not there yet: *"Insufficient stock to return: on-hand 0, requested 10.
   Complete machining + final QC so the parts are booked in before returning
   them."* That is the SO-517 class of bug, and job work is just as exposed.
3. **New source type `jw_return`** (migration 0084, applied). NOT `jw_out` —
   that is the historical OSP-send debit retired by ADR-067, and reusing it
   would make the ledger unreadable.
4. **Cancel writes a compensating `in`** rather than deleting the `out`, so the
   ledger keeps the whole history. Same as a cancelled customer dispatch.

### Alternatives Considered
- **Keep ADR-105 (no credit, no debit)** — rejected by the user. It also leaves
  a real gap: finished goods sitting in the building appear nowhere in stock,
  so nobody can see them.
- **Reuse `jw_out`** — rejected, see above.
- **Debit on the invoice instead of the return challan** — rejected: the goods
  leave on the challan; the invoice is a money document and may lag or never
  come.

### Consequences
- Positive: own stock now reflects reality on both sides. Job-work goods appear
  when machined and disappear when returned.
- Positive: the on-hand floor means a return challan can no longer be raised for
  parts that were never produced.
- Negative: returning goods now depends on the QC credit having happened. A JWSO
  Job Card whose final QC was never logged will refuse the return with the
  message above. That is intended — but it is a new way to be blocked, and it
  will bite on any job where QC was skipped.
- **ADR-105's data note still stands and is now WORSE-shaped than described
  there.** Two `qc_accept` rows on JWSO Job Cards total 60 pieces
  (`IN-JC-26-00024 Op #3` +50 of 559918174000; `IN-JC-26-00026 Op #2` +10 of
  554117146000). Under ADR-106 those credits are *correct* — what is missing is
  the matching `jw_return` debit for anything already sent back. IN-JW-00002's
  two return challans (10 + 40 = 50 of LEVER) also predate this change and
  posted no debit. Netting the ledger against physical reality is still a data
  decision for the user.
- **Tests UNRUN.** `pnpm --filter api test` seeds and deletes on the prod DB.
  Verified by typecheck + lint; migration 0084 applied and the enum verified.

## ADR-107: A BOM child plan is capped by its own requirement, not the parent line's
**Date:** 2026-08-06
**Status:** Accepted

### Context
Found by the BOM → equipment-SO e2e run. `BOM-0001` (one child, `554117144000`
COVER, **2 per set**) on `IN-SO-00007` (**3** assemblies). The BOM planning modal
correctly computed a need of **6** covers, offered it, and the server rejected
its own figure:

```
Plan qty 6 exceeds remaining 3 for this line (ordered 3, already planned 0).
```

`assertPlanQtyWithinRemaining` caps every plan on an SO line at that line's
`order_qty` and sums `plan_qty` across **all** plans on the line. A BOM child
plan sits on the parent's line but is measured in **child parts**, while the cap
is measured in **assemblies**. Two distinct failures follow:

1. **qty per set > 1** — 3 assemblies needing 6 covers reads as "planning 6 of
   something you ordered 3 of". Refused outright.
2. **more than one child** — even at 1 per set, the FIRST child's plan consumes
   the entire line allowance, so every sibling is refused:
   `COVER 3 → OK (remaining 0)`, then `LEVER 3 → BLOCKED`.

So the only BOM that could be planned was **one child at exactly 1 per set** —
the single case where assemblies and parts happen to be the same number, which
is why this survived.

### Decision
When a plan carries `bom_master_id` **and** `bom_child_code` on an SO line, cap
it against its own requirement instead:

```
required  = ceil(bom_master_lines.qty_per_set × sales_order_lines.order_qty)
counted   = other plans with the SAME so_line_id + bom_master_id + bom_child_code
```

Both numbers are read from the database inside the transaction — never from the
caller — so a client cannot inflate its own allowance. Non-BOM plans keep the
existing parent-line behaviour untouched.

Applied to **both** call sites: `createPlan` and the qty-change branch of
`updatePlan`. Editing a child plan's qty would otherwise re-impose the
parent-line limit the create path had just bypassed.

The refusal message now names the part and shows the arithmetic:
`… for BOM part 554117144000 (needs 6 = 2 per set x 3 ordered, already planned 0)`.

### Alternatives Considered
- **Skip the guard entirely for BOM plans** — rejected: it would allow planning
  1000 covers against a 3-assembly order, with nothing to catch it.
- **Cap at the parent line qty × the largest qty_per_set on the BOM** — rejected:
  a single ceiling shared by all children lets one child eat another's
  allowance, which is the sibling bug in a subtler form.
- **Fix it in the planning modal instead** — rejected: the modal already
  computes the right number; the server was the one refusing it, and the API is
  reachable directly.

### Consequences
- Positive: multi-child BOMs and qty-per-set > 1 are plannable, which is most
  real BOMs. Only the degenerate 1-child-1-per-set case worked before.
- Positive: over-planning a child is still refused, now against the correct
  ceiling and with an explainable message.
- Neutral: a BOM edited between opening the modal and saving may no longer match
  the child code; the guard then declines to invent an allowance and falls
  through, leaving the FK and the execute-time guards to catch it.
- **The e2e chain beyond planning is still unproven** — this unblocks the BOM
  explosion, and the job-card → dispatch → invoice tail runs next.
- **Tests UNRUN.** `pnpm --filter api test` seeds and deletes on the prod DB.
  Verified by typecheck + lint, plus running the new requirement query against
  the live rows (BOM-0001 × IN-SO-00007 → required = 6, matching the modal).

## ADR-108: A BOM must name the parent item it builds — exactly one, before any part

**Date:** 2026-08-07
**Status:** Accepted

### Context

`bom_masters` held a name, a status and a list of child parts — and nothing
that said *what those parts add up to*. The parent was implied by whichever
sales-order line happened to carry `source_bom_master_id`, which means:

- Reading a BOM on its own told you nothing about what it builds.
- Two SO lines for different items could point at the same BOM and both be
  "correct", because no rule tied a BOM to one product.
- It is the root of the open gap noted after the assembly e2e run: an
  equipment SO can be planned and produced, but never dispatched or invoiced,
  because producing the BOM children credits stock for the *children* and
  nothing ever credits the *parent*. Nothing could credit the parent — the
  parent was never recorded.

The user's instruction: "first add parent item, same as child item card, only
one parent item allowed, without parent item user cannot step forward."

### Decision

`bom_masters.parent_item_id uuid REFERENCES items(id)` (migration 0085), plus a
partial index for the "which BOM builds this item?" lookup.

- **Exactly one.** A column, not a table. An assembly with two parents is not
  an assembly.
- **Required on every write.** `createBomMasterInputSchema` and
  `updateBomMasterInputSchema` both demand it; `assertParentIsUsable` re-checks
  server-side that the item exists in the company.
- **The parent may not be one of its own children.** Enforced in the shared Zod
  refine, again in the service, and again in the form — a self-referential BOM
  is a loop that planning would explode forever.
- **NULLABLE at the DB level.** Six BOMs already exist with no parent and no way
  to infer one (no `sales_order_lines` row references any of them). A NOT NULL
  column would have refused the ALTER.
- **The form is the backfill.** Since update also requires a parent, each old
  BOM gets one the first time anybody edits it. Once
  `SELECT bom_no FROM bom_masters WHERE parent_item_id IS NULL AND deleted_at
  IS NULL` returns zero rows, the column can be tightened to NOT NULL.

**UI:** the parent sits at the top of the Part List panel in a card with the
same grid tracks as a child row (index / code picker / auto-filled name), so it
reads as the head of the list. It deliberately stops there — no Qty/Set (that is
what the children carry), no Type, no remove button. Until a parent is picked
the card is amber, "+ Add Item" and "Import Excel" are disabled, and the
existing rows go inert rather than disappearing (on the edit form a pre-0085 BOM
already has parts, and hiding them would read as "my BOM lost its parts").

### Alternatives Considered

- **A `bom_parents` child table** — rejected: models a many-parent BOM we
  explicitly do not want, and every read would need a join to answer "what does
  this build?".
- **Infer the parent from the linked SO line** — rejected: that is today's
  behaviour and it is exactly what is broken. A BOM with no SO yet has no
  parent, and two SO lines could disagree.
- **NOT NULL with a guessed backfill** — rejected: nothing in the data supports
  a guess. Six wrong parents are worse than six blank ones.
- **Warn instead of block** — rejected: the user asked for a hard gate, and a
  BOM whose parent is optional is the state we are trying to leave.

### Consequences

- Positive: a BOM is now self-describing. This is the prerequisite for the
  assembly/kitting step that will credit the finished parent to stock and let
  an equipment SO reach dispatch and invoice.
- Positive: BOM search now matches the parent's code and name — "which BOM
  builds this part?" is the question people actually arrive with.
- Positive: swapping the parent is recorded in the revision note
  (`Parent OLD → NEW · …`) instead of changing silently.
- Negative: the six existing BOMs cannot be edited until a parent is chosen.
  That is the intended cutover, but it will surprise whoever hits it first.
- Risk: nothing yet *uses* `parent_item_id` in planning or dispatch. It records
  the fact; the assembly step that acts on it is still an open design decision.
- **Tests UNRUN.** `apps/api/test/global-setup.ts` deletes from the live DB
  (`DELETE FROM public.items WHERE code LIKE 'T%-%'`) and no separate test
  database exists. Verified by typecheck + lint on all four packages, by
  applying 0085 and re-reading the column/index/FK from the live DB, and by
  driving the deployed form in Playwright.

## ADR-109: A BOM parent dispatches on its weakest component, and consumes components — never itself

**Date:** 2026-08-07
**Status:** Accepted

### Context

This closes the gap ADR-108 named: *"an equipment SO can be planned and
produced, but never dispatched or invoiced, because producing the BOM children
credits stock for the children and nothing ever credits the parent."*

The user's scenario, verbatim in shape: parent PEN = 1 x ITEM-1 + 1 x ITEM-2.
SO for 10 pens. ITEM-1 runs CNC-1 -> CNC-2 -> QC and credits stock on final QC.
ITEM-2 runs its own process and credits stock. If ITEM-1 has 5 and ITEM-2 has 4,
**ready to dispatch is 4 pens** — the 5th ITEM-1 has no partner. Dispatching 4
debits 4 of each. The invoice bills 4 pens; the components never appear on it.

Two defects blocked that, both traced to one root: `bom-master/cascade.ts`
spawns every child JC / PR with `source_so_line_id` = **the parent SO line**.

1. **Readiness summed the children.** `loadDispatchable` computed ready as
   `SUM(effective output)` over all JCs on the line. For a BOM line that is
   5 of ITEM-1 **plus** 4 of ITEM-2 = **9**, capped only by order qty. Nine of
   nothing — there is no set of parts that makes 9 pens. The dispatch screen
   invited shipping more than twice what exists.
2. **The stock leg pointed at the phantom.** `createDispatch` moved stock for
   `sales_order_lines.item_id` — the parent. Nothing ever credits the parent
   (the QC cascade credits `job_cards.item_id`, i.e. the child), so the on-hand
   floor saw 0 and the dispatch either hard-failed with *"Insufficient stock to
   dispatch: on-hand 0"* or, when the parent was free text, **silently moved
   nothing** — leaving component stock permanently overstated.

### Decision

**Readiness = MIN over components of FLOOR(componentReady / qtyPerSet).**
A new LATERAL in `loadDispatchable`, selected by
`CASE WHEN sol.source_bom_master_id IS NOT NULL`. Non-BOM lines keep the
existing SUM branch untouched. Component readiness reuses the same
effective-output math (QC-accepted for qc / qc_required ops, GRN-accepted for
outsource, else completed), narrowed to that component's item, plus GRN-accepted
qty on PO lines for `purchase` / `outsource` components — which previously
contributed **nothing**, because the direct-purchase LATERAL requires a
`plans` row and BOM-cascade PRs have none.

**Dispatch consumes components, at `qty x qtyPerSet`, one ledger row each.**
The parent is never debited. `source_ref` gains a ` / <childCode>` suffix so the
rows stay distinguishable — and so the dispatch register's exact-match join on
`code || ' / ln ' || line_no` does not fan out.

**Cancel replays the ledger, it does not re-explode the BOM.**
`loadDispatchedComponents` reads back the `out` rows this dispatch actually
wrote and reverses exactly those. A BOM edited between dispatch and cancel
therefore cannot leave the ledger unbalanced.

### Alternatives Considered

- **Derive readiness from component stock** (what `assembly/service.ts` does for
  Equipment SOs) — rejected for dispatch: stock is company-wide and unreserved,
  so a component consumed by another SO would still read as ready here.
  Production output on *this* SO line is the honest number, and
  `moveDispatchStock`'s existing on-hand floor remains the ledger-side guard.
  This is the established split — see the SO-517 comment in that function.
- **Credit the parent on assembly** (an assembly JC consuming children,
  crediting the parent) — rejected as a much larger change: it needs an
  assembly transaction, a new document, and a backfill. The phantom-parent model
  matches what the user described and what `assembly_units` already assumes.
- **Fix it in the dispatch UI** — rejected outright, Section 6 rule 1.

### Consequences

- Positive: the Equipment/BOM SO can finally reach dispatch and invoice.
  Component stock now moves, so `v_item_stock` stops drifting upward.
- Positive: the assembly tracker's `canAssemble` and dispatch's `ready` now
  agree in shape (both are min-over-components), where before they disagreed.
- Negative: readiness is still per-SO-line and unreserved — two SOs for the same
  assembly each see the same free components as theirs. Named, not fixed.
- Risk: components are debited only at dispatch, so stock sits unreserved from
  QC until the lorry leaves. Same exposure the SO path already had.

### Open

- Multi-level BOMs are **not** recursed. A component that itself has a BOM is
  read at its own produced qty, not exploded further. One level is what the
  cascade spawns today, so this matches reality — but it is a real ceiling.
- `assembly/service.ts` still derives readiness from stock while dispatch now
  derives it from production. Both are defensible in their own context; that
  they differ should be a deliberate call, not an accident.

## ADR-110: Job work can assemble — a JW line may name a BOM, but never a bought part

**Date:** 2026-08-07
**Status:** Accepted

### Context

ADR-109 fixed BOM assembly on the SALES side. An audit of the job-work side
then found BOM support was not broken there — it was **absent at every layer**:
no column on `job_work_order_lines`, no field on the create form, no cascade,
no readiness branch, no "where used" reporting, and no trace of it in the
legacy HTML either. `so-planning/service.ts` even documents the assumption in
a comment: *"JW lines carry no BOM master, so the Equipment and assembly-BOM
branches are always off here."*

That is defensible for classic job work — the client sends raw material, you
machine it, you send it back. It is wrong for **assembly** job work, which the
user confirmed they do: the client ships components and wants a finished unit
back. Without a BOM, such a JWSO has no way to say what it builds, and its
return challan counts only what its own job cards produced.

### Decision

`job_work_order_lines.source_bom_master_id` (migration 0086), and with it the
same three-part treatment ADR-109 gave sales orders:

1. **Cascade** — `cascadeBomToJwLine` spawns one child Job Card per component,
   carrying `source_jw_line_id`. Idempotent on re-save.
2. **Readiness** — `jw-returns.producedForLine` becomes
   `MIN over components of FLOOR(componentProduced / qtyPerSet)` for a BOM
   line, keeping the existing own-output SUM for every ordinary line.
3. **Stock** — a return debits each COMPONENT at `qty x qtyPerSet`. Cancel
   replays the ledger rows the return actually wrote rather than re-exploding
   the BOM, so a BOM edited in between cannot unbalance it.

**Component types are gated by CONTEXT** (the user's rule, 2026-08-07:
*"jwso bom type - purchase disable. jwso fulloutsource, manf valid. in case of
invalid type show friendly err. block for that type."*):

- `manufacture` — allowed, spawns a child JC.
- `outsource` — allowed, spawns a child JC **carrying an OUTSOURCE op**.
- `purchase` — **rejected**, with an error naming the offending parts.

### Alternatives Considered

- **Spawn a `purchase_request` for outsource components, as the SO cascade
  does** — rejected. `purchase_requests` has `source_so_line_id` but no
  job-work equivalent, so the PR would lose its link home. Adding that column
  was the alternative; seeding a JC + OSP op instead needs no new column, is
  exactly what `executePlan(full_outsource)` already does (ADR-095), and makes
  readiness work with no new code because an outsource final op is already
  scored from its GRN.
- **A CHECK constraint for the purchase rule** — rejected. The BOM is not
  invalid; it is invalid *here*. The same BOM is legitimate on a sales order,
  where buying the material is the whole point. A DB constraint would have to
  live on the BOM and would break sales.
- **Silently ignoring purchase components on a JW BOM** — rejected outright.
  It would quietly under-build the assembly and leave the user with no signal.

### Consequences

- Positive: an assembly JWSO can now be created, cascaded, produced, returned
  and invoiced end to end.
- Positive: the gate runs BEFORE any insert, so a bad BOM leaves no half-built
  JWSO behind.
- Negative: re-pointing an existing line at a different BOM updates the field
  but deliberately does NOT re-cascade (the cascade is idempotent on existing
  child JCs). Same behaviour as the sales-order update path. Changing the BOM
  of a line that has already spawned work is therefore a record-only change.
- Risk: the outsource child JC is seeded with **no vendor** — procurement picks
  it later through the existing OSP flow. A JC sitting with an unassigned
  OUTSOURCE op is now a state the shop floor can see.

### Open

- Multi-level BOMs still are not recursed, on either side (ADR-109 carries the
  same limitation).
- The BOM "where used" report reads `sales_order_lines` only, so an assembly
  JWSO does not yet show up as a consumer of its BOM.
- **No UI sets `source_bom_master_id` on the SALES side.** A picker was added
  to the JWSO line form here; the sales-order form still has none, so ADR-109's
  chain remains API-only until that is closed.

## ADR-111: "Pending" is one number, computed once, in the view

**Date:** 2026-08-10
**Status:** Accepted

### Context

The user reported that Job Card `IN-JC-26-00085` (item 229619569, PIN UNI ISO
2338-A-8x40, order 50) showed **"Op2 — 5 pending"** at a QC operation that had
already inspected every piece.

The trace found the ledger correct and the screens wrong. Op1 cut 50; Op2 (QC)
logged 25 accepted, then 20 accepted + **5 rejected**; the auto-NC
`NC-AUTO-IN-JC-26-00085-Op2-113117058` was dispositioned **rework at op_seq 1**,
which wrote `jc_ops(op1).rework_qty = 5`. So 50 arrived at Op2 and 50 were
resolved — `v_jc_op_status` correctly returned `qc_pending = 0`,
`computed_status = 'complete'`, and the QC Command / QC Dashboard queues
correctly did not list it.

Three screens each did their own arithmetic and produced three answers for that
one op:

| Screen | Formula | Op2 |
| --- | --- | --- |
| JC detail card (`jc-op-card.tsx:138`) | `inputAvail − qcAccepted` | **5** |
| Op Entry table (`jc-ops-table.tsx:82`) | `available` | **50** |
| QC dashboards | `v_jc_op_status.qc_pending` | **0** ← correct |

The JC card subtracted what QC **accepted** but never what it **rejected**, so
every rejected piece stayed on that screen as "still to inspect" forever —
whatever the NC disposition was. The 5 pins were advertised twice over: as
rework owed at Op1 and as pending inspection at Op2. It also grew: once the 5
are re-cut and logged, Op1 completed goes 50 → 55 and the card would have
printed `55 − 45 = 10`. The Op Entry column was worse — `available` on a QC op
is `input − op_log completes`, and a QC op never gets a complete log, so it
printed the whole batch.

### Decision

`v_jc_op_status` publishes **`pending_qty`** (migration 0087) and every screen
labelled "Pending" prints it and nothing else.

It is deliberately **not new arithmetic** — it selects between two columns the
view already computes:

- `op_type = 'qc'` → `qc_pending` (`input − accepted − rejected`; a reject
  resolves a piece exactly as an accept does)
- everything else → `available` (`input − done − sent + rework`; the work still
  on that bench)

So no existing consumer of `available` / `qc_pending` changes value, and the
three screens cannot drift apart again.

### Alternatives Considered

- **Fix the formula in `jc-op-card.tsx`** (subtract `qcRejectedQty` too) —
  rejected. It repairs one screen and leaves the Op Entry table printing 50,
  and it keeps a business calculation in a React component, which CLAUDE.md
  §6 rule 1 forbids. The bug existed *because* the number had three definitions.
- **Have the card read `qcPending` for QC ops and `available` otherwise** —
  rejected. Correct output, but the op-type switch is itself the business rule
  and would then have to be duplicated into every screen that grows a Pending
  column later.
- **Change what `available` means on a QC op** — rejected outright.
  `submitOpLog` validates against `available` (`service.ts:445`) and the
  op-entry availability snapshot depends on it; redefining it to fix a label
  would move a display bug into the write path.

### Consequences

- Positive: one definition. JC-85 Op2 now reads 0 on both screens; Op4 reads 2
  on both (it was 2 and 40).
- Positive: rework finally surfaces where the work is. Op1's pending goes 0 → 5,
  and the JC card gained the `♻ N` tag the Op Entry table always had — before
  this, the 5 rework pins were invisible on the JC screen entirely.
- Negative: `available` and `pending_qty` are now different numbers on a QC op,
  which will read as a redundancy to anyone who doesn't know why. The view
  comment and this ADR are the defence.
- Risk: none to data — the migration is `CREATE OR REPLACE` with an appended
  column and writes nothing.

### Open — two real defects this audit found and this ADR does NOT fix

1. **An op reads `complete` while it owes rework.** The complete branch fires on
   `completed_qty >= order_qty` before it looks at rework. `v_jc_status`
   (`0006_phase3_views.sql:145`) calls a JC complete when every op is complete,
   and `op-entry/sales-cascade.ts:106,138-141` then stamps `closed_at` and
   closes the SO/JW line. **A Job Card whose only outstanding work is rework can
   auto-close and close its sales-order line.**
2. **`jc_ops.rework_qty` only ever increments.** `nc-register/cascades.ts:130`
   adds to it; `closeNcReworkCascade` (`:369-409`) records
   `nc_register.rework_done_qty` and closes the NC but never decrements it. Once
   the 5 are re-cut, Op1's pending stays at 5 permanently.

They must be fixed in that order **reversed** — 2 before 1. Fixing 1 against a
counter that never comes down would mean an op that has ever had rework can
never complete, so the JC never closes and the SO line never closes.

## ADR-112: Outstanding rework is derived from the NC, not from a counter

**Date:** 2026-08-10
**Status:** Accepted
**Closes:** ADR-111 §Open item 2. Item 1 (an op reads `complete` while owing
rework) remains open and is the next change.

### Context

`nc-register/cascades.ts:130` adds an NC's rejected qty to
`jc_ops.rework_qty` when the disposition is `rework`. Nothing ever subtracts
it: `closeNcReworkCascade` (`:369-409`) records `nc_register.rework_done_qty`
and flips the NC to `closed`, but leaves the counter alone.

So on IN-JC-26-00085, once the 5 pins are re-cut and logged at Op1:

```
available = GREATEST(0, 50 − 55) + 5 = 5      -- forever
```

A permanent 5 pieces of phantom work on a finished operation — and since
ADR-111 that phantom is printed in the Pending column too. The ♻ marker had
the same defect: it showed the running total ever raised, so it stayed lit
after the rework was done.

### Decision

`v_jc_op_status` sums the outstanding qty **live from `nc_register`** and uses
that everywhere it previously used `jc_ops.rework_qty` (migration 0088):

```sql
rework_outstanding AS (
  SELECT nc.job_card_id, nc.rework_op_seq,
         GREATEST(0, SUM(nc.rejected_qty - COALESCE(nc.rework_done_qty, 0))) AS qty
  FROM public.nc_register nc
  WHERE nc.disposition = 'rework' AND nc.status <> 'closed'
    AND nc.rework_op_seq IS NOT NULL AND nc.deleted_at IS NULL
  GROUP BY nc.job_card_id, nc.rework_op_seq
)
```

joined on `(job_card_id, op_seq = rework_op_seq)` — the op the NC sent the work
back to, which is not necessarily the op that rejected it. A new
`rework_pending_qty` column carries it to the UI for the ♻ marker.

`jc_ops.rework_qty` is left in place and still written by the dispose cascade.
It is now **audit trail only** — what was ever raised against the op.

**The rule this creates:** rework stays outstanding until the NC is closed.
NC Register → the NC → **Close Rework** is what clears it. Closing without
entering a done-qty still clears it in full (the row leaves the
`status <> 'closed'` set), so the qty field stays optional as it is today.

### Alternatives Considered

- **Decrement `jc_ops.rework_qty` inside `closeNcReworkCascade`** — rejected.
  Two writers, one number: the counter would still be wrong for every NC closed
  before the fix, needing a backfill, and any future path that closes an NC
  without going through that one function silently re-breaks it. Deriving needs
  no backfill and cannot drift.
- **Track outstanding rework on a new column of `jc_ops`** — rejected for the
  same reason plus a migration to maintain. The NC rows already carry every
  fact required.
- **Count only `rework_done_qty` and ignore NC status** — rejected. The field
  is optional today, so a closed NC with no qty entered would leave its rework
  outstanding forever. Status is the reliable signal; the qty refines it.

### Consequences

- Positive: a reworked op can finish. Close the NC and `available`,
  `pending_qty` and ♻ all return to their pre-NC values.
- Positive: **it tightens the write path too.** `submitOpLog` validates against
  `available` (`op-entry/service.ts:445`), read from this view — so the extra
  allowance to re-log rework pieces now disappears when the NC closes, instead
  of persisting indefinitely.
- Negative: closing the NC becomes load-bearing. An NC dispositioned `rework`
  and never closed keeps its op showing pending work forever — arguably correct
  (the pieces really are owed), but it will surface stale NCs nobody closed.
- Negative: `available` is now a live aggregate over `nc_register` as well as
  `op_log`. One more table in a view read on hot screens; at current row counts
  the cost is not measurable, but it is not free forever.
- Risk: none to data. `CREATE OR REPLACE VIEW` with an appended column; writes
  nothing, and `jc_ops.rework_qty` is untouched.

### Open

- **`calc-engine.ts` still adds `op.reworkQty`** (`enrichOps`, line ~128) and so
  disagrees with the view for `so-status` / `so-overview` rollups. Those use
  `available` for reporting, not for the write path, so the drift is cosmetic —
  but it is drift. Closing it means feeding NC rows into a helper whose whole
  premise is "no DB access, caller batches the reads". Commented in place.
- ADR-111 §Open item 1 is now unblocked: an op still reads `complete` while it
  owes rework, so a Job Card can auto-close and close its SO line with rework
  outstanding.
