# TASKS.md — Project Task Tracker

> Update at start AND end of every work session.
> Last updated: 2026-05-01 (T-029b done — Phase 4 storage layer live in dev Supabase. T-029c (transform layer) is next.)

## Status Legend
- [ ] Not started · [~] In progress · [x] Done · [!] Blocked · [-] Cancelled

## Current Phase
**Phase 4 — Sales Chain (Week 6–7)** — starts with T-029.
Goal: Migrate `salesOrders` + `jobWorkOrders`, build SO/JW list+detail+edit screens, implement server-side cascade (SO line auto-close from JC completion — fixes existing legacy bug), cutover sales team module-by-module.

**Phase 3 closed 2026-05-01:** op-entry chain fully shipped — 119 rows migrated, API + Web (3 views: JC-wise, machine-first, live board), Realtime + optimistic updates, server-side validations, daily reconciliation script ready. T-025c manual smoke + T-027 5-day parallel run + T-028 cutover gated on user/calendar.

## Resume Checklist (next session)

> Boot order: read CLAUDE.md §0–15, then this file, then proceed with T-029b. Two parallel tracks running:
> - **Phase 3 wind-down (calendar work):** T-025c manual smoke (5–10 min, your call), then T-027 5 daily reconciliations, then T-028 cutover. None of this needs new code.
> - **Phase 4 (this session's focus):** T-029b → T-029c → T-029d → T-030.

1. **T-029b: Drizzle schema + migration (Phase 4 storage layer).** Per ADR-012 action items: 4 new tables (`sales_orders`, `sales_order_lines`, `job_work_orders`, `job_work_order_lines`), 2 new enums (`so_type`, `so_status`). Three migration files: `0007_phase4_sales_chain.sql` (drizzle-gen), `0008_phase4_jc_alters.sql` (hand-written — rename `source_jw_id`→`source_jw_line_id`, add 2 FKs, add CHECK `<= 1`), `0009_phase4_triggers.sql` (hand-written — set_updated_at on 4 new tables). Apply via `apply-sql.ts`.

2. **T-029c: Transform layer.** Two new transforms — `sales-orders.ts` (groups 9 docs by `soNo` → 2 headers + 9 lines) and `job-work-orders.ts` (groups 2 docs by `jwNo` → 2 headers + 2 lines). FK resolution via `_id_map.json` for items + clients. Tests + orchestrator wiring.

3. **T-029d: Bulk-load + validate-phase4.** Extend `migration/load.ts` with the 4 new tables in FK order: `sales_orders` → `sales_order_lines` → `job_work_orders` → `job_work_order_lines`. After load, **backfill `job_cards.source_so_line_id` / `source_jw_line_id`** by reading each JC's `source_legacy_ref` JSON and looking up the new UUID. New `validate-phase4.ts` covers field-level diffs + orphan FK checks + JC backfill verification.

4. **Then T-030–T-033** (sales API + web + auto-close cascade).

## Active Task
**ID:** T-029c
**Title:** Phase 4 — Transform layer (sales-orders + job-work-orders)
**Status:** [ ] Not started
**Scope:** Per the existing Phase 3 transform pattern (`migration/transforms/*.ts` + `_id_map.json` + LookupRegistry).
- `migration/transforms/sales-orders.ts` — group 9 source docs by `soNo` → 2 header rows + 9 line rows. Returns `[salesOrdersResult, salesOrderLinesResult]` (multi-output like `route-cards.ts` did). FK-resolve `clientId` via `byCode.clients` lookup (fallback to `customer_name` text); FK-resolve `itemCode` via `byCode.items` (fallback to `item_code_text`).
- `migration/transforms/job-work-orders.ts` — same pattern; group 2 docs by `jwNo` → 2 header rows + 2 line rows. Both lines reference items not in master (`ITM-003`, `ITM-001`) — load with `item_id=null` + text fallback per ADR-012 #10.
- Wire into `transform.ts` orchestrator in FK-dependency order after Phase 3.
- Tests for each transform.

**Acceptance:**
- [ ] Two new transform files + tests
- [ ] Real-data run produces 4 JSON outputs: `sales_orders.json` (2), `sales_order_lines.json` (9), `job_work_orders.json` (2), `job_work_order_lines.json` (2)
- [ ] Anomalies captured for unresolved itemCodes (expect ~2 in JW lines)
- [ ] Full migration test suite green

## Phase 3 Sub-tasks (T-024 closed)
- **T-024a — Schema design** [x] Done 2026-05-01 — `docs/SCHEMA.md` §"Phase 3 Tables" + ADR-011 approved
- **T-024b — Drizzle schema + migration** [x] Done 2026-05-01 — 7 tables + 6 enums + 2 views + 5 BEFORE UPDATE triggers live in dev Supabase. 57/57 api tests pass; views return 0 rows with sane EXPLAIN plans
- **T-024c — Transform layer** [x] Done 2026-05-01 — 5 transforms + 33 new unit tests (71/71 migration suite green); real-data run produces 13 tables × 490 total rows × 72 anomalies. ITM-001 cascade finding surfaced (option (a) accept-the-loss accepted by user)
- **T-024d — Bulk-load + validation** [x] Done 2026-05-01 — 119 rows loaded; `validate-phase3.ts` PASS: 0 field diffs across 119 rows, 0 orphan FKs across 25 checks, both views return sensible computed_status. MIGRATION-LOG sign-off appended

## Phase 3 carry-over notes (open questions to resolve in T-024a schema design)

- **`routeCards` (legacy collection, 14 records exported)** is in the Phase 1 export but NOT in CLAUDE.md §13 glossary or `docs/SCHEMA.md` Module map. Decide in T-024a: separate `route_cards` master table (linked to items via item-id) OR denormalised onto `job_cards` as a snapshot at JC-creation time. Quote the legacy HTML usage (`legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`) before deciding. Record decision as an ADR.
- **Status enums must reflect ALL legacy values, not just exhibited ones.** Source data is small (3 + 20 + 81 = 104 rows) — easy to design a schema that fits the export but breaks on a status the data didn't happen to hit. Read the legacy HTML's status-handling JS for `jobCards`, `jcOps`, `opLog` and capture every literal status string before locking the enum.
- **Quantity columns:** `jc_ops` and `op_log` need planned-vs-actual qty modelling. The "cannot exceed planned qty" / "cannot skip required QC" validations from T-026 hinge on this. Pin column names + types in T-024a; don't punt.
- **`runningOps` (legacy collection, 2 records exported)** likely materialises live op-entry state. Decide in T-024a: is this a derived view over `op_log` OR a real table? Probably a view if we're doing optimistic updates via TanStack Query.
- **Realtime selectivity** (ADR-004): `op_log` IS one of the four hot screens, so the table needs to support filtered Postgres Realtime subs. Confirm column shape supports the planned filter (most likely `(company_id, jc_op_id)` row filter).

## Phase 2 carry-over notes (from Phase 1 sign-off)
- **CORS currently permissive** (`origin: true, credentials: true` in `apps/api/src/server.ts`). Acceptable while web is local-only; **tighten to a specific allowlist before Cloudflare Pages web deploy** is wired.
- **CI tests reuse dev Supabase secrets.** Tests prefix-isolate (`T009R-`) and clean up after themselves so this is safe at current scale, but **provision a separate CI/staging Supabase project before Phase 4** (sales chain) — test data volume + concurrency will grow.
- ~~Smoke session behaviour to confirm in Phase 2 — viewer write response shape.~~ **Resolved 2026-05-01.** Code analysis confirmed the leak (every service had only `requireCompany`, no role check; RLS would block but the error handler fall-through returns generic 500). Fixed via `apps/api/src/lib/auth.ts:requireWriteRole` called at top of every `create`/`update`/`softDelete` across all 5 master modules. Regression test in `items/routes.test.ts` asserts viewer → 403 `{error: "forbidden"}`. Full api suite green at 57/57.
- **`pnpm format` not yet run workspace-wide** (T-010c). Re-enable `format:check` in `ci.yml` once formatting is normalised.

## Phase 0 Backlog (Bootstrap)
| ID | Task | Status |
|---|---|---|
| T-001 | Initialize repository structure | [x] Done (2026-04-29) |

## Phase 1 Backlog
| ID | Task | Status |
|---|---|---|
| T-010c | Run `pnpm format` workspace-wide and re-enable `format:check` in CI (currently dropped from `ci.yml` because 26 files fail) | [ ] |
| T-002 | Provision Supabase project (dev only — Mumbai `ap-south-1`, Pro tier, pooler `aws-1-ap-south-1`, pg 17.6, connection verified) | [x] Done (2026-04-29) |
| T-003 | Design Phase 1 schema in `docs/SCHEMA.md` (companies, users, items + RLS helpers) | [x] Done (2026-04-29) |
| T-004 | Build Drizzle schema definitions in `apps/api/src/db/schema.ts` (mirror SCHEMA.md) | [x] Done (2026-04-30) |
| T-005 | Configure Drizzle migrations + seeding (drizzle-kit); applied to dev | [x] Done (2026-04-30) |
| T-006 | Bootstrap Fastify API (server, auth plugin, error handler, Pino logger) | [x] Done (2026-04-30) |
| T-007 | Bootstrap React app (Vite, Tailwind, shadcn/ui, TanStack Query, TanStack Router) | [x] Done (2026-04-30) |
| T-008 | Implement auth flow end-to-end (login, JWT, protected routes, RLS session claims) | [x] Done (2026-04-30) |
| T-009 | Build Items master module — API (routes, service, schema, tests) | [x] Done (2026-04-30) |
| T-010 | Build Items master module — Web (api hooks, list/detail/create/edit) | [x] Done (2026-04-30) |
| T-010b | Migrate ESLint config to v9 flat format (project-wide; precondition for T-011) | [x] Done (2026-04-30) |
| T-011 | CI/CD: GitHub Actions (typecheck, lint, gated test) + Railway auto-deploy on push-to-`main` | [x] Done (2026-04-30) |
| T-012 | Phase 1 sign-off: Items master fully working with RLS verified across roles | [x] Done (2026-04-30) |

## Phase 2 Backlog — Master Data Migration (Week 3)
| ID | Task | Status |
|---|---|---|
| T-013 | Build one-time Firestore export script (`migration/export-firestore.ts`) | [x] Done (2026-04-30) |
| T-014 | Build transformation script (JSON-blob → per-record rows, UUID + UID mapping) | [x] Done (2026-04-30) — all 6 master-data transforms wired + Phase 2 schemas |
| T-015 | Build bulk-load script in FK dependency order (`migration/load.ts`) | [x] Done (2026-04-30) — 371 rows loaded; users via Supabase Auth invite |
| T-016 | Migrate `users` (Firebase Auth UIDs → Supabase users) | [x] Done (2026-04-30) — seed admin reused; japan@ invited via Supabase Admin API |
| T-017 | Migrate `clients` master | [x] Done (2026-04-30) — 1/1 record |
| T-018 | Migrate `vendors` master | [x] Done (2026-04-30) — 3/3 records |
| T-019 | Migrate `items` master | [x] Done (2026-04-30) — 352/352 records, 8 uom_normalised anomalies |
| T-020 | Migrate `machines` master | [x] Done (2026-04-30) — 12/12 records |
| T-021 | Migrate `operators` master | [x] Done (2026-04-30) — 1/1 record |
| T-022 | Build admin screens for each master entity (web) | [x] Done (2026-05-01) — all 4 entities (clients/vendors/machines/operators) shipped + home nav |
| T-023 | Validation pass: row counts match, sample records identical, no orphaned FKs | [x] Done (2026-05-01) — `validate-phase2.ts`: 369/369 field-level matches, 14/14 orphan checks clean, users delta as expected. Sign-off in MIGRATION-LOG |

## Phase 3 Backlog — Op Entry (Week 4–5, Critical)
| ID | Task | Status |
|---|---|---|
| T-024a | Phase 3 schema design (SCHEMA.md + ADR-011) | [x] Done (2026-05-01) |
| T-024b | Phase 3 Drizzle schema + migration to dev Supabase | [x] Done (2026-05-01) |
| T-024c | Phase 3 transform layer (job-cards, jc-ops, op-log, route-cards, running-ops) | [x] Done (2026-05-01) |
| T-024d | Phase 3 bulk-load + validation (`validate-phase3.ts`) | [x] Done (2026-05-01) |
| T-025a | Op Entry API module (routes/service/schema + tests) | [x] Done (2026-05-01) |
| T-025b | Op Entry Web — JC-wise + Live ops board (TanStack Query + Realtime + optimistic) | [x] Done (2026-05-01) |
| T-025b' | Machine Op Entry view (machine-first picker, mirrors legacy renderMachOpEntry) | [x] Done (2026-05-01) |
| T-025c | Manual browser smoke (admin happy path + viewer 403 + Realtime visible) | [ ] Gated on user |
| T-026 | Server-side validations — operator-required-on-Start + qc_call_date auto-set | [x] Done (2026-05-01) |
| T-027 | Phase 3 parallel run — reconciliation script + 5-day clean window | [~] Tooling ready, daily runs pending |
| T-025 | Build Op Entry screen (TanStack Query optimistic updates + Realtime subscription) | [ ] |
| T-026 | Implement server-side validations (cannot exceed planned qty, cannot skip required QC, etc.) | [ ] |
| T-027 | Run parallel mode (operators in BOTH systems, end-of-day reconciliation, 5 working days) | [ ] |
| T-028 | Cutover operators to new system only | [ ] |

## Phase 4 Backlog — Sales Chain (Week 6–7)
| ID | Task | Status |
|---|---|---|
| T-029a | Phase 4 schema design (SCHEMA.md + ADR-012) | [x] Done (2026-05-01) |
| T-029b | Phase 4 Drizzle schema + migrations to dev Supabase | [x] Done (2026-05-01) |
| T-029c | Phase 4 transform layer (sales-orders, job-work-orders; header+lines split) | [ ] Active |
| T-029d | Phase 4 bulk-load + JC source FK backfill + validate-phase4 | [ ] |
| T-030 | Build SO list / detail / create / edit screens | [ ] |
| T-031 | Build JW list / detail screens | [ ] |
| T-032 | Build JC list with filtering (status, machine, operator) | [ ] |
| T-033 | Implement server-side cascade (SO line auto-close from JC completion — fixes existing legacy bug) | [ ] |
| T-034 | Cutover sales team module-by-module | [ ] |

## Phase 5 Backlog — Procurement (Week 8)
| ID | Task | Status |
|---|---|---|
| T-035 | Migrate `purchase_orders`, `po_lines`, `grn`, `grn_lines`, `store_transactions` | [ ] |
| T-036 | Build PO / GRN screens (vendor cascade, line-item matching) | [ ] |
| T-037 | Cutover procurement team | [ ] |

## Phase 6 Backlog — Quality + Dispatch (Week 9)
| ID | Task | Status |
|---|---|---|
| T-038 | Migrate `qc_inspections` (consolidated from qcProcesses / qcAssignments / qcDocUploads) | [ ] |
| T-039 | Migrate `nc_register`, `dispatch_log`, `delivery_challans` | [ ] |
| T-040 | Build QC inspection workflow (file uploads to Supabase Storage) | [ ] |
| T-041 | Cutover QC and dispatch teams | [ ] |

## Phase 7 Backlog — Reports & Dashboards (Week 10)
| ID | Task | Status |
|---|---|---|
| T-042 | Convert in-memory aggregations to SQL views / materialized views | [ ] |
| T-043 | Build dashboard with role-based KPI cards | [ ] |
| T-044 | Build top 5–10 most-used reports | [ ] |
| T-045 | Add Excel export endpoint (exceljs) | [ ] |

## Phase 8 Backlog — Peripheral Modules (Week 11)
| ID | Task | Status |
|---|---|---|
| T-046 | Design tracker (consolidate 7 collections → 4 tables) | [ ] |
| T-047 | CRM: leads, communications, reminders | [ ] |
| T-048 | Tool issues, store issues, party materials, party GRN | [ ] |
| T-049 | CAPA records | [ ] |
| T-050 | Print template editor + revisions | [ ] |
| T-051 | Activity log viewer + admin trash recovery | [ ] |

## Phase 9 Backlog — Final Cutover (Week 12)
| ID | Task | Status |
|---|---|---|
| T-052 | Final delta migration from Firebase (capture last week's data) | [ ] |
| T-053 | Make HTML system read-only, then archive offline | [ ] |
| T-054 | Set up monitoring (Better Stack uptime, Supabase metrics, Sentry) | [ ] |
| T-055 | Verify backups: restore `pg_dump` to test instance, boot app against it | [ ] |
| T-056 | Document runbook for common operational issues (`docs/RUNBOOK.md`) | [ ] |
| T-057 | Train all users on the new system | [ ] |
| T-058 | First Monday restore drill (recurring monthly) | [ ] |

## Blockers
| ID | Task | Blocker | Needs |
|---|---|---|---|
| Future | Staging + prod Supabase | Defer | Provision when Phase 4 (sales chain) is in flight |

## Recently Completed (last 10)
| Date | ID | Task |
|---|---|---|
| 2026-05-01 | T-029b | **Phase 4 storage layer live in dev Supabase.** 2 new shared enums (`SO_TYPES`, `SO_STATUSES`); 4 new Drizzle tables in `apps/api/src/db/schema.ts` matching SCHEMA.md exactly. Three migration files: `0007_phase4_sales_chain.sql` (drizzle-gen — tables, enums, FKs, indexes, RLS), `0008_phase4_jc_alters.sql` (hand-written — column rename + 2 FKs ON DELETE SET NULL + CHECK), `0009_phase4_triggers.sql` (hand-written — 4 BEFORE UPDATE triggers). Drizzle schema also updated to include the 2 new FKs and the CHECK constraint (so `drizzle-kit generate` reports no drift). Snapshot patched to match Drizzle's FK naming convention; one-shot DB ALTER renamed live FKs to match. **All 73 api tests still green** after the schema change. T-029c (transform layer) is next |
| 2026-05-01 | T-029a | **Phase 4 sales-chain schema design approved (ADR-012).** `docs/SCHEMA.md` §"Phase 4 Tables — Sales Chain" added: 4 new tables (`sales_orders`, `sales_order_lines`, `job_work_orders`, `job_work_order_lines`) + 2 enums (`so_type`, `so_status` — the latter shared between SO and JW since semantics are identical) + ALTER on `job_cards` (rename `source_jw_id`→`source_jw_line_id`, add FKs, add CHECK `<= 1`). 11 explicit decisions surfaced for sign-off; all approved. Most consequential: header+lines split for both SO and JW (symmetry with JC source link); `source_legacy_ref` kept one phase as audit trail; CHECK relaxed to `<= 1` from ADR-011's `= 1` to allow source-less JCs going forward; BOM/milestones deferred; customer_name + item_code_text fallbacks mean no row drops on master-data gaps (unlike Phase 3's ITM-001 cascade). ADR-012 captured in DECISIONS.md (existing pending placeholders renumbered to ADR-013/014). T-029b (Drizzle + migration) is next |
| 2026-05-01 | T-027 (tooling) | **Reconciliation script for Phase 3 parallel run.** New `migration/reconcile-op-log.ts` compares legacy `opLog` (re-exported daily from Firestore) vs new `op_log` table for a given date (default = today IST). Match key `(jcNo, opSeq, log_date)`; sums production qty per group, excluding `'start'` and `'qc'` types on legacy and filtering to `log_type='complete'` on new — mirrors the legacy line 2595 "today's completed qty" filter. Per-key categorisation: MATCH / QTY_MISMATCH / LEGACY_ONLY / NEW_ONLY. Output to `migration/load-output/_reconcile_<date>.json` (gitignored) plus stdout summary. Exit 0 on PASS, 1 on FAIL — usable from cron. New `pnpm --filter @innovic/migration reconcile` script. Smoke-run on historic 2026-03-07 correctly flagged the 3 ITM-001 cascade divergences (15 pcs of legacy-only work that we already accepted as lost in T-024c) |
| 2026-05-01 | T-026 | **Op Entry server-side validations — gap closure beyond T-025a.** (1) `startOpInputSchema` Zod refine now requires `operatorId` OR `operatorName` (mirrors legacy line 5497 hard-block on "Select or enter operator name"). (2) `submitOpLog` post-insert: when an op transitions to `available=0` (fully done), the next op (op_seq+1) on the same JC, if it's a QC op without a `qc_call_date`, gets it set to the log_date — matches legacy line 5471-5479 ("operators rely on this to know which QC ops are now ready to inspect"). All other CLAUDE.md §1 validations were already implicit via `v_jc_op_status` (sequencing — input_avail of op N+1 = output of op N; cannot-skip-QC — qcRequired ops gate output via getOutput legacy line 1647-1651). 2 new tests; full api suite **73/73 green ×3 stability runs**. Test fixture teardown made more defensive (sweep all jc_ops on test JC, not just the seed op). Deferred to later phases: rework decrement (Phase 6 NC), stock update on last op (Phase 5 procurement), OSP auto-PR (Phase 5) |
| 2026-05-01 | T-025b' | **Machine Op Entry view added** (legacy `renderMachOpEntry` line 5540–5666 mirror). New `/op-entry/machines` route with grid of machine cards (running shows JC + op, idle shows pending-jobs table with Start buttons). Required extending `listJcOpsEnriched` API to accept `machineId` filter — schema + service + service test added; Zod refine enforces "provide jobCardId, jobCardCode, OR machineId". Pending ops filtered client-side to `available + waiting` (legacy line 5625-5627 subset). Home nav now lists three op-entry entry points: JC-wise / machine-first / live board. Web typecheck + lint clean; api 71/71 green |
| 2026-05-01 | T-025b | **Op Entry Web shipped — TanStack Query + Supabase Realtime + optimistic updates.** New `apps/web/src/modules/op-entry/`: api.ts (6 hooks + 2 Realtime helpers `useRealtimeOpLog`/`useRealtimeRunningOps`), 5 components (status badges, jc-ops table, op-entry form, op-log history, running-ops board), 2 routes (`/op-entry` JC-wise picker + `/op-entry/running` live board). Optimistic update on `useSubmitOpLog` decrements `available` and bumps `completedQty` in the cached jc_ops list before the server round-trip; rollback via snapshot on error; Realtime INSERT on op_log invalidates to reconcile. Realtime channels filter by `jc_op_id` (per-op view) and rely on RLS for company isolation (running_ops board). Home nav extended with op-entry + live-board cards. Web typecheck + lint clean. **Manual browser smoke pending user (T-025c)** — happy path + viewer 403 + Realtime propagation; runs in 5–10 min, blocks T-026 |
| 2026-05-01 | T-025a | **Op Entry API module shipped.** New `apps/api/src/modules/op-entry/`: routes (`GET /op-entry/{jc-ops,op-log,running-ops}`, `POST /op-entry/{op-log,start}`, `POST /op-entry/running-ops/:id/stop`), service uses raw SQL through `tx.execute(sql\`\`)` to query `v_jc_op_status` view (calcEngine mirror) for status + availability — service NEVER recomputes status, always reads from view per ADR-011 #2. Cannot-exceed-planned-qty + cannot-skip-required-QC validations land in `submitOpLog`. `requireOpEntryRole` (operator/manager/admin) added to `lib/auth.ts` alongside the existing `requireWriteRole`. Running-ops uniqueness errors caught via Postgres SQLSTATE 23505 → typed `ConflictError`. Shared schemas in `packages/shared/src/schemas/op-entry.ts` (12-value `ComputedJcOpStatus` enum + read/write/query schemas). 13 new op-entry tests (9 service + 4 routes); full api suite **70/70 green** |
| 2026-05-01 | T-024d | **Phase 3 sign-off — op-entry chain loaded + validated.** `migration/load.ts` extended with per-table conflict targets (`(company_id, code)` for masters/job_cards/route_cards; `(route_card_id, op_seq)` for child ops; `(id)` for op_log/running_ops) + audit shapes (`full` vs `created_only` for immutable tables). Generic bulk-loader refactored — Phase 2 behaviour preserved. New `migration/validate-phase3.ts` (read-only): 7-table field-level diff with jsonb canonical-JSON compare + HH:MM↔HH:MM:SS time normalisation + 25 orphan FK checks + view sanity. **Result:** 119 rows in dev Supabase; 0 field diffs; 0 orphan FKs; v_jc_op_status returns 15 rows with `waiting:5, available:2, running:1, qc_pending:2, complete:4, at_vendor:1`; v_jc_status returns 2 rows (open:1, qc_pending:1) — confirms calcEngine mirror works on real data. MIGRATION-LOG sign-off appended; postgres-js jsonb caveat (use `JSON.stringify` not raw array) noted in load.ts |
| 2026-05-01 | T-024c | **Phase 3 transform layer shipped.** 5 new transforms in `migration/transforms/`: `route-cards.ts` (returns 3 results — cards + ops + revisions), `job-cards.ts`, `jc-ops.ts`, `op-log.ts`, `running-ops.ts`. New `LookupRegistry` in `transforms/types.ts` carries code → uuid maps incrementally; orchestrator updates it after each transform and pre-loads from disk for `--only` runs. `transforms/lookups.ts` provides the disk-fallback helpers. 33 new unit tests (71/71 total migration suite green). Real-data run produces 119 valid rows + 72 anomalies. **Surfaced data-integrity finding:** `ITM-001` referenced by IN-RC-00012 + IN-JC-00001 doesn't exist in production items master (only in legacy HTML seed). Cascade drops 69 rows total. User decision required before T-024d — see Resume Checklist for options (a)/(b)/(c) |
| 2026-05-01 | T-024b | **Phase 3 storage layer live in dev Supabase.** 6 new shared enums (`OP_TYPES`, `OP_LOG_TYPES`, `OUTSOURCE_STATUSES`, `RUNNING_OP_STATUSES`, `SHIFTS`, `JC_PRIORITIES`); 7 new Drizzle tables in `apps/api/src/db/schema.ts` matching SCHEMA.md exactly. Three migration files: `0004_phase3_op_entry.sql` (drizzle-gen — tables, enums, FKs, indexes, RLS), `0005_phase3_triggers.sql` (hand-written — 5 BEFORE UPDATE triggers), `0006_phase3_views.sql` (hand-written — `v_jc_op_status` + `v_jc_status` mirroring legacy `calcEngine()` line 1626-1731). RLS policies tightened during review: `op_log_operator_insert` now requires `current_user_role() = 'operator'` (was missing the role check); added `op_log_manager_insert`; `running_ops_operator_write` now restricts to operator role. Generic `apps/api/src/db/apply-sql.ts` runner added for hand-written migrations going forward (statement-breakpoint split, idempotent). EXPLAIN plans on both views use indexed scans. Full api suite 57/57 green; typecheck + lint clean. T-024c (transform layer) is next |
| 2026-05-01 | hardening | **Phase 2 viewer-write carry-over closed.** New `apps/api/src/lib/auth.ts:requireWriteRole` (admin/manager only) now called at top of `create`/`update`/`softDelete` across all 5 master modules (items, clients, vendors, machines, operators) — 15 call sites. Regression test in `items/routes.test.ts` asserts a viewer-role write returns clean 403 `{error: "forbidden"}` instead of leaked 500. Full api suite 57/57 green; typecheck + lint clean. Browser smoke no longer needed |
| 2026-05-01 | T-024a | **Phase 3 schema design approved (ADR-011).** `docs/SCHEMA.md` §"Phase 3 Tables — Op Entry Chain" added (lines 359–614): 7 tables (`route_cards`, `route_card_ops`, `route_card_revisions`, `job_cards`, `jc_ops`, `op_log`, `running_ops`), 6 enums, 2 SQL views (`v_jc_op_status`, `v_jc_status` mirroring legacy `calcEngine()` line 1626–1731). 11 explicit decisions surfaced for sign-off. Five most consequential: route_cards as separate master, statuses derived via views (not stored), running_ops as real table with partial unique indexes for "one op per machine" + "one running per op", op_log append-only with `(start|complete|qc)` enum, SO/JW link on job_cards via two nullable FKs deferred to Phase 4. ADR-011 captured in DECISIONS.md (existing pending placeholders renumbered to ADR-012/013). T-024b (Drizzle schema + migration) is next |
| 2026-05-01 | T-023 | **Phase 2 sign-off.** New `migration/validate-phase2.ts` (read-only): per-table field-level diff between transform output and DB rows, plus 14 orphan-FK checks. Result: **369/369 mapped rows** match transform on every column (items 352, clients 1, vendors 3, machines 12, operators 1); users count matches `transformRowCount + 1` (T-012 smoke leftover, expected); 0 orphan FKs across `created_by` / `updated_by` for all 5 master tables + `operators.user_id` + users audit + `users.company_id`. Output `migration/load-output/_phase2_validation.json` (gitignored). Reproducible via `pnpm --filter @innovic/migration validate:phase2`. Sign-off section appended to MIGRATION-LOG; T-024 (Phase 3 op-entry migration) is next |
| 2026-05-01 | T-022 (operators + close) | **T-022 closed.** Operators admin module shipped per CLAUDE.md §8: shared Zod schemas (department + skills text, isActive boolean, optional userId FK to users); api module (5 endpoints, 7 service + 4 routes tests, 11/11 against dev Supabase); web module (OperatorForm with Active/Inactive select + skills + linked-user inputs, list with code/name/dept/skills/status columns + active filter, detail card). Home nav (`apps/web/src/routes/index.tsx`) refactored to a typed `MASTER_LINKS` array — Items + Clients + Vendors + Machines + Operators all surfaced. Full api suite 56/56 green; workspace typecheck/lint clean. UI matches legacy `operatorForm` (lines 13726-43): Operator ID, Name, Department, Status, Skills/Machines, with `userId` added forward per SCHEMA.md |
| 2026-04-30 | T-022 (machines) | Machines admin module shipped per CLAUDE.md §8: shared Zod schemas (machineType, capacityPerShift int, shiftsPerDay int default 1, status text); api module (5 endpoints, 7 service tests + 4 routes tests); web module (MachineForm with status select Idle/Running/Down/Maintenance, list with type/cap/shifts/status columns + status filter, detail card). Workspace typecheck/lint clean |
| 2026-04-30 | T-022 (vendors) | Vendors admin module shipped per CLAUDE.md §8: shared Zod schemas (adds materialsSupplied + rating); api module (5 endpoints, 7 service tests + 4 routes tests, 11/11 against dev Supabase); web module (TanStack Query hooks, VendorForm with materials textarea + rating field, list with rating column, detail with materials section). Workspace typecheck/lint clean; 34/34 api tests pass total |
| 2026-04-30 | T-022 (clients) | Clients admin module shipped per CLAUDE.md §8: shared Zod schemas; api module (routes/service/schema + 4 routes tests + 7 service tests, 11/11 pass against dev Supabase); web module (TanStack Query hooks, ClientForm with create/edit modes, list with search/status filter + pagination, detail with delete-confirm, edit + new routes); registered in router. Workspace typecheck + lint clean. Vendors/machines/operators follow same pattern in subsequent commits |
| 2026-04-30 | T-015 + T-016/T-017/T-018/T-019/T-020/T-021 | **Phase 2 master-data MIGRATED.** Built `migration/load.ts` (orchestrator) + `load/{users-loader,bulk-loader,validate}.ts`. Two-phase users: seed admin reused (`mmtdefvc`→`e9c9ed51...`), `japan@innovictechnology.com` invited via Supabase Admin API (option B per user, real email sent → `63bb07e7...`). Bulk-loaded 5 master tables in batches of 100 with `on conflict (company_id, code) do nothing`: clients 1/1, vendors 3/3, items 352/352, machines 12/12, operators 1/1. Total: **371 rows in dev Supabase**. Per-collection entries appended to MIGRATION-LOG. Users validation diff = +1 (the `viewer@innovic.test` user from T-012 smoke is still in DB; not a load issue). Active task: T-022 (admin screens) |
| 2026-04-30 | T-014 | Phase 2 storage layer + transforms complete. Drizzle schemas for clients/vendors/machines/operators added; migration `0002_tricky_fallen_one.sql` (auto-gen) + `0003_phase2_triggers.sql` (hand-written triggers) applied to dev Supabase. All 6 master-data transforms wired in `migration/transforms/<name>.ts`; 38/38 vitest pass; full real-data run produces 371 rows total (users 2 + clients 1 + vendors 3 + items 352 + machines 12 + operators 1) with 8 anomalies (all `uom_normalised` on items). SCHEMA.md / MIGRATION-LOG.md updated. T-014 (partial) entry below superseded |
| 2026-04-30 | T-014 (partial) | Transform infrastructure + users/items shipped. `migration/transform.ts` orchestrator, per-collection functions in `migration/transforms/<name>.ts`, deterministic UUIDv5 (`uuid-namespace.ts`). 18/18 vitest pass; real-data run produces users 2/2 + items 352/352 = 354 rows in `migration/transform/`, 8 anomalies (all `uom_normalised`: 6 `Nos`→`NOS`, 2 `Set`→`SET`). Stubs throw with TASKS pointer for clients/vendors/machines/operators (need schema first per CLAUDE.md §8) |
| 2026-04-30 | T-013 | Firestore export: `migration/export-firestore.ts` (firebase-admin, 235 lines) — full run dumped 550 records across 65 collections (27 active, 38 `doc_missing` for unused legacy features); 2 singletons (`_settings` exists, `companies/innovic` absent). 38 s, 1.2 MB on disk. Per-run details in `docs/MIGRATION-LOG.md` § "Run 1". Corrected docs from "67 collections" → 65 (legacy HTML count). DLP note added to `migration/README.md` (pnpm/dotenv-cli silent-exits in non-interactive shells; direct `node --import tsx` bypasses) |
| 2026-04-30 | T-012 | **PHASE 1 SIGN-OFF.** Manual smoke on Railway production URL with web pointing at Railway API: admin happy path (login → create → edit → soft-delete → re-list) all 200; non-admin (`viewer`) confirmed blocked from writes by RLS; cross-browser clean (Chrome + Firefox). CI Test job confirmed running all 12 api integration tests against dev Supabase via `CI_*` secrets (CI #21 green). Phase 2 carry-over notes captured in §"Phase 2 carry-over notes" |
| 2026-04-30 | T-011 | CI/CD live: `.github/workflows/ci.yml` with two-job split (lint-typecheck always, test gated on `CI_*` secrets); CI #17 green on `main` in 1 min. Railway service deployed to `asia-southeast1`, env vars set, `/health` 200, GitHub repo connected for push-to-`main` auto-deploy (ADR-010). Stale `deploy.yml` removed. RUNBOOK §"Deploy — API (Railway)" added with logs/rollback/health/env procedures |
| 2026-04-30 | dev-env | DLP-friendly api `dev` script: split `dev` (plain `tsx`, DLP-safe) and `dev:watch` (`tsx watch`, blocked here). Confirmed end-to-end browser flow: login → `/me` 200 → `/items` 200 → items page renders. RUNBOOK §"Local Dev — Starting the API and Web" added; memory note updated to mark workaround durable |
| 2026-04-30 | T-010b | ESLint v9 flat-config migration: replaced `.eslintrc.cjs` with `eslint.config.mjs` (uses `tseslint.config()` helper); added `@eslint/js@^9` and `typescript-eslint@^8` devDeps; dropped removed `--ext` flag from per-package `lint` scripts; carved out `no-console` for operational CLI paths (`**/db/seed.ts`, `**/scripts/**`, `migration/**`) per the script-vs-runtime split — CLAUDE.md §6.7 still binds runtime code. Workspace-wide `pnpm lint` and `pnpm typecheck` both clean |
| 2026-04-30 | T-010 | Items master Web: TanStack Query hooks (`useItemsList/useItem/useCreateItem/useUpdateItem/useSoftDeleteItem`); list (TanStack Table + debounced search + type filter + URL-state pagination), detail (Card + delete-confirm), edit + new routes (react-hook-form + Zod from `@innovic/shared`); shadcn primitives added (card/label/select/textarea/table); routes registered under `_authenticated`; web typecheck clean. Lint blocked project-wide by pre-existing ESLint v9 config gap → tracked as T-010b. Manual smoke gated on user (dev API needs to be up; tsx watch dies under Seclore/eScan on this box) |
| 2026-04-30 | T-009 | Items master API per CLAUDE.md §8: shared Zod schemas; `withUserContext` for RLS claim injection; service (list/get/create/update/softDelete) + routes (5 endpoints); 12 tests pass (8 service, 4 routes) against dev Supabase |
| 2026-04-30 | T-008 | Auth E2E: API `/me`, login route (magic-link + password), `/auth/callback`, pathless `_authenticated` parent route as guard, `useSession` hook, sign out via `router.invalidate()` on `SIGNED_OUT`. Verified end-to-end via password sign-in (magic-link blocked by free-tier email rate limit during testing) |
| 2026-04-30 | T-007 | React app: Vite + Tailwind + shadcn/ui (Button), TanStack Router (root + index) + TanStack Query, `apiClient` w/ Supabase access token, env-via-Zod. Visual check passed |
| 2026-04-30 | T-006 | Fastify 5 server: env-via-Zod, Pino, domain errors, Drizzle client (transaction pooler), auth plugin (Supabase JWT → public.users → request.user), error handler, helmet+cors+sensible, `/health`. Verified: typecheck + boot + curl |
| 2026-04-30 | T-005 | Migrations applied to dev Supabase (pg 17.6): 3 enums, 3 tables, 7 indexes, 8 FKs (4 deferrable), 6 RLS policies, 5 helper functions, 5 triggers. Seed admin created (1 company, 1 active admin); magic-link sent to `innovic.technology@gmail.com` |
| 2026-04-30 | T-004 | Drizzle schema for companies/users/items in `apps/api/src/db/schema.ts`; enums sourced from `@innovic/shared`; RLS policies via `pgPolicy`; typecheck passes |
| 2026-04-29 | T-003 | Phase 1 schema designed in `docs/SCHEMA.md`: companies, users, items + helpers (`current_company_id`, `current_user_role`, `set_updated_at`), `auth.users` triggers, RLS policies |
| 2026-04-29 | T-002 | Supabase dev provisioned (Mumbai, Pro, pooler `aws-1-ap-south-1`, pg 17.6); `.env.local` filled and connection verified |
| 2026-04-29 | T-001 | Repository bootstrap — git init, dir tree per CLAUDE.md §4, all `docs/*.md`, root tooling, workspace stubs, ADR-001..008 |

## Notes
- Spec source: `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` (27,276 lines). Quote relevant sections when implementing modules per CLAUDE.md §8.
- Migration proposal reference: `legacy/Innovic_ERP_Migration_Proposal.docx`.
- Region locked: Mumbai (`ap-south-1`). Timezone: UTC stored, IST displayed.
- Dev box note (this workstation): Seclore FileSecure DLP + eScan AV intercept PowerShell. See `docs/RUNBOOK.md`.
