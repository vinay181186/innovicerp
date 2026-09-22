# RM_AUDIT_REPORT.md — Raw-Material readiness audit of Innovic ERP

Read-only audit. No code, database or config was changed. Nothing committed.

**Audit base:** worktree `C:\Innovic_projects\innovic-erp\wt-test`, branch `test`, commit `d95a1f6e`
(audit started at `12140614`; the one commit added meanwhile touches only
`apps/web/src/modules/tasks/components/related-ref-link.tsx`, so every API/DB line number below is unchanged).
All paths are relative to that worktree root. Every line number comes from `grep -n` / `sed -n` on the file.

Why `test` and not `main`: `main` (`innovicerp/`, local HEAD `417b0b38`, `origin/main` `dcc349ba`) is 209 commits
*behind* `test` and stops at migration `0116`; `test` carries migrations `0117`–`0139` including
**Production Orders (0133)**, **item procurement type (0134)** and **idempotency keys (0135)** — all of which a
raw-material feature must build on. `apps/api/` in `wt-test` is fully committed (the 18 dirty files are web list pages
+ untracked e2e specs); `innovicerp/` has 118 dirty files from a parallel terminal.

Legend: **NOT PRESENT** = looked for, does not exist. **NOT VERIFIED** = cannot be established from the repo alone.

---

## 0. SYSTEM

### 0.1 Stack (exact, from manifests)
| Layer | What | Evidence |
|---|---|---|
| Monorepo | pnpm workspaces `apps/*`, `packages/*`, `migration`; `pnpm@10.33.2`, Node `>=24` | `package.json:6-9`, `pnpm-workspace.yaml:1-4` |
| API | Fastify `^5.1.0`, Drizzle ORM `^0.36.4`, `postgres` `^3.4.5` driver, Zod `^3.23.8`, Pino `^9.5.0`, `@supabase/supabase-js` `^2.46.1` | `apps/api/package.json:29-40` |
| Web | React `^18.3.1`, Vite `^5.4.11`, TanStack Router `^1.84.4`, TanStack Query `^5.62.0`, Zustand `^5.0.1`, react-hook-form `^7.53.2`, Tailwind `^3.4.15`, Playwright `^1.49.0` | `apps/web/package.json:22-53` |
| Shared | `packages/shared` — Zod schemas + enums consumed by both apps | `packages/shared/src/enums/*`, `packages/shared/src/schemas/*` |
| DB | Supabase Postgres (two projects: PROD + TEST, separate databases); API connects with `DATABASE_URL_POOLED` as the `postgres` superuser (RLS is therefore **bypassed** by the API — see §1m) | `apps/api/src/db/client.ts:8`, `.env.example:16-17` |
| Auth | Supabase Auth JWT validated server-side via `supabaseAdmin.auth.getUser(token)` (service-role client) | `apps/api/src/plugins/auth.ts:17-21`, `apps/api/src/lib/supabase-admin.ts:8` |
| File storage | Supabase Storage, single bucket `qc-docs` | §1s |
| API hosting | Railway, Dockerfile build, healthcheck `/health` | `railway.json:1-12` |
| Web hosting | Cloudflare Pages — PROD `innovicerp.com` on branch `main`; TEST `innovic-erp.pages.dev` on branch `test` (API `https://api-test-production-19ca.up.railway.app`) | `.github/workflows/deploy-web.yml:1,17`, `.github/workflows/deploy-web-test.yml:1,20,54` |
| CI | `ci.yml` on push/PR to `main`: Lint + Typecheck + Format check + Test (test job materialises `.env.local` from secrets) | `.github/workflows/ci.yml:5-7,16,33-39,43,80,100` |
| Backup | `backup.yml` — `pg_dump` → Backblaze B2 | `.github/workflows/backup.yml:1,32-61` |

### 0.2 Folder layout (2 levels)
```
apps/api/src/            Fastify API
  db/                    client.ts, schema.ts (Drizzle, 6162 lines), with-user-context.ts, apply-sql.ts, migrations/ (148 .sql on test)
  lib/                   access.ts, auth.ts, db-retry.ts, errors.ts, traceability.ts, production-order-close-guard.ts, production-order-link.ts …
  modules/<module>/      routes.ts + service.ts (+ schemas in packages/shared) — 100 modules
  plugins/               auth.ts, error-handler.ts, idempotency.ts
  server.ts              registers plugins + every module's routes
apps/web/src/            React app
  modules/<module>/      api.ts (TanStack Query hooks), components/, routes/ (TanStack Router route files)
  router.tsx             route tree (335 lines)
  lib/                   api.ts (fetch wrapper, adds Idempotency-Key), access-control.ts, storage.ts, supabase.ts
packages/shared/src/     enums/ (39 files), schemas/ (Zod), index.ts
docs/                    SCHEMA.md, DECISIONS.md (ADR-001…ADR-176), CONVENTIONS.md, ARCHITECTURE.md, RUNBOOK.md, TASKS.md, PENDING-TASKS.md, ISSUES.md (273 issues), sql/, page-registry.yaml
legacy/                  the legacy single-file HTML ERP (functional spec of record)
migration/               one-off Firestore→Postgres export scripts (workspace package @innovic/migration)
scripts/                 check-agents.mjs etc.
.claude/                 agents/ (only form-behaviour.md on test) + skills/ — the full agent set lives in innovicerp/.claude/agents (see §3)
```

### 0.3 Migrations — how they are written and applied
- Hand-authored raw SQL files `apps/api/src/db/migrations/NNNN_short_description.sql`; statements separated by `--> statement-breakpoint`. `drizzle-kit generate/migrate` is **explicitly abandoned** (journal out of sync, produced colliding numbers) — `apps/api/src/db/migrations/README.md:3-16`.
- Apply command (manual, per database): `pnpm --filter api exec dotenv -e <env> -- tsx src/db/apply-sql.ts src/db/migrations/00NN_x.sql` — `README.md:37-42`; `docs/RUNBOOK.md:269`. Apply to dev/TEST first, then PROD (`README.md:44-46`). **Nothing applies migrations automatically** — not CI, not Railway (`docs/RUNBOOK.md:257`).
- `apps/api/src/db/schema.ts` must be kept in sync by hand (`README.md:33-34`); `docs/SCHEMA.md` must mirror it (`docs/SCHEMA.md:3`).
- Applied-state tracking table: **NOT PRESENT** — `drizzle.__drizzle_migrations` holds ~5 rows of 148 files (`README.md:7-8`); `apply-sql.ts` records nothing (grep `schema_migrations|applied` in `apps/api/src/db/apply-sql.ts` → 0 hits). The only verification aid is `docs/sql/check-migrations.sql:1-30` (probes signature objects for 0050–0056 by hand in the Supabase SQL editor).
- Highest migration number: **`0139_task_management.sql`** on `test` (148 files + README); **`0116_machine_groups.sql`** on `main` (126 files). Files on `test` not on `main`: 0117_pr_short_close, 0118_jc_op_po_lines, 0119_so_line_revision_is_text, 0120_jw_line_drawing_and_rev, 0121_user_access_drawing_download, 0122_qc_nc_handling, 0123_route_card_plan_type, 0124_rework_child_blocks_completion, 0125_qc_op_complete_requires_accept, 0126_backfill_nc_operator, 0127_backfill_pr_item_name, 0128_osp_at_vendor_once, 0129_nc_chain_and_breakup, 0130_osp_rollups_all_po_lines, 0131_nc_closed_counts_non_rtv, 0132_final_inspection_qc_process, 0133_production_orders, 0134_item_procurement_type, 0135_idempotency_keys, 0136_item_image, 0137_plan_customer_dispatch_date, 0138_nc_closed_counts_make_fresh, 0139_task_management.
- Two Supabase projects: PROD creds in `innovicerp/.env.local` (`DATABASE_URL`, `DATABASE_URL_POOLED`, `SUPABASE_URL`, …), TEST creds in `erp/.env.local` as `TEST_DATABASE_URL`, `TEST_SUPABASE_URL`, `TEST_API_URL`, … (key names only; values not read).

### 0.4 Git
| | branch | HEAD | dirty (tracked) |
|---|---|---|---|
| `innovicerp/` | `main` | `417b0b38` (`origin/main` = `dcc349ba`, pushed 2026-09-21 23:27 by another session) | 118 files |
| `wt-test/` (this audit) | `test` | `d95a1f6e` | 18 files (all `apps/web/...` list pages + `CLAUDE.md`) + 12 untracked e2e files |
| other worktrees | `wt-main-auth` = `main-auth-v2` @ `49320912`; `wt-main-rc` detached `9bf818b3`; `wt-menu` detached `9135e767` | | |

Remote: `origin https://github.com/vinay181186/innovicerp.git` (fetch/push). `git log main..test | wc -l` = 209; `test..main` = 2 (both `chore(agents)` commits).

### 0.5 Rules a new feature must follow
From `CLAUDE.md` (wt-test copy, 963 lines) unless stated:
1. **Locked stack** — Fastify 5, Drizzle (not Prisma/TypeORM/Knex), Zod on every route input+output, Pino, Supabase Auth; React 18 + Vite + TanStack Router/Query, Zustand, RHF+Zod, Tailwind+shadcn — `CLAUDE.md:223-270`. (Note `CLAUDE.md:270` still says "Migrations: Drizzle Kit" — superseded by `migrations/README.md:3` and `docs/RUNBOOK.md:425`: hand-written SQL + `apply-sql.ts`.)
2. **Ten non-negotiables** `CLAUDE.md:272-287`: no business logic in the frontend; every write through a service; every table has `company_id, created_at, created_by, updated_at, updated_by, deleted_at` + RLS policy; timestamptz UTC / display IST; no `SELECT *`, no N+1; Pino only; **soft delete only**; schema changes via migrations only; secrets in env only.
3. **Module Creation Protocol** `CLAUDE.md:322-346`: confirm domain → check `legacy/InnovicERP_*.html` → update `docs/SCHEMA.md` (approval) → Drizzle schema → migration → Zod in `packages/shared/src/schemas/<module>.ts` → `apps/api/src/modules/<module>/{service,routes}.ts` + tests → `apps/web/src/modules/<module>/{api.ts,components/,routes/}` → update `docs/TASKS.md` → show diff, wait for approval before commit.
4. **NEW FIELD — STANDARD FLOW** `CLAUDE.md:941-953`: state need + source; reuse closest existing pattern; add only where the flow needs it; give exact files + plan and wait; verify typecheck/tests/Playwright; run `/code-review high`; report what changed / unchanged / risks.
5. **Anti-patterns** `CLAUDE.md:422-437`: no JSON arrays in a column; no auth checks in React; no cross-module imports except via the other module's service; no `any`; no magic numbers; **files over 400 lines must be split** (note: `schema.ts` 6162, `goods-receipt-notes/service.ts` 1600, `job-cards/service.ts` 2877+ lines already violate this); no hard deletes.
6. **Number inputs** — mouse-wheel must not edit; enforce in the shared number-input component — `CLAUDE.md:957-963`.
7. **Item picker rule (system-wide)** — code is the key, name auto-fills read-only from master; server `resolveItem(code)` snapshots the name — `docs/CONVENTIONS.md:54-75`.
8. **Commit format** `<type>(<scope>): <subject>` — `docs/CONVENTIONS.md:94-110`; branches `main` protected, feature `<type>/<slug>` — `:112-116`.
9. **Authorization model** — JWT → RLS → service role checks; roles `admin, manager, operator, qc, procurement, dispatch, design, viewer` — `docs/ARCHITECTURE.md:29-32`.
10. **Agent house rules** (`innovicerp/.claude/agents/_house-rules.md`, symlinked at `C:\Innovic_projects\innovic-erp\.claude\agents`): sub-agents never run git (`:18-21`); **never run `pnpm --filter @innovic/api test` — its global-setup deletes from the PRODUCTION `job_cards`** (`:22-25`); never `db:push` / `seed` (`:26-29`); typecheck/lint/build run once by `erp-deploy-gate` (`:50-58`); field-width standard (`:189-197`); no-wheel number inputs (`:236-241`).
11. **Deploy rule** (`_workflow.md:1-107` + user memory): trace → shared-file pre-pass (freeze `packages/shared`) → fan out → one `erp-deploy-gate` pass → fix → deploy to the TEST stack; PROD only on explicit user instruction; one change = one commit; run every migration on BOTH Supabase projects.

---

## 1. AREA-BY-AREA

Conventions used in the column tables: `NN` = NOT NULL, `null` = nullable. Every table below (unless noted) also carries the standard audit set `company_id uuid NN FK companies`, `created_at timestamptz NN default now()`, `created_by uuid NN FK users`, `updated_at timestamptz NN default now()`, `updated_by uuid NN FK users`, `deleted_at timestamptz null`, and the RLS pair `<table>_company_read` (select, `company_id = current_company_id()`) + `<table>_manager_write` (all, role in admin/manager) — abbreviated as **[audit cols]** and **[std RLS]**.

### 1a. Production Order, Job Card, Plan, Route Card — and how they link

**Chain (FKs, all in `apps/api/src/db/schema.ts`):**
```
sales_order_lines.id ──┐                         job_work_order_lines.id ──┐
                       ▼                                                    ▼
plans.so_line_id (3184)                          plans.jw_line_id (3187)
plans.item_id (3193) → items.id
plans.bom_master_id (3220) → bom_masters.id
plans.jc_id (3227) → job_cards.id                       ← set when JC is built
plans.material_pr_id / dp_pr_id / fo_pr_id / fo_mat_pr_id → purchase_requests.id (3235-3252)
plan_ops.plan_id (3320) → plans.id                      (old flow only, ops_source='plan')

route_cards.item_id (797) → items.id   UNIQUE per company+item (route_cards_company_item_uniq :843)
route_card_ops.route_card_id (870) → route_cards.id
route_card_revisions.route_card_id (929) → route_cards.id  (ops_snapshot jsonb)

production_orders.plan_id (6065) → plans.id     UNIQUE (production_orders_plan_uniq :6113)
production_orders.route_card_id (6079) → route_cards.id
production_orders.job_card_id (6086) → job_cards.id  UNIQUE (production_orders_job_card_uniq :6114)
production_orders.item_id (6072) → items.id

job_cards.item_id (965) → items.id
job_cards.source_so_line_id (977) → sales_order_lines.id   ─┐ CHECK num_nonnulls(...) <= 1 (:1051-1054)
job_cards.source_jw_line_id (980) → job_work_order_lines.id ─┘
job_cards.production_order_id (1003)  (FK declared in SQL only: migrations/0133_production_orders.sql:127)
job_cards.parent_job_card_id (995) → job_cards.id  (rework/repair child), parent_nc_id (988) → nc_register.id
jc_ops.job_card_id (1080) → job_cards.id ; unique (job_card_id, op_seq) :1136
op_log.jc_op_id (1170) → jc_ops.id ; running_ops.jc_op_id (1344) → jc_ops.id
jc_ops.outsource_pr_id (1104) → purchase_requests.id ; jc_ops.outsource_po_line_id (1107) → purchase_order_lines.id
```
**"Production Order" exists** (migration 0133, ADR-170 `docs/DECISIONS.md:9124-9190`): `IN-PRO-#####` = Plan + Route Card + Target Date → builds the Job Card; stock credited **once at close**. Two flows coexist, switched by `plans.ops_source` (`'plan'` = old Execute flow with `plan_ops`; `'route_card'` = new PO flow) — `schema.ts:3182`, `production-orders/service.ts:548-552`.

**How Route Card ops become JC ops:** `createProductionOrder` (`apps/api/src/modules/production-orders/service.ts:529`) reads `route_card_ops` ordered by `op_seq` (`:631-634`), then calls the shared builder `buildJobCardFromOps` (`apps/api/src/modules/plans/service.ts:1132`) at `production-orders/service.ts:690`; sets `plans.plan_status='jc_created', jc_id` (`:701`) and `job_cards.production_order_id` (`:736`). The old flow: `executePlan` (`plans/service.ts:1018`) copies `plan_ops`; default ops per item come from `getDefaultRouteOpsForItem` (`plans/service.ts:929`). A default terminal QC op is appended by `apps/api/src/lib/jc-default-qc.ts` (ADR-168).

#### Tables

**`plans`** — `schema.ts:3171-3311`; SQL `migrations/0024_phase8_plans.sql:57-139`; later adds: `required_docs` (0026:14), `jw_line_id` (0060:18), `raw_material_*` (0106:21-27), `ops_source` (0133:38), `customer_dispatch_date` (0137:7).
| column | type | null | default |
|---|---|---|---|
| id | uuid PK | NN | gen_random_uuid() |
| code | text | NN | — (`PLN-NNNN`, `plans/service.ts:95`) |
| plan_date | date | NN | |
| plan_status | enum plan_status | NN | 'in_planning' |
| plan_type | enum plan_type | NN | |
| ops_source | text | NN | 'plan' |
| so_line_id | uuid FK sales_order_lines (set null) | null | |
| jw_line_id | uuid FK job_work_order_lines (set null) | null | |
| so_code_text, item_code_text, item_name_text | text | null | |
| line_no | integer | null | |
| item_id | uuid FK items (set null) | null | |
| order_qty, plan_qty | integer | NN | CHECK > 0 (:3282-3283) |
| planned_start_date, planned_end_date, customer_dispatch_date | date | null | |
| raw_material_grade_id | uuid FK material_grades (set null) | null | |
| raw_material_grade_text | text | null | |
| raw_material_size_id | uuid FK material_sizes (set null) | null | |
| raw_material_size_text | text | null | |
| bom_master_id | uuid FK bom_masters (set null) | null | |
| bom_parent_code, bom_child_code | text | null | |
| jc_id | uuid FK job_cards (set null) | null | |
| dp_vendor_id | uuid FK vendors | null | direct-purchase plan |
| dp_vendor_code_text, dp_remarks | text | null | |
| dp_cost | numeric(12,2) | null | |
| dp_pr_id | uuid FK purchase_requests | null | |
| fo_vendor_id | uuid FK vendors | null | full-outsource plan |
| fo_vendor_code_text, fo_process, fo_material_src, fo_cost_center, fo_remarks | text | null | |
| fo_rate | numeric(12,2) | null | |
| fo_delivery_date | date | null | |
| fo_pr_id, fo_mat_pr_id, material_pr_id | uuid FK purchase_requests | null | |
| required_docs | jsonb | NN | '[]' |
| remarks | text | null | |
| [audit cols] | | | |

Statuses `PLAN_STATUSES` = `in_planning, planned, jc_created, pr_created, in_production, complete, cancelled` — `packages/shared/src/enums/plan-status.ts:1-9`. `PLAN_TYPES` = `manufacture, direct_purchase, full_outsource, assembly` — `enums/plan-type.ts:1-6`. Derived progress for the new flow is computed in `listPlans` (`plans/service.ts:164`; enum `enums/plan-derived-status.ts`).

**`plan_ops`** — `schema.ts:3312-3381`; SQL `0024_phase8_plans.sql:192-218`. Columns: id, company_id, plan_id (FK plans cascade, NN), op_seq int NN, machine_id FK machines null, machine_code_text, operation text NN, op_type enum op_type NN 'process', cycle_time_min numeric(10,2) NN '0', program, tool_no, tool_details, qc_required bool NN false, outsource_vendor_id FK vendors (set null), outsource_vendor_text, outsource_cost numeric(12,2) NN '0', outsource_pr_id FK purchase_requests (set null), [audit cols]. Unique (plan_id, op_seq) :3352.

**`route_cards`** — `schema.ts:789-861`; SQL `0004_phase3_op_entry.sql:120-132`; adds: raw material (0108:15-21), `plan_type` (0123:11).
| column | type | null | default |
|---|---|---|---|
| id | uuid PK | NN | |
| code | text | NN | |
| item_id | uuid FK items | NN | unique per company (`:843`) |
| current_revision | integer | NN | 0 |
| raw_material_grade_id | uuid FK material_grades (set null) | null | |
| raw_material_grade_text | text | null | |
| raw_material_size_id | uuid FK material_sizes (set null) | null | |
| raw_material_size_text | text | null | |
| notes | text | null | |
| plan_type | enum plan_type | NN | 'manufacture' |
| [audit cols] | | | |

**`route_card_ops`** — `schema.ts:862-921`; SQL `0004:86-105` + OSP cols (0022). Columns: id, company_id, route_card_id FK cascade NN, op_seq int NN, machine_id FK machines, machine_code_text, operation text NN, op_type enum NN 'process', cycle_time_min numeric(10,2) NN '0', program, tool_no, tool_details, qc_required bool NN false, osp_vendor_id FK vendors, osp_vendor_code_text, osp_lead_days int, [audit cols]. Unique (route_card_id, op_seq) :901.
**`route_card_revisions`** — `schema.ts:922-955`: id, company_id, route_card_id, revision_no int NN, notes, ops_snapshot jsonb NN, created_at, created_by. Unique (route_card_id, revision_no).

**`job_cards`** — `schema.ts:956-1072`; SQL `0004_phase3_op_entry.sql:42-62`; adds: source FKs (0008:15-27), `parent_nc_id` (0012:1), `remarks` (0057:8), `client_material_gate` (0083:27), raw material (0106:30-36), `parent_job_card_id/origin_op_seq/recovery_kind` (0122:62-70), `production_order_id` (0133:127).
| column | type | null | default |
|---|---|---|---|
| id | uuid PK | NN | |
| code | text | NN | `IN-JC-YY-#####` (`job-cards/service.ts:1291-1305`) |
| jc_date | date | NN | |
| item_id | uuid FK items | NN | |
| order_qty | integer | NN | CHECK > 0 (:1050) |
| priority | enum jc_priority | NN | 'normal' |
| due_date | date | null | |
| drawing_file_path, remarks, source_legacy_ref | text | null | |
| source_so_line_id | uuid FK sales_order_lines (set null) | null | |
| source_jw_line_id | uuid FK job_work_order_lines (set null) | null | |
| parent_nc_id | uuid FK nc_register (set null) | null | |
| parent_job_card_id | uuid FK job_cards (set null) | null | |
| origin_op_seq | integer | null | |
| recovery_kind | text | null | |
| production_order_id | uuid (FK in SQL only) | null | |
| closed_at | timestamptz | null | |
| client_material_gate | boolean | NN | true |
| raw_material_grade_id | uuid FK material_grades (set null) | null | |
| raw_material_grade_text | text | null | |
| raw_material_size_id | uuid FK material_sizes (set null) | null | |
| raw_material_size_text | text | null | |
| [audit cols] | | | |

JC status is **not stored** — derived by view `v_jc_status.computed_status` ∈ `open, qc_pending, complete, closed, no_ops` (`packages/shared/src/enums/jc-computed-status.ts:1`; view last defined `migrations/0019_phase6_dc_receipts.sql:274`).

**`jc_ops`** — `schema.ts:1073-1162`; SQL `0004:7-39`; adds: `outsource_pr_id/outsource_po_line_id` (0009:161-162, legacy text cols dropped in 0014), scheduling (0034:13-21).
| column | type | null | default |
|---|---|---|---|
| id | uuid PK | NN | |
| job_card_id | uuid FK job_cards cascade | NN | unique with op_seq (:1136) |
| op_seq | integer | NN | |
| machine_id | uuid FK machines | null | |
| machine_code_text | text | null | |
| operation | text | NN | |
| op_type | enum op_type (`process, qc, outsource`) | NN | 'process' |
| cycle_time_min | numeric(10,2) | NN | '0' |
| program, tool_no, tool_details | text | null | |
| qc_required | boolean | NN | false |
| qc_call_date, qc_attended_date | date | null | |
| rework_qty | integer | NN | 0 |
| outsource_vendor_id | uuid FK vendors | null | |
| outsource_vendor_text | text | null | |
| outsource_cost | numeric(12,2) | NN | '0' |
| outsource_status | enum outsource_status (`pending, pr_raised, po_created, sent, received`) | null | |
| outsource_pr_id | uuid FK purchase_requests (set null) | null | |
| outsource_po_line_id | uuid FK purchase_order_lines (set null) | null | |
| outsource_dc_no | text | null | |
| outsource_sent_qty, outsource_returned_qty | integer | NN | 0 |
| outsource_sent_date, planned_start, planned_end | date | null | |
| queue_position | integer | null | |
| [audit cols] | | | |

Op status is derived by view `v_jc_op_status.computed_status` (latest body `migrations/0130_osp_rollups_all_po_lines.sql:34-278`) ∈ `complete, qc_pending, running, in_progress, received, pr_raised, po_created, at_vendor, ready_for_pr, outsource, available, waiting` (`0130:239-277`). The view also exposes `available` (`0130:196-207`) = pieces this op may pick up = prev op output − already consumed − open return-to-vendor + open rework.

**`op_log`** — `schema.ts:1163-1266` (append-only; `log_type` ∈ `start, complete, qc`; qty/reject_qty integer; `tpi_cert_no`, `qc_report_path/name`). **`running_ops`** — `schema.ts:1337-1398` (status `running, done, stopped`; partial unique "one running per op" :1368 and "one running per machine" :1371).

**`production_orders`** — `schema.ts:6055-6141`; SQL `migrations/0133_production_orders.sql:48-87`.
| column | type | null | default |
|---|---|---|---|
| id | uuid PK | NN | |
| code | text | NN | `IN-PRO-#####` |
| status | text | NN | 'open' — CHECK in ('open','closed') (:6120) |
| plan_id | uuid FK plans | NN | unique |
| plan_code_text | text | NN | |
| so_code_text | text | null | |
| line_no | integer | null | |
| item_id | uuid FK items | NN | |
| item_code_text | text | NN | |
| item_name_text | text | null | |
| route_card_id | uuid FK route_cards | NN | |
| route_card_code_text | text | NN | |
| route_card_revision | integer | NN | 0 |
| job_card_id | uuid FK job_cards | NN | unique |
| jc_code_text | text | NN | |
| order_qty | integer | NN | |
| target_date | date | NN | |
| closed_at | timestamptz | null | |
| closed_by | uuid FK users | null | |
| credited_qty | integer | null | |
| remarks | text | null | |
| [audit cols] | | | |

Statuses `PRODUCTION_ORDER_STATUSES = ['open','closed']` — `packages/shared/src/enums/production-order-status.ts:7`. Progress is read live from `v_jc_status` (`production-orders/service.ts:119-124`), never stored.

#### Service functions
- `apps/api/src/modules/plans/service.ts`: `getNextPlanCode:112`, `listPlans:164`, `getPlan:294`, `createPlan:483`, `updatePlan:637`, `finalizePlan:805`, `softDeletePlan:871`, `getDefaultRouteOpsForItem:929`, `executePlan:1018`, `buildJobCardFromOps:1132`, `getPlanningDashboard:1631`, `getUnplannedOrders:1724`, `getPlanRelated:2003`, `reserveStock:2264`, `releaseReservationsForLine:2347`.
- `apps/api/src/modules/so-planning/service.ts`: `getPlanningSoList:236`, `getPlanningSoDetail:514`, `getPlanningBom:1131`, `raisePlanningPr:1351`.
- `apps/api/src/modules/route-cards/service.ts`: `getNextRouteCardCode:285`, `listRouteCards:292`, `getRouteCard:498`, `computeRouteCardDiffNote:535`, `createRouteCard:603`, `updateRouteCard:708`, `softDeleteRouteCard:877`, `stripAutoTerminalQcOp:1215`, `saveRouteCardForItem:1254`.
- `apps/api/src/modules/job-cards/service.ts`: `listJobCards:99`, `getJobCard:351`, `listJobCardSourceOptions:679`, `getJobCardEditModel:719`, `getJobCardStatusExtras:918`, `nextJcCode:1291`, `getNextJcCode:1310`, `createJobCard:1768`, `updateJobCard:1928`, `deleteJobCard:2349`, `getJobCardRelated:2417`, `countJobCards:2877`.
- `apps/api/src/modules/production-orders/service.ts`: `jcSettledWithLossesSql:215`, `listProductionOrders:458`, `getProductionOrder:508`, `getNextProductionOrderCode:517`, `createProductionOrder:529`, `closeProductionOrder:761`; private `nextProductionOrderCode:97`.
- `apps/api/src/modules/jc-ops/service.ts`: `listJcOpsBoard:32`, `changeJcOpMachine:210`.

#### Routes (`apps/api/src/modules/*/routes.ts`)
plans: `GET /plans:17`, `GET /plans/next-code:23`, `GET /plans/:id:28`, `GET /plans/:id/related:34`, `POST /plans:40`, `PATCH /plans/:id:48`, `POST /plans/:id/finalize:55`, `DELETE /plans/:id:61`, `POST /plans/:id/execute:67`, `GET /plans/default-ops:73`, `GET /planning-dashboard:81`, `GET /planning-dashboard/unplanned:88`, `POST /so-reservations:95`, `POST /so-reservations/release:103`.
so-planning: `GET /so-planning:16`, `POST /so-planning/lines/:soLineId/raise-pr:22`, `GET /so-planning/:id:31`, `GET /so-planning/:id/bom/:lineId:37`.
route-cards: `GET /route-cards:14`, `GET /route-cards/next-code:20`, `GET /route-cards/:id:25`, `POST /route-cards:31`, `PUT /route-cards/:id:39`, `DELETE /route-cards/:id:46`.
job-cards: `GET /job-cards:14`, `POST /job-cards:20`, `GET /job-cards/source-options:29`, `GET /job-cards/next-code:34`, `GET /job-cards/:id/edit:39`, `GET /job-cards/:id/status:47`, `GET /job-cards/:id/related:53`, `GET /job-cards/:id:59`, `PATCH /job-cards/:id:65`, `DELETE /job-cards/:id:72`.
production-orders: `GET /production-orders:16`, `GET /production-orders/next-code:23`, `GET /production-orders/:id:28`, `POST /production-orders:34`, `POST /production-orders/:id/close:42`.
jc-ops: `GET /jc-ops:15`, `PATCH /jc-ops/:id/machine:21`, `POST /jc-ops/:id/outsource-balance:29`.

#### UI screens (`apps/web/src/modules/`)
plans/routes/{list,detail,new,edit}.tsx (path `plans`); so-planning/routes/workflow.tsx (path `planning`); route-cards/routes/{list,detail,new,edit}.tsx (`route-cards`); job-cards/routes/{list,new,edit,status}.tsx (`job-cards`); production-orders/routes/{list,detail,new,close}.tsx (`production-orders`, `production-orders/new`, `production-orders/$id`, `production-orders/close`).

### 1b. BOM — does any line carry raw material quantity or UOM?
Tables: **`bom_masters`** `schema.ts:2776-2825` (bom_no text NN, bom_name text NN, parent_item_id FK items, revision int NN 1, status enum bom_status `draft, active, obsolete`, revision_date date NN, [audit cols]); **`bom_master_lines`** `schema.ts:2826-2890`; **`bom_master_revisions`** `schema.ts:2891-2940` (items_snapshot jsonb).

`bom_master_lines` columns: id; company_id; bom_master_id FK cascade NN; line_no int NN; child_item_id FK items NN; **`qty_per_set numeric(12,2) NN`** (CHECK > 0, `:2867`); bom_type enum `manufacture, purchase, outsource` (`enums/bom-line-type.ts:7`); raw_material_grade_id FK material_grades (set null); raw_material_grade_text; raw_material_size_id FK material_sizes (set null); raw_material_size_text; [audit cols]. Unique (bom_master_id, child_item_id) `:2861`.

Answer: a BOM line carries **`qty_per_set`** (quantity of the child item per one parent set — a *component* quantity, not a raw-material consumption) and a **raw-material grade/size reference** (FK + text snapshot). A raw-material **quantity** (weight, length, kg-per-piece, scrap %) is **NOT PRESENT**. A **UOM on the BOM line** is **NOT PRESENT** (UOM lives on `items.uom`).
Links: `plans.bom_master_id` (`schema.ts:3220`), `job_work_order_lines.source_bom_master_id` (`:1733`); consumers `plans/service.ts:368-392` (bom child qty math), `so-planning/service.ts:1131 getPlanningBom`, `assembly/stock-cascade.ts` (component consumption).
Service `apps/api/src/modules/bom-master/service.ts`: `getNextBomNo:189`, `listBomMasters:196`, `getBomMaster:392`, `getBomMasterRelated:409`, `computeBomDiffNote:604`, `createBomMaster:640`, `updateBomMaster:726`, `softDeleteBomMaster:865`. Routes `bom-master/routes.ts`: `GET /bom-masters:14`, `GET /bom-masters/next-code:20`, `GET /bom-masters/:id:25`, `GET /bom-masters/:id/related:31`, `POST /bom-masters:37`, `PUT /bom-masters/:id:45`, `DELETE /bom-masters/:id:52`. UI `bom-master/routes/{list,detail,new,edit}.tsx` (path `bom-masters`).

### 1c. Item master
**`items`** — `schema.ts:201-268`; SQL `migrations/0000_initial.sql:36-54`; adds: `min_stock_qty` (0028:19-20), `procurement_type` (0134:20-26 + CHECK), `image_path` (0136:11).
| column | type | null | default |
|---|---|---|---|
| id | uuid PK | NN | |
| code | text | NN | unique per company while not deleted (`items_company_code_uniq` :239) |
| name | text | NN | |
| description, drawing_no, hsn_code, drawing_file_path, image_path | text | null | |
| revision | text | NN | 'A' |
| **material** | text | null | free text — the only "grade" field on items |
| **uom** | enum uom (`NOS, KGS, SET, MTR` — `enums/uom.ts:1`) | NN | 'NOS' |
| **item_type** | enum item_type (`component, assembly` — `enums/item-type.ts:1`) | NN | 'component' |
| **procurement_type** | text (`make, buy` — `enums/item-procurement-type.ts:10`) | NN | 'make' |
| min_stock_qty | integer | NN | 0 |
| [audit cols] | | | |

- **Grade column: NOT PRESENT** as an FK — only free-text `items.material`. Grade/size FKs exist on route_cards, job_cards, plans and bom_master_lines, **not on items**.
- **Size column: NOT PRESENT** on items.
- **Traceable / lot-controlled / batch flag: NOT PRESENT** (grep `traceab|lot_control|batch|heat|serial` in schema.ts + migrations → only comments and `op_log.tpi_cert_no`).
- Item-type value **"raw material" is NOT PRESENT** — `item_type` is only `component | assembly`; `procurement_type` is only `make | buy`.
- Code rule: auto `ITM-####` = last `ITM-` code + 1 (`items/service.ts:124-138`), user may override; uniqueness index `items_company_code_uniq` (`schema.ts:239-241`).
- 26 tables reference `items.id` (`grep -c "references(() => items.id" schema.ts` = 26; lines 799 967 1466 1719 1814 1985 2196 2277 2327 2381 2424 2617 2788 2839 3200 3469 3519 3632 3700 4106 4210 4271 4749 4905 6016 6074).
Service `items/service.ts`: `listItems:37`, `getItem:107`, `getNextItemCode:142`, `createItem:147`, `createItemsBulk:234`, `updateItem:350`, `softDeleteItem:395`. Routes `items/routes.ts`: `GET /items:15`, `GET /items/next-code:22`, `GET /items/:id:27`, `POST /items:33`, `POST /items/bulk:43`, `PATCH /items/:id:51`, `DELETE /items/:id:58`. UI `items/routes/{list,detail,edit}.tsx` (path `items`).

### 1d. Material grades / sizes masters
**`material_grades`** — `schema.ts:537-582` (auto code `GRD-###`, `material-grades/service.ts:111`): id, company_id, code text NN, name text NN ("EN24", "SS304"), description, is_active bool NN true, [audit cols]; unique (company_id, code) `:559`.
**`material_sizes`** — `schema.ts:583-630` (auto `SZ-####`, `material-sizes/service.ts:114`): id, company_id, code text NN, name text NN ("Ø30 × 1000" — one free-text box "by decision", comment `:592`), description, is_active bool NN true, [audit cols].
- Density / weight-per-metre / section type / unit conversion: **NOT PRESENT**.
- Linked to items: **NOT PRESENT** (no FK on `items`). Linked (FK + text snapshot) on `route_cards:815-822`, `job_cards:1020-1027`, `bom_master_lines:2848-2855`, `plans:3219-3226`, all `ON DELETE SET NULL`.
Services: `material-grades/service.ts` `listMaterialGrades:39`, `getMaterialGrade:83`, `createMaterialGrade:123`, `createMaterialGradesBulk:187`, `updateMaterialGrade:290`, `softDeleteMaterialGrade:326`; `material-sizes/service.ts` `listMaterialSizes:42`, `getMaterialSize:86`, `createMaterialSize:126`, `createMaterialSizesBulk:190`, `updateMaterialSize:294`, `softDeleteMaterialSize:330`. Routes: `GET/POST /material-grades:15,27`, `/material-grades/:id GET:21 PATCH:46 DELETE:53`, `POST /material-grades/bulk:38`; same shape for `/material-sizes` (`routes.ts:15-53`). UI: one combined screen `apps/web/src/modules/raw-material/routes/index.tsx` (path `raw-material`; access form key `rawmat_create`).

### 1e. GRN + Incoming QC — exact function where stock is credited
**Stock is credited at Incoming-QC accept, never at GRN save.** The single credit function is
`creditGrnQcStock` — `apps/api/src/modules/goods-receipt-notes/cascades.ts:318-375`; the insert is at `:362-374`
(`txn_type='in'`, `source_type='grn_qc'`, `source_ref='<GRN code> / ln <8-char line id>'`, `qty` = accepted delta, `stock_before/after` read from `v_item_stock` after `SELECT … FROM items … FOR UPDATE` at `:341`).
Early-returns (no credit): qty ≤ 0 (`:329`); no `item_id` (free-text item, `:330`); mid-route OSP return (`:333`, ADR-092); JC linked to a Production Order (`:341-342`, ADR-170).
Callers:
1. Incoming QC register — `submitIncomingQc` `apps/api/src/modules/incoming-qc/service.ts:492`; validates remaining qty (`:534-546`), updates the line (`:555-576`, status `in_progress`/`completed`), credits **only this inspection's accepted delta** (`:581-589`), recalcs PO line/header (`:590-601`), credits the OSP op (`creditOutsourceReturn :612`), mirrors onto the next QC op (`:624`), raises an NC for rejects **only when the line traces to a jc_op** (`:669-700`) — "Raw-material rejects (no source jc_op / no job card) currently raise no NC" (`:666-668`).
2. Whole-GRN edit path — `writeStoreTxnOnQcAccept` `cascades.ts:202-215` (credits full accepted qty on the `→ completed` transition), called from `goods-receipt-notes/service.ts:1214,1266,1310`.
GRN create (`createGoodsReceiptNote` `goods-receipt-notes/service.ts:758`) writes **no** ledger row (grep `storeTransactions` in that file → only the cascades import and comments).
Rejected qty: **not credited anywhere**; stays as `goods_receipt_note_lines.qc_rejected_qty`; NC only for JC-linked lines (above).

Tables: **`goods_receipt_notes`** `schema.ts:2117-2181`; SQL `0009_phase5_procurement.sql:37-54`; adds `delivery_challan_id` (0075:19-21), CHECK `goods_receipt_notes_vendor_one_of` (0080:10-12), `nc_id` (0122:85-87).
| column | type | null |
|---|---|---|
| id, code text NN (`IN-GRN-#####`), grn_date date NN | | |
| purchase_order_id FK purchase_orders (set null), po_code_text | | null |
| vendor_id FK vendors, vendor_code_text (CHECK one of them) | | null |
| dc_no text, delivery_challan_id FK delivery_challans (set null), invoice_no, remarks | | null |
| nc_id FK nc_register (set null) | | null |
| [audit cols] | | |

**`goods_receipt_note_lines`** `schema.ts:2182-2268`; SQL `0009:7-34`; adds `qc_report_path/name` (0043:30-32), `qc_inspected_by_text` (0072:8), CHECK `item_one_of` (0075:44-46).
| column | type | null | default |
|---|---|---|---|
| goods_receipt_note_id FK cascade | uuid | NN | |
| line_no | integer | NN | unique per GRN |
| purchase_order_line_id FK purchase_order_lines (set null) | uuid | null | |
| item_id FK items | uuid | null | CHECK num_nonnulls(item_id,item_code_text) ≥ 1 |
| item_code_text | text | null | |
| item_name | text | NN | |
| received_qty | integer | NN | CHECK ≥ 0 |
| dc_ref_no | text | null | |
| qc_status | enum grn_qc_status (`pending, in_progress, completed` — `enums/grn-qc-status.ts:5`) | NN | 'pending' |
| qc_accepted_qty, qc_rejected_qty | integer | NN | 0; CHECK accepted+rejected ≤ received (:2247) |
| qc_date | date | null | |
| qc_remarks, qc_inspected_by_text, qc_report_path, qc_report_name, remarks | text | null | |
| qc_inspected_by FK users | uuid | null | |
| [audit cols] | | | |

Extra RLS: `goods_receipt_note_lines_qc_update` (role `qc` may update) `:2260`. GRN header status: **NOT PRESENT** (no status column; status is per line `qc_status`). PO status enum `draft, open, partial, qc_pending, closed, cancelled` (`enums/po-status.ts:3-10`), recalculated by `recalcPoHeaderStatus` `cascades.ts:118`.
Services: `goods-receipt-notes/service.ts` `listGoodsReceiptNotes:378`, `getGoodsReceiptNote:733`, `createGoodsReceiptNote:758`, `insertGrnForOspReceipt:887`, `updateGoodsReceiptNote:981`, `softDeleteGoodsReceiptNote:1338`, `getGrnRelated:1454`; `cascades.ts` `recalcPoLineReceivedQty:46`, `recalcPoHeaderStatus:118`, `writeStoreTxnOnQcAccept:202`, `creditGrnQcStock:318`; `incoming-qc/service.ts` `getIncomingQc:301`, `submitIncomingQc:492`.
Routes: `GET /goods-receipt-notes:14`, `GET /goods-receipt-notes/:id:20`, `GET /goods-receipt-notes/:id/related:26`, `POST /goods-receipt-notes:32`, `PATCH /goods-receipt-notes/:id:40`, `DELETE /goods-receipt-notes/:id:47`; `GET /incoming-qc:10`, `POST /incoming-qc/:grnLineId/inspect:16`. UI: `goods-receipt-notes/routes/{list,detail,edit}.tsx` (path `goods-receipt-notes`), `incoming-qc/routes/index.tsx` (path `incoming-qc`).

### 1f. Stock ledger
- **Ledger table `store_transactions`** — `schema.ts:2269-2313`; SQL `0009_phase5_procurement.sql:142-158`. Append-only: no UPDATE/DELETE RLS policy (`:2306` comment; ADR-011 #4). **No `updated_*`/`deleted_at` columns** (deliberate).
| column | type | null | default |
|---|---|---|---|
| id | uuid PK | NN | |
| company_id | uuid FK | NN | |
| txn_date | date | NN | |
| item_id | uuid FK items | null | free-text items are not stock-tracked |
| item_code_text | text | null | |
| txn_type | enum store_txn_type (`in, out, adjust` — `enums/store-txn-type.ts:4`) | NN | |
| **qty** | **integer** | NN | CHECK > 0 (:2295) |
| source_type | enum store_txn_source_type | NN | |
| source_ref | text | NN | natural-key reference e.g. 'IN-GRN-00001' |
| stock_before, stock_after | integer | NN | running balance snapshot written by the caller |
| remarks | text | null | |
| created_at | timestamptz | NN | now() |
| created_by | uuid FK users | NN | |

`source_type` values (`packages/shared/src/enums/store-txn-source-type.ts:4-33`): `grn_qc, manual_adjust, dispatch, jw_in, jw_out, qc_accept, jw_return, assembly, reservation, production_order_close, other`.
- **Balance table `item_stock_balances`** — `schema.ts:2373-2403`; SQL `0020_phase7_item_stock_table.sql:28-34`: (company_id, item_id) PK, `on_hand_qty integer NN default 0`, `updated_at`. Read-only RLS; **no app writes** — written only by the trigger.
- **Trigger** `apply_store_txn_to_balance` AFTER INSERT ON `store_transactions` FOR EACH ROW → function `public.apply_store_txn_to_balance()` (SECURITY DEFINER) — `0020:77-113`. Delta = `+qty` for `in`, `−qty` for `out`, `+qty` for `adjust` (`0020:91-95`); upsert `ON CONFLICT (company_id,item_id) DO UPDATE SET on_hand_qty = on_hand_qty + delta` (`0020:97-101`). Rows with `item_id IS NULL` are skipped (`0020:87-89`).
- **View** `v_item_stock` = `SELECT company_id, item_id, on_hand_qty FROM item_stock_balances` — `0020:121-126` (Drizzle type comment `schema.ts:2365-2371`).
- **How on-hand is calculated**: maintained balance column (trigger), exposed through `v_item_stock`; every service reads `COALESCE(on_hand_qty,0) FROM v_item_stock` inside the same tx after `FOR UPDATE` on the items row (e.g. `store-transactions/service.ts:164-168`, `store-issues/service.ts:197-203`). Backfill/reconcile SQL that re-sums the ledger: `0020:58-73`.
- **Quantities are INTEGER everywhere on the stock path** (`store_transactions.qty`, `item_stock_balances.on_hand_qty`, `goods_receipt_note_lines.received_qty/qc_*_qty`, `store_issues.qty`, `job_cards.order_qty`, `op_log.qty`, `party_materials.stock_qty`). Decimals exist only on `bom_master_lines.qty_per_set numeric(12,2)`, `nc_register.rejected_qty numeric(12,2)`, `job_work_orders.client_material_qty numeric(12,2)` and rates.
- Location / warehouse / bin dimension: **NOT PRESENT** (grep `location|warehouse|bin_` in schema.ts → 0 columns).
- Other DB-level objects (full catalogue): triggers = `*_set_updated_at` on 26 tables (`0001:34-44`, `0003`, `0005`, `0009_phase4_triggers`, `0010`, `0011`, `0012`, `0014`, `0016:90`, `0098:72`), `on_auth_user_created`/`on_auth_user_email_changed` (`0001:73,91`), `apply_store_txn_to_balance` (`0020:111`), `op_log_timing_only_update` (`0097:60`). Views = `v_jc_op_status` (0006 … latest 0130:34), `v_jc_status` (0006:135, 0019:274), `v_item_stock` (0011:17, 0020:121), `v_osp_wip` (0064 … latest 0130:336), `v_op_machine_output` (0095:87), `v_nc_op_breakup` (0122:337 … latest 0138:21). Functions = `current_company_id`, `current_user_role` (0000:4-9, 0001:11-17), `set_updated_at` (0001:23), `handle_new_auth_user` (0001:54), `sync_auth_user_email` (0001:79), `current_user_id` (0016:17), `apply_store_txn_to_balance` (0020:77), `current_auth_company_id` (0041:22), `op_log_timing_only_update` (0097:40). No materialized views.
- Every ledger insert site (19): `assembly/stock-cascade.ts:123,146,206,246`; `customer-dispatches/service.ts:158,218`; `delivery-challans/receipt-cascades.ts:263`; `goods-receipt-notes/cascades.ts:362`; `jw-dc/service.ts:821,1081`; `jw-returns/service.ts:77`; `op-entry/qc-stock-cascade.ts:181`; `plans/service.ts:2287,2375`; `production-orders/service.ts:828`; `store-inventory/service.ts:243`; `store-issues/service.ts:220`; `tool-issues/service.ts:260,363`.
Services: `store-transactions/service.ts` `buildStoreTxnWhere:42`, `listStoreTransactions:67`, `getItemBalance:161`; `store-inventory/service.ts` `listStoreInventory:41`, `adjustStock:205` (manual ± with negative-stock guard `:236-240`), `setMinStock:262`. Routes: `GET /store-transactions:10`, `GET /store-transactions/item-balance/:itemId:16`, `GET /store-inventory:11`, `POST /store-inventory/adjust:17`, `POST /store-inventory/set-min:23`. UI: `store-inventory/routes/list.tsx` (path `store-inventory`) which embeds `store-transactions/components/stock-ledger.tsx`; `stock-valuation/routes/page.tsx`.

### 1g. Reservation / allocation
**Present — hard-move model** (migration 0099). Table **`so_stock_reservations`** `schema.ts:2314-2372`; SQL `0099_so_stock_reservations.sql:19-42`: id; company_id; so_line_id uuid NN (SO line or JW line id — no FK); so_code_text text NN; line_no int NN; item_id FK items NN; item_code_text; qty int NN CHECK > 0; status text NN 'active' CHECK in ('active','released','dispatched'); remarks; [audit cols].
**It DOES reduce on-hand**: `reserveStock` (`plans/service.ts:2264`) locks the item (`readOnHandLocked :2249-2262`), refuses if qty > free stock (`:2273-2275`), inserts a `store_transactions` **`out`** row with `source_type='reservation'` (`:2287-2299`) and a reservation row. `releaseReservationsForLine` (`:2347`) writes the matching `in` and flips status to `released`. Dispatch flips to `dispatched` with no second move (`customer-dispatches/service.ts:193-240`). So "free stock" = `v_item_stock.on_hand_qty` (already net of reservations); there is no separate `reserved_qty` column. Routes `POST /so-reservations:95`, `POST /so-reservations/release:103` (`plans/routes.ts`). A reservation for **raw material / job cards** is NOT PRESENT — the mechanism is keyed to SO/JW lines only.

### 1h. Store Issue / Return
**`store_issues`** — `schema.ts:3623-3685`; SQL `0028_phase8_store_issues.sql:23-46` (no later ALTERs).
| column | type | null |
|---|---|---|
| id, code text NN (`ISS-NNNNN`, `store-issues/service.ts:49`), issue_date date NN | | |
| item_id FK items (set null), item_code_text | | null |
| item_name text | | NN |
| qty integer | | NN |
| issued_to text | | NN |
| ref_type text (`'Job Card','SO','Production','Maintenance','Other'` — `packages/shared/src/schemas/store-issue.ts:16-22`), ref_no text, purpose, remarks | | null |
| store_transaction_id FK store_transactions (set null) | | null |
| [audit cols] | | |

What it links to: **free text only** — `ref_type` + `ref_no` text; no FK to job_cards / plans / sales_orders / cost_centers / operators. How it moves stock: `createStoreIssue` `store-issues/service.ts:172-283` — locks items row (`:197`), reads `v_item_stock` (`:200-205`), **refuses if qty > on-hand** (`:206-210`), inserts `store_transactions` `out` with `source_type='other'`, `source_ref='<ISS code> · <item code>'` (`:217-233`), then the issue row with `store_transaction_id` (`:237-255`). Permission `requireFormAccess(user,'issue_create','entry')` (`:180`).
**Return of a store issue: NOT PRESENT** (no `store_issue_returns` table, no route; grep `store_return|material_return|issue_return` → 0). The only return mechanism is **tool issues**: `tool_issues` `schema.ts:3509-3569` (return_status text 'issued', return_good/damaged/consumed_qty) + `tool_issue_returns` `schema.ts:3570-3622`; `recordToolReturn` `tool-issues/service.ts:307` writes an `in` row for good qty only (`:352-372`, `source_type='other'`). Tool issue create `createToolIssue:219` writes the `out` at `:260`. Routes: `GET /store-issues:10`, `GET /store-issues/next-code:16`, `POST /store-issues:21`; `GET /tool-issues:14`, `GET /tool-issues/next-code:20`, `POST /tool-issues:25`, `POST /tool-issues/:id/return:33`. UI: `store-issues/routes/list.tsx` (path `issue-register`) which also hosts `tool-issues/components/tool-issue-register-view.tsx`.
Statuses on store_issues: **NOT PRESENT** (no status column).

### 1i. Lot / batch / heat / MTC / certificate fields — anywhere
Exhaustive grep (`lot|batch|heat|mtc|mill_test|certificate|cert_no|tc_no|traceab`, case-insensitive) over `apps/api/src/db/schema.ts`, all migrations, `packages/shared/src`, `apps/api/src/modules`, `apps/web/src`:
| Hit | Where | Meaning |
|---|---|---|
| `op_log.tpi_cert_no text` | `schema.ts:1205`; `migrations/0037_phase8_tpi.sql:16`; shared `schemas/tpi.ts:59 certNo` | Third-party-inspection certificate number typed on a QC log — **not** a material certificate |
| `so_milestones.lot_no integer NN` | `schema.ts:1619`; `0056_so_milestones.sql:13`; `schemas/sales-order.ts:99,241` | SO delivery-schedule lot (milestone) number — **not** a material lot |
| "Heat / Lot No." label | `apps/web/src/modules/job-cards/lib/print-job-card.ts:197` — `fact('Heat / Lot No.', '')` | **Printed as an empty box on the JC traveller; no data field behind it** |
| "Test certificates … must accompany the supply" | `packages/shared/src/schemas/print-template.ts:101` | Default PO terms text only |
| `traceability` | `lib/traceability.ts`, `schemas/traceability.ts`, `docs/TRACEABILITY-REPORT.md` | *Document* traceability (Related Documents panel: upstream/downstream by FK) — not material traceability |

Excluded false positives: "heat treat" as an OSP process example (`plan-form.tsx:667`, `osp-processes-panel.tsx:144,280`, `po-type.ts:14`), `batch` in job-queue/bulk-import code, `allot`.
**Heat number, material lot/batch, MTC / mill test certificate number or file, supplier cert link: NOT PRESENT** in any table, schema, form or print (other than the blank printed box above). `tpi_masters` (`schema.ts:689-739`) is an inspector agency master (organization, contact_no, email), not a certificate store. `TraceabilityReports/Innovic-ERP-Document-Traceability-Report.pdf` + `docs/TRACEABILITY-REPORT.md` describe the FK-based Related-Documents panel.

### 1j. Customer / JWSO / party material
- **JWSO = separate table `job_work_orders`** (`schema.ts:1654-1707`; SQL `0007_phase4_sales_chain.sql:30`) + `job_work_order_lines` (`:1708-1800`; SQL `0007:3`) — not a flag on `sales_orders`. Header: code `IN-JW-#####`, jw_date, client_id FK clients, customer_name, client_po_no, status enum so_status (`draft, open, closed, dispatched, cancelled`), gst_percent numeric(5,2) NN '18', remarks, `client_material text`, `client_material_qty numeric(12,2)`, [audit cols]. Lines: line_no, item_id FK items, item_code_text, part_name NN, material text, drawing_no, revision text NN '0', drawing_file_path, uom enum NN 'NOS', order_qty int NN, rate numeric(12,2), returned_qty int NN 0, invoiced_qty int NN 0, due_date, status enum so_status, source_bom_master_id FK bom_masters, [audit cols]. (`sales_orders.so_type` has a value `with_material` — `enums/so-type.ts:1` — described there as legacy/unused for new SOs.)
- **Party material master `party_materials`** — `schema.ts:3686-3743`; SQL `0030_phase8_party_materials.sql:15-40`: code `PM-NNNN` (`party-materials/service.ts:41`), name NN, description, material, `uom text NN 'NOS'` (allowed `NOS, KG, MTR, SET, LOT` — `schemas/party-material.ts:11`), client_id FK clients, client_code_text, item_id FK items (set null), item_code_text, **`stock_qty int NN 0`, `issued_qty int NN 0`, `received_qty int NN 0`**, [audit cols].
- **`party_grn`** `schema.ts:3744-3799`; SQL `0031_phase8_party_grn.sql:19-41`: code `PGRN-` (`party-grn/service.ts:44`), grn_date, job_work_order_id FK (set null), jw_code_text, client_id, client_code_text, client_po_no, dc_no, remarks, received_by_text, [audit cols]. **`party_grn_lines`** `:3800-3857`; SQL `0031:84-105`: party_grn_id FK cascade, line_no, party_material_id FK (set null), party_material_code_text NN, party_material_name, received_qty int NN, jw_line_no_text, remarks, [audit cols].
- **`party_material_issues`** `schema.ts:3858-3913`; SQL `0074_jw_cycle_completion.sql:14-33`: code `IN-PMI-` (`party-material-issues/service.ts:39`), issue_date, job_work_order_id FK, jw_code_text, **job_card_id FK job_cards (set null)**, jc_code_text, party_material_id FK NN, party_material_code_text, party_material_name, qty int NN, remarks, [audit cols].
- **How party stock is tracked: its own balance columns on `party_materials`**, no ledger table. `createPartyGrn` adds `stock_qty += received_qty, received_qty += …` (`party-grn/service.ts:481-489`); `cancelPartyGrn` subtracts with a guard `stock_qty - qty < 0` (`:574,588-589`); `createPartyMaterialIssue` sets `stock_qty -= qty, issued_qty += qty` (`party-material-issues/service.ts:319-320`) after two guards — cannot exceed received-minus-issued for the JW line (`:259-269`) and cannot exceed the JC's order qty (`:274-292`).
- **Does it touch the main stock ledger? No.** `grep storeTransactions|store_transactions` in `party-materials/service.ts`, `party-grn/service.ts`, `party-material-issues/service.ts` → only the header comment `party-material-issues/service.ts:5` ("never writes own-stock store_transactions"). Party stock is invisible to `v_item_stock`.
- **Link to job cards**: `party_material_issues.job_card_id`; and the shop-floor gate — `job_cards.client_material_gate` (`schema.ts:1011`) makes the first op's startable qty capped at issued party material (`loadMaterialCap` `op-entry/service.ts:787`, used at `startOp :2018-2033`).
Services: `party-materials/service.ts` `getNextPartyMaterialCode:62`, `listPartyMaterials:70`, `getPartyMaterial:155`, `createPartyMaterial:183`, `updatePartyMaterial:264`, `softDeletePartyMaterial:348`; `party-grn/service.ts` `getNextPartyGrnCode:65`, `listPartyGrn:73`, `getPartyGrnDetail:200`, `createPartyGrn:273`, `cancelPartyGrn:510`; `party-material-issues/service.ts` `createPartyMaterialIssue:108`, `cancelPartyMaterialIssue:354`, `listPartyMaterialIssues:475`; `job-work-orders/service.ts` `listJobWorkOrders:227`, `getJobWorkOrder:383`, `getJobWorkOrderRelated:440`, `createJobWorkOrder:720`, `updateJobWorkOrder:870`, `softDeleteJobWorkOrder:1115`.
Routes: `/party-materials` GET:14, next-code:20, `:id` GET:25 PATCH:39 DELETE:46, POST:31; `/party-grn` GET:14, next-code:20, `:id`:25, POST:31, `POST /party-grn/:id/cancel:40`; `/party-material-issues` GET:14, POST:20, `POST …/:id/cancel:29`; `/job-work-orders` GET:14, `:id`:20, `:id/related`:26, POST:32, PATCH:40, DELETE:47.
UI: `party-materials/routes/list.tsx` (path `party-material`), `party-grn/routes/list.tsx` (path `party-grn`, also hosts `party-material-issues/components/party-material-issue-view.tsx`), `job-work-orders/routes/{list,detail,edit}.tsx` (path `job-work-orders`). Other JW modules: `jw-dc` (outward/inward DC, `jw_dc_outward/_inward` `schema.ts:4036-4258`), `jw-returns` (`jw_return_challans :3914`), `jw-invoices` (`:3976`).

### 1k. Stock valuation / costing
Method: **on-hand × latest purchase rate** — `apps/api/src/modules/stock-valuation/service.ts:2-3` ("rate = the PO rate behind the latest GRN for the item → latest PO line rate → none"). Query `getStockValuation:30`; CTEs `last_grn_rate :40-47` (PO line rate of the latest GRN line for the item) and `last_po_rate :50-55`; `COALESCE(lg.rate, lp.rate, 0)` `:62`; `value = stockQty * rate` `:88`. Rate source columns: `purchase_order_lines.rate numeric(12,2)` (`schema.ts:1989`). **No cost/rate column on `store_transactions` or `item_stock_balances`**; FIFO / weighted average / standard cost: **NOT PRESENT**. `so-costing` module computes SO-level cost from op logs/OSP, not inventory value. Route `GET /stock-valuation:6`; UI `stock-valuation/routes/page.tsx`.

### 1l. QC hold / reject / quarantine status on stock
- Stock status dimension (`quarantine`, `on_hold`, `stock_status`, `hold_qty`): **NOT PRESENT** (grep schema.ts + migrations → 0).
- Rejected incoming qty is simply **not credited** (§1e); it lives only on `goods_receipt_note_lines.qc_rejected_qty`. Accepted qty is credited per inspection (`grn_qc_status` `pending → in_progress → completed`).
- Production rejects are tracked on **`nc_register`** (`schema.ts:2404-2529`; status `pending, disposed, under_rework, under_repair, sent_to_vendor, received_qc_pending, rework_done, closed` — `enums/nc-status.ts:11-20`; disposition `rework, repair, scrap, use_as_is, return_to_vendor, make_fresh` — `enums/nc-disposition.ts:9-16`). `nc-register/*` writes **no** `store_transactions` row (absent from the 19-site list in §1f); return-to-vendor pieces move via a delivery challan (`nc_register.delivery_challan_id`, `rtv_sent_qty` — `0122:37-38`).
- `capa_records` (`schema.ts:5353`) links to NC only.

### 1m. Roles, permissions, RLS pattern, override-with-reason
- **Roles** (`users.role` enum `user_role`): `admin, manager, operator, qc, procurement, dispatch, design, viewer` — `packages/shared/src/enums/user-role.ts:1-10`. Role is **derived** from the access tiers (`roleForAccess`, comment `enums/access-control.ts:136-143`).
- **Access-control model** — `user_access` `schema.ts:5759-5835`: user_id FK users cascade (unique), company_id, full_access bool, auditor bool, drawing_download bool (0121), main_dept text, `departments jsonb` (dept → tier), `forms jsonb` (per-form overrides incl. OFF switches), [audit cols]. RLS: `user_access_self_read`, `user_access_admin_read`, `user_access_admin_write` (`:5804-5818`). Departments `planning, sales, store, design, production, qc, purchase, finance, tasks, reports, system` (`enums/access-control.ts:17-39`); actions `view, entry, edit, approve` (`:51`); tiers L1 Viewer / L2 Data Entry / L3 Editor / L4 Approver / L5 Dept Admin (`:168-208`); form keys incl. `item_create, grn_create, issue_create, toolissue_create, party_create, rawmat_create, prodorder_create, jc_create, plan_create, qc_incoming, op_entry` (`:59-112`). Per-page OFF switches `viewOff/entryOff/editOff/approveOff` in `packages/shared/src/schemas/access-control.ts:77-85`, resolved by `effectiveFormPerms :326-343`.
- **API gate**: `requireFormAccess(user, formKey, action)` — `apps/api/src/lib/access.ts:58-81` (admin bypass `:63`; loads `getMyAccess`; throws `AuthorizationError`). Usage e.g. `incoming-qc/service.ts:501`, `store-issues/service.ts:180`, `production-orders/service.ts:766`. Legacy role guards still used in places: `requireWriteRole` (admin/manager) `lib/auth.ts:8`, `requireAdminRole:14`, `requireOpEntryRole:25`, `requireQcRole:31` — e.g. `reserveStock` uses only `requireWriteRole` (`plans/service.ts:2268`). Price visibility `canSeeFormPrice` `lib/access.ts:83`.
- **Web gate**: `useMyAccess()` `apps/web/src/lib/access-control.ts:21-27` (`GET /access-control/me`) + helpers `canViewForm/canEntryForm/canEditForm/canApproveForm/canDownloadDrawings` re-exported `:30-45`. Access-control admin routes `access-control/routes.ts:12-40`; UI `access-control/routes/list.tsx`.
- **RLS pattern**: every table `.enableRLS()` with `pgPolicy` pairs in `schema.ts`; helper functions `current_company_id()` / `current_user_role()` read `request.jwt.claims` (`migrations/0001_post_init.sql:11-17`). `withUserContext` opens `db.transaction` and runs `select set_config('request.jwt.claims', <claims json>, true)` (`apps/api/src/db/with-user-context.ts:26-40`). **But the API connects as `postgres` (`.env.example:16-17`, `client.ts:8`), which bypasses RLS** — stated in code at `enums/access-control.ts:139-142`: "The API connects as a role that bypasses RLS, so those policies never run, and the `require*Role` guards in the services are the only enforcement there is." RLS is effective only for direct Supabase client access (e.g. Storage: `0041:43-61`). Policies that grant per-role writes: `op_log_operator_insert/qc_insert/manager_insert` (`schema.ts:1245-1264`), `goods_receipt_note_lines_qc_update` (`:2260`), `running_ops_operator_write` (`:1385`).
- **Override-with-reason**: a general "override a rule with a reason" mechanism is **NOT PRESENT**. Reason-bearing actions that exist: PR balance short-close — `purchase_requests.balance_closed_reason` NN-when-closed CHECK (`schema.ts:1841,1877`; input `schemas/purchase-request.ts:217`); PR reject reason (`:226`, stored in remarks); PO `rejection_reason` (`:1935`); op-log time-change request `reason` + `decision_reason` with approval flow (`op_log_time_change_requests` `:1267-1336`, gated by `approval_config.op_entry_edit_approval`); party GRN cancel reason (`schemas/party-grn.ts:82`, `party-grn/service.ts:523-524`, stored in activity log); party issue cancel reason (`schemas/party-material-issue.ts:80`); NC `reason` (defect description, `:2433`); DC receipt `reject_reason` required when rejected_qty > 0 (`:2729,2752`); design-tracker status change reason (`schemas/design-tracker.ts:108`).
- **Approval config** — `approval_config` `schema.ts:5836-5888`: po_approval bool (default true), po_manager_limit numeric(14,2) 100000, pr_approval bool, invoice_approval bool, op_entry_edit_approval bool, po_approvers jsonb; one row per company.

### 1n. Audit / activity log
- **`activity_log`** — `schema.ts:3130-3170`: id, company_id, ts timestamptz NN now(), user_id FK users (set null), user_name text NN, action text NN, entity text NN, detail text NN '', ref_id text, created_at, created_by. Indexes on (company_id, ts / action / user_id). No before/after JSON, no IP — free-text `detail` only.
- Writer: `emitActivityLog(tx, {action, entity, detail?, refId?}, companyId, user)` — `apps/api/src/modules/activity-log/service.ts:154-173` (inserts one row inside the caller's transaction; `user_name = user.email`). Invocation: **explicit call per service**, 37 modules import it (`grep -rl emitActivityLog apps/api/src/modules | wc -l` = 37). Not a Fastify hook, not a DB trigger. Examples: `startOp` `op-entry/service.ts:2139`, `closeProductionOrder` `production-orders/service.ts:869`.
- DB-level audit triggers: **NOT PRESENT** (only `set_updated_at` + the balance trigger; grep `audit` in migrations → none).
- Soft delete / trash: 84 tables have `deleted_at` (`grep -c "deletedAt: timestamp('deleted_at'" schema.ts` = 84). Trash module `trash/service.ts` `listTrash:123`, `restoreFromTrash:184`, `permDeleteTrash:223`, `emptyTrash:263`; routes `GET /trash:7`, `POST /trash/restore:13`, `POST /trash/perm-delete:19`, `POST /trash/empty:25`; UI `trash/routes/list.tsx`. Route `GET /activity-log:7`; UI `activity-log/routes/list.tsx`.

### 1o. Finished goods credit + Production Order close
Two mutually exclusive credit paths, both `txn_type='in'` on `store_transactions` for `job_cards.item_id`:
1. **Production-Order JCs** (`job_cards.production_order_id` set, or any ancestor via `parent_job_card_id` — `apps/api/src/lib/production-order-link.ts`): credited **once** by `closeProductionOrder` — `apps/api/src/modules/production-orders/service.ts:761-880`. Conditions (`closeBlockedReason` `apps/api/src/lib/production-order-close-guard.ts:44-57`): PO `status='open'` (`:45`); linked JC `v_jc_status.computed_status ∈ ('complete','closed')` **or** JC "settled with losses" (`:47`, SQL `jcSettledWithLossesSql` `production-orders/service.ts:215`); finished qty > 0 unless settled-with-losses (`:53`). Locks the PO row `FOR UPDATE` (`:771-781`), refuses if already closed (`:783-785`), reads the snapshot after the lock (`:790-791`), qty = `snap.finishedQty` = last live op output (`lastOpFinishedQtySql :127`: `qc_accepted_qty` for a QC/qc_required op else `completed_qty`); total loss → no ledger row, `credited_qty=0` (`:808-811`); otherwise items `FOR UPDATE` (`:818-820`), insert with `source_type='production_order_close'`, `source_ref=<PO code>` (`:828-840`); then `production_orders.status='closed', closed_at, closed_by, credited_qty` (`:844-859`); `job_cards.closed_at` set if null (`:862-867`); activity log `CLOSE` (`:869`). Permission `requireFormAccess(user,'prodorder_create','edit')` (`:766`).
2. **All other JCs**: credited automatically on the **QC accept of the LAST op** by `tryApplyQcStockCascade` — `apps/api/src/modules/op-entry/qc-stock-cascade.ts:126-215`: fires only when `ctx.opSeq` is the highest live `jc_ops.op_seq` (`:131-140`); needs `job_cards.item_id` (`:142-148`); skipped for PO-linked JCs (`:150`); items `FOR UPDATE` (`:153`); inserts `source_type='qc_accept'`, `source_ref='<JC code> Op #n'`, qty = accepted qty of that QC log (`:181-195`). Called from `submitQcLog` (`op-entry/service.ts:1197`). If the last op is an OSP op, the credit instead comes from `creditGrnQcStock` (§1e). JC close: `tryCascadeJcComplete` / `finishJc` set `job_cards.closed_at` when the JC reaches `complete` — `op-entry/sales-cascade.ts:96,187-196`; `cascadeJcCompleteUpChain:235` walks rework parents.
Consumption of raw material at either point: **NOT PRESENT** — neither path writes an `out` row for any input item (no BOM explosion, no backflush; `assembly/stock-cascade.ts` consumes *components* only for Equipment-SO assembly units).

### 1p. Where an operation is started on the shop floor
`startOp(input, user)` — `apps/api/src/modules/op-entry/service.ts:2004-2220`. Route `POST /op-entry/start` (`op-entry/routes.ts:92`). UI: `apps/web/src/modules/op-entry/routes/index.tsx` (path `op-entry`) and `op-entry/routes/running.tsx` (path `op-entry/running`); Job Queue / JC list Start buttons (`job-cards/components/jc-row-write-actions.tsx`).
Preconditions in order: role `requireOpEntryRole` + tier `requireFormAccess('op_entry','entry')` (`:2005-2006`); start date not in future (`:2008`); op is not `outsource` (`:2012-2014`); **`v_jc_op_status.available > 0`** via `loadAvailability` (`:2015-2018`, function `:747-760` — this is the "upstream cleared qty" check); JWSO client-material cap `loadMaterialCap` (`:2019-2033`); QC op must have no machine, process op must name the actual machine (`:2035-2056`). Writes: `running_ops` row (`status='running', machine_id, operator_id/name, start_date, start_time, shift`) `:2068-2091` — unique-violation → "already running OR machine busy" (`:2085-2088`); `op_log` row `log_type='start', qty=0` (`:2093-2109`); activity log `OP_START` (`:2139`). **No raw-material check and no stock movement at start.** Stop = `stopOp :2254` (`POST /op-entry/running-ops/:id/stop:105`); production log = `submitOpLog :1152` (`POST /op-entry/op-log:48`) → `writeProductionLog :972`.

### 1q. Concurrency: transactions, row locks, idempotency used for stock today
- **Transactions**: every service write runs inside `withUserContext` → `db.transaction(...)` (`apps/api/src/db/with-user-context.ts:36-39`); the ledger insert and the document write share that tx (e.g. `store-issues/service.ts:184-283`).
- **Row locks**: `SELECT 1 FROM public.items WHERE id = … FOR UPDATE` before every on-hand read+write — `goods-receipt-notes/cascades.ts:341`, `store-issues/service.ts:197`, `store-inventory/service.ts:227`, `plans/service.ts:2255`, `op-entry/qc-stock-cascade.ts:153`, `production-orders/service.ts:818-820`; Drizzle `.for('update')` on the PO row (`production-orders/service.ts:781`) and plan row (`:545`). 36 lock sites in total (`grep -rn "for('update')\|FOR UPDATE" apps/api/src/modules apps/api/src/lib` = 36). `pg_advisory_*` / `SKIP LOCKED`: **NOT PRESENT**.
- **Idempotency** (ADR-172, migration 0135): table `idempotency_keys` `schema.ts:6142-6160` (user_id, key, method, path, status_code, response_body jsonb, created_at, completed_at; unique (user_id,key)); Fastify plugin `apps/api/src/plugins/idempotency.ts` registered `server.ts:128`, reads header `idempotency-key` (`:191`) on POST/PUT/PATCH/DELETE (`:9`), replays with `idempotent-replayed: true` (`:244`), rejects a key reused for a different request (`:236`); the web client sets a random key on every non-GET call (`apps/web/src/lib/api.ts:72-73`).
- **Double-post prevention on the ledger itself**: unique index on `store_transactions (source_type, source_ref)`: **NOT PRESENT** (only non-unique indexes `:2290-2294`). Double-credit is prevented by state, not by constraint: GRN lines by `qc_accepted_qty` arithmetic (`incoming-qc/service.ts:534-546`), PO close by `status` under `FOR UPDATE`, last-op QC by qty accounting in `v_jc_op_status`.
- **Optimistic version column: NOT PRESENT** (no `version`/`row_version` column in schema.ts).
- Unique-violation retry helper `withUniqueRetry` `apps/api/src/lib/db-retry.ts:26-40` (5 attempts) is used by code generators in `production-orders, items, clients, vendors, machine-groups, material-grades, material-sizes, operators, sales-orders, so-planning, job-work-orders` — **not** by `nextJcCode`, `nextGrnCode`, `nextStoreIssueCode`, `nextPlanCode` (they rely on the partial unique index to fail the second inserter).

### 1r. Document numbering — how codes like `IN-PRO-#####` are generated
- **No numbering table / sequence.** Every generator does `MAX(numeric suffix)+1` over the document table for the company inside the write transaction, then pads.
- Central format registry `DOC_NUMBER_FORMATS` — `packages/shared/src/schemas/doc-number.ts:34-41`: `sales_order IN-SO-` (5), `job_work_order IN-JW-` (5), `purchase_order IN-PO-` (5; per-type series `IN-MPO- / IN-JWPO- / IN-SPO- / IN-OPO-` `:50-53`, legacy `PO_LEGACY_PREFIX`), `grn IN-GRN-` (5), `delivery_challan IN-DC-` (5), **`production_order IN-PRO-` (5)**. Server preview/check: `computeNext` `apps/api/src/modules/doc-numbers/service.ts:60-82` (regex `^<prefix>(\d+)(?:\/R\d+)?`), `checkExists :85-95`, `checkDocNumber :101`; route `GET /doc-numbers/check` (`doc-numbers/routes.ts:9`); table map `TABLE_NAME :26-33`.
- **`IN-PRO-` is PRESENT**: `PO_PREFIX = 'IN-PRO-'` `production-orders/service.ts:72`; `nextProductionOrderCode :97-110` (`LIKE 'IN-PRO-%'`, max+1, `padStart(5,'0')`); the create runs under `withUniqueRetry` (`:536`) so a race on the unique code index is retried (`:537` comment).
- Other series: `IN-JC-YY-#####` per year (`job-cards/service.ts:1291-1305`); `PLN-NNNN` (`plans/service.ts:91-95`); `ISS-NNNNN` (`store-issues/service.ts:49`); `TIS-` tool issues (`tool-issues/service.ts:53`); `PM-` (`party-materials/service.ts:41`); `PGRN-` (`party-grn/service.ts:44`); `IN-PMI-` (`party-material-issues/service.ts:39`); `IN-PR-` via `nextSeriesCode` (`purchase-requests/service.ts:880`, `so-planning/service.ts:1470`); `IN-DC-` (`delivery-challans/service.ts:967`, `nc-register/service.ts:1489`); `IN-JWINV-` (`jw-invoices/service.ts:34`); `ITM-####` (`items/service.ts:124-138`); `GRD-###` / `SZ-####` (§1d); `DSN-` (`design-tracker/service.ts:62`); `TODO-` tasks (0139).

### 1s. File storage — how uploads (e.g. QC reports) are stored and linked
- One private Supabase Storage bucket **`qc-docs`** (created `migrations/0039_phase8_qc_documents.sql:14`); per-company RLS on `storage.objects` — first path segment must equal `current_auth_company_id()`: policies `qc_docs_company_read / insert / delete` `migrations/0041_phase8_qc_docs_company_rls.sql:43-61`. Test `apps/api/src/db/storage-rls.test.ts`.
- **Uploads go browser → Supabase directly** (not through the API): `uploadFile(file, companyId, {folder})` `apps/web/src/lib/storage.ts:13-27` → path `<companyId>/<folder>/<timestamp>-<safe name>` (`:23`), `supabase.storage.from('qc-docs').upload(path, file, {upsert:false})` (`:24`); `signedUrl()` `:30`. Sub-folders in use: `qc-docs`, `item-drawings`, `item-images`. Size/MIME limits: **NOT PRESENT** in code (only `accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"` on the QC Documents form `qc-documents/routes/list.tsx:1116` and `image/*,.pdf` `:1472`).
- API only mints download links: `GET /drawing-files/url` (`drawing-files/routes.ts:10`, bucket const `drawing-files/service.ts:29`, gated by `user_access.drawing_download`), `GET /item-images/url` (`item-images/routes.ts:10`, `item-images/service.ts:32`).
- **Linking columns** (all store the bucket path as text): `goods_receipt_note_lines.qc_report_path / qc_report_name` (`schema.ts:2211-2212`); `op_log.qc_report_path / qc_report_name` (`:1208-1209`); `items.drawing_file_path`, `items.image_path` (`:220,224`); `job_cards.drawing_file_path` (`:970`); `sales_order_lines.drawing_file_path` (0104); `job_work_order_lines.drawing_file_path` (`:1730`); **`qc_documents`** `schema.ts:5465-5533` (job_card_id FK, jc_code_text, sales_order_id FK, so_code_text, category text NN 'qc-docs', doc_type NN, file_name NN, storage_path NN, uploaded_by_text, jc_op_id FK jc_ops, qc_op_name, sr_from/sr_to int, [audit cols]) — routes `qc-documents/routes.ts:12-42`; **`file_registry`** `schema.ts:5534-5622` (sales_order_id, so_line_id, job_card_id, job_work_order_id, jw_line_id, task_id, category, doc_type, file_name, storage_path, file_size, file_type, status, uploaded_by_text) — `so-documents` + `jwso-documents` modules (`so-documents/routes.ts:8-27`).
- A QC report on a GRN line is linked by `goods_receipt_note_lines.qc_report_path` set in `submitIncomingQc` (`incoming-qc/service.ts:570-572`); a QC report on a production QC log by `op_log.qc_report_path`.

---

## 2. SCHEMA DEFINITIONS (original CREATE TABLE SQL from the migration that created each table)

The Drizzle definition (with every later column) is cited per table in §1 by `apps/api/src/db/schema.ts` line range;
the SQL below is the table as first created. Columns added later are listed under each table in §1 ("adds: …").

### `job_cards` — apps/api/src/db/migrations/0004_phase3_op_entry.sql:42-62
```sql
CREATE TABLE IF NOT EXISTS "job_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"jc_date" date NOT NULL,
	"item_id" uuid NOT NULL,
	"order_qty" integer NOT NULL,
	"priority" "jc_priority" DEFAULT 'normal' NOT NULL,
	"due_date" date,
	"drawing_file_path" text,
	"source_so_line_id" uuid,
	"source_jw_id" uuid,
	"source_legacy_ref" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "job_cards_order_qty_positive" CHECK ("job_cards"."order_qty" > 0)
);
```

### `jc_ops` — apps/api/src/db/migrations/0004_phase3_op_entry.sql:7-39
```sql
CREATE TABLE IF NOT EXISTS "jc_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"job_card_id" uuid NOT NULL,
	"op_seq" integer NOT NULL,
	"machine_id" uuid,
	"machine_code_text" text,
	"operation" text NOT NULL,
	"op_type" "op_type" DEFAULT 'process' NOT NULL,
	"cycle_time_min" numeric(10, 2) DEFAULT '0' NOT NULL,
	"program" text,
	"tool_no" text,
	"tool_details" text,
	"qc_required" boolean DEFAULT false NOT NULL,
	"qc_call_date" date,
	"qc_attended_date" date,
	"rework_qty" integer DEFAULT 0 NOT NULL,
	"outsource_vendor_id" uuid,
	"outsource_vendor_text" text,
	"outsource_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
	"outsource_status" "outsource_status",
	"outsource_pr_no" text,
	"outsource_po_no" text,
	"outsource_dc_no" text,
	"outsource_sent_qty" integer DEFAULT 0 NOT NULL,
	"outsource_sent_date" date,
	"outsource_returned_qty" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
```

### `route_cards` — apps/api/src/db/migrations/0004_phase3_op_entry.sql:120-132
```sql
CREATE TABLE IF NOT EXISTS "route_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"item_id" uuid NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
```

### `route_card_ops` — apps/api/src/db/migrations/0004_phase3_op_entry.sql:86-105
```sql
CREATE TABLE IF NOT EXISTS "route_card_ops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"route_card_id" uuid NOT NULL,
	"op_seq" integer NOT NULL,
	"machine_id" uuid,
	"machine_code_text" text,
	"operation" text NOT NULL,
	"op_type" "op_type" DEFAULT 'process' NOT NULL,
	"cycle_time_min" numeric(10, 2) DEFAULT '0' NOT NULL,
	"program" text,
	"tool_no" text,
	"tool_details" text,
	"qc_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
```

### `plans` — apps/api/src/db/migrations/0024_phase8_plans.sql:57-139
```sql
CREATE TABLE IF NOT EXISTS "plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,
  "plan_date" date NOT NULL,
  "plan_status" plan_status NOT NULL DEFAULT 'in_planning',
  "plan_type" plan_type NOT NULL,

  -- Source SO/JW link (per SO LINE; null for standalone manufacture plans)
  "so_line_id" uuid REFERENCES "sales_order_lines"("id") ON DELETE SET NULL,
  "so_code_text" text,
  "line_no" integer,

  -- Item under plan
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "item_name_text" text,

  -- Quantities
  "order_qty" integer NOT NULL,
  "plan_qty" integer NOT NULL,

  -- Schedule
  "planned_start_date" date,
  "planned_end_date" date,

  -- BOM child link (set for Equipment SO sub-plans)
  "bom_master_id" uuid REFERENCES "bom_masters"("id") ON DELETE SET NULL,
  "bom_parent_code" text,
  "bom_child_code" text,

  -- Manufacture / assembly fields
  "jc_id" uuid REFERENCES "job_cards"("id") ON DELETE SET NULL,

  -- Direct-purchase fields
  "dp_vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "dp_vendor_code_text" text,
  "dp_cost" numeric(12,2),
  "dp_remarks" text,
  "dp_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,

  -- Full-outsource fields
  "fo_vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "fo_vendor_code_text" text,
  "fo_process" text,
  "fo_rate" numeric(12,2),
  "fo_material_src" text,
  "fo_delivery_date" date,
  "fo_cost_center" text,
  "fo_remarks" text,
  "fo_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,
  "fo_mat_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,

  -- Material PR for assembly
  "material_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,

  "remarks" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT plans_order_qty_positive CHECK ("order_qty" > 0),
  CONSTRAINT plans_plan_qty_positive  CHECK ("plan_qty" > 0),

  -- (type, status) legal combinations
  CONSTRAINT plans_type_status_check CHECK (
    ("plan_status" != 'jc_created' OR "plan_type" IN ('manufacture', 'assembly'))
    AND
    ("plan_status" != 'pr_created' OR "plan_type" IN ('direct_purchase', 'full_outsource'))
  ),

  -- Status → required FK link present
  CONSTRAINT plans_status_fk_check CHECK (
    ("plan_status" != 'jc_created' OR "jc_id" IS NOT NULL)
    AND
    (NOT ("plan_status" = 'pr_created' AND "plan_type" = 'direct_purchase') OR "dp_pr_id" IS NOT NULL)
    AND
    (NOT ("plan_status" = 'pr_created' AND "plan_type" = 'full_outsource') OR "fo_pr_id" IS NOT NULL)
  )
);
```

### `plan_ops` — apps/api/src/db/migrations/0024_phase8_plans.sql:192-218
```sql
CREATE TABLE IF NOT EXISTS "plan_ops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "plan_id" uuid NOT NULL REFERENCES "plans"("id") ON DELETE CASCADE,
  "op_seq" integer NOT NULL,
  "machine_id" uuid REFERENCES "machines"("id"),
  "machine_code_text" text,
  "operation" text NOT NULL,
  "op_type" op_type NOT NULL DEFAULT 'process',
  "cycle_time_min" numeric(10,2) NOT NULL DEFAULT '0',
  "program" text,
  "tool_details" text,
  "qc_required" boolean NOT NULL DEFAULT false,

  -- Outsource fields (mirror jc_ops shape so PL-4 can copy ops 1:1 on Execute)
  "outsource_vendor_id" uuid REFERENCES "vendors"("id") ON DELETE SET NULL,
  "outsource_vendor_text" text,
  "outsource_cost" numeric(12,2) NOT NULL DEFAULT '0',
  "outsource_pr_id" uuid REFERENCES "purchase_requests"("id") ON DELETE SET NULL,
  "outsource_lead_days" integer,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
```

### `store_transactions` — apps/api/src/db/migrations/0009_phase5_procurement.sql:142-158
```sql
CREATE TABLE IF NOT EXISTS "store_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"txn_date" date NOT NULL,
	"item_id" uuid,
	"item_code_text" text,
	"txn_type" "store_txn_type" NOT NULL,
	"qty" integer NOT NULL,
	"source_type" "store_txn_source_type" NOT NULL,
	"source_ref" text NOT NULL,
	"stock_before" integer NOT NULL,
	"stock_after" integer NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	CONSTRAINT "store_transactions_qty_positive" CHECK ("store_transactions"."qty" > 0)
);
```

### `item_stock_balances` — apps/api/src/db/migrations/0020_phase7_item_stock_table.sql:28-34
```sql
CREATE TABLE IF NOT EXISTS "item_stock_balances" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "item_id" uuid NOT NULL REFERENCES "items"("id") ON DELETE CASCADE,
  "on_hand_qty" integer NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("company_id", "item_id")
);
```

### `store_issues` — apps/api/src/db/migrations/0028_phase8_store_issues.sql:23-46
```sql
CREATE TABLE IF NOT EXISTS "store_issues" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- e.g. ISS-00001
  "issue_date" date NOT NULL,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "item_name" text NOT NULL,
  "qty" integer NOT NULL,
  "issued_to" text NOT NULL,                              -- person / dept / machine
  "ref_type" text,                                        -- Job Card / SO / Production / Maintenance / Other
  "ref_no" text,                                          -- e.g. JC-00001
  "purpose" text,
  "remarks" text,
  "store_transaction_id" uuid REFERENCES "store_transactions"("id") ON DELETE SET NULL,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT store_issues_qty_positive CHECK ("qty" > 0)
);
```

### `goods_receipt_notes` — apps/api/src/db/migrations/0009_phase5_procurement.sql:37-54
```sql
CREATE TABLE IF NOT EXISTS "goods_receipt_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"grn_date" date NOT NULL,
	"purchase_order_id" uuid,
	"po_code_text" text,
	"vendor_id" uuid,
	"vendor_code_text" text,
	"dc_no" text,
	"invoice_no" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone
);
```

### `goods_receipt_note_lines` — apps/api/src/db/migrations/0009_phase5_procurement.sql:7-34
```sql
CREATE TABLE IF NOT EXISTS "goods_receipt_note_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"goods_receipt_note_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"purchase_order_line_id" uuid,
	"item_id" uuid,
	"item_code_text" text,
	"item_name" text NOT NULL,
	"received_qty" integer NOT NULL,
	"dc_ref_no" text,
	"qc_status" "grn_qc_status" DEFAULT 'pending' NOT NULL,
	"qc_accepted_qty" integer DEFAULT 0 NOT NULL,
	"qc_rejected_qty" integer DEFAULT 0 NOT NULL,
	"qc_date" date,
	"qc_remarks" text,
	"qc_inspected_by" uuid,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "goods_receipt_note_lines_received_qty_nonneg" CHECK ("goods_receipt_note_lines"."received_qty" >= 0),
	CONSTRAINT "goods_receipt_note_lines_qc_accepted_qty_nonneg" CHECK ("goods_receipt_note_lines"."qc_accepted_qty" >= 0),
	CONSTRAINT "goods_receipt_note_lines_qc_rejected_qty_nonneg" CHECK ("goods_receipt_note_lines"."qc_rejected_qty" >= 0),
	CONSTRAINT "goods_receipt_note_lines_qc_total_check" CHECK ("goods_receipt_note_lines"."qc_accepted_qty" + "goods_receipt_note_lines"."qc_rejected_qty" <= "goods_receipt_note_lines"."received_qty")
);
```

### `party_materials` — apps/api/src/db/migrations/0030_phase8_party_materials.sql:15-40
```sql
CREATE TABLE IF NOT EXISTS "party_materials" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- e.g. PM-0001
  "name" text NOT NULL,
  "description" text,
  "material" text,                                        -- e.g. EN8, SS 304, MS
  "uom" text NOT NULL DEFAULT 'NOS',                      -- NOS / KG / MTR / SET / LOT
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "client_code_text" text,
  "item_id" uuid REFERENCES "items"("id") ON DELETE SET NULL,
  "item_code_text" text,
  "stock_qty" integer NOT NULL DEFAULT 0,                 -- on-hand
  "issued_qty" integer NOT NULL DEFAULT 0,                -- cumulative
  "received_qty" integer NOT NULL DEFAULT 0,              -- cumulative

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT party_materials_stock_nonneg CHECK ("stock_qty" >= 0),
  CONSTRAINT party_materials_issued_nonneg CHECK ("issued_qty" >= 0),
  CONSTRAINT party_materials_received_nonneg CHECK ("received_qty" >= 0)
);
```

### `party_grn` — apps/api/src/db/migrations/0031_phase8_party_grn.sql:19-41
```sql
CREATE TABLE IF NOT EXISTS "party_grn" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "code" text NOT NULL,                                   -- e.g. PGRN-00001
  "grn_date" date NOT NULL,

  -- JW + Client snapshot (header-level — denormalised for query speed).
  "job_work_order_id" uuid REFERENCES "job_work_orders"("id") ON DELETE SET NULL,
  "jw_code_text" text,
  "client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
  "client_code_text" text,
  "client_po_no" text,

  "dc_no" text,                                           -- DC / Challan No.
  "remarks" text,
  "received_by_text" text,                                -- snapshot of user.name

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz
);
```

### `party_grn_lines` — apps/api/src/db/migrations/0031_phase8_party_grn.sql:84-105
```sql
CREATE TABLE IF NOT EXISTS "party_grn_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "party_grn_id" uuid NOT NULL REFERENCES "party_grn"("id") ON DELETE CASCADE,
  "line_no" integer NOT NULL,

  "party_material_id" uuid REFERENCES "party_materials"("id") ON DELETE SET NULL,
  "party_material_code_text" text NOT NULL,
  "party_material_name" text,

  "received_qty" integer NOT NULL,
  "jw_line_no_text" text,
  "remarks" text,

  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,

  CONSTRAINT party_grn_lines_qty_positive CHECK ("received_qty" > 0)
);
```

### `party_material_issues` — apps/api/src/db/migrations/0074_jw_cycle_completion.sql:14-33
```sql
CREATE TABLE IF NOT EXISTS public.party_material_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  code text NOT NULL,
  issue_date date NOT NULL,
  job_work_order_id uuid REFERENCES public.job_work_orders(id) ON DELETE SET NULL,
  jw_code_text text,
  job_card_id uuid REFERENCES public.job_cards(id) ON DELETE SET NULL,
  jc_code_text text,
  party_material_id uuid NOT NULL REFERENCES public.party_materials(id),
  party_material_code_text text,
  party_material_name text,
  qty integer NOT NULL,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.users(id),
  deleted_at timestamptz
);
```

### `so_stock_reservations` — apps/api/src/db/migrations/0099_so_stock_reservations.sql:19-42
```sql
CREATE TABLE IF NOT EXISTS "so_stock_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  -- The planning line this reserves against. For an SO plan this is the SO line
  -- id; for a JW plan it is the JW line id (mirrors plans.so_line_id usage).
  "so_line_id" uuid NOT NULL,
  "so_code_text" text NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL REFERENCES "items"("id"),
  "item_code_text" text,
  "qty" integer NOT NULL,
  -- 'active' = holding stock; 'released' = returned to general stock;
  -- 'dispatched' = shipped against the SO (Stage 3).
  "status" text NOT NULL DEFAULT 'active',
  "remarks" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "updated_by" uuid NOT NULL REFERENCES "users"("id"),
  "deleted_at" timestamptz,
  CONSTRAINT "so_stock_reservations_qty_positive" CHECK ("qty" > 0),
  CONSTRAINT "so_stock_reservations_status_valid"
    CHECK ("status" IN ('active', 'released', 'dispatched'))
);
```

### `production_orders` — apps/api/src/db/migrations/0133_production_orders.sql:48-87
```sql
CREATE TABLE IF NOT EXISTS production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  status text NOT NULL DEFAULT 'open',

  plan_id uuid NOT NULL REFERENCES plans(id),
  plan_code_text text NOT NULL,
  so_code_text text,
  line_no integer,

  item_id uuid NOT NULL REFERENCES items(id),
  item_code_text text NOT NULL,
  item_name_text text,

  route_card_id uuid NOT NULL REFERENCES route_cards(id),
  route_card_code_text text NOT NULL,
  route_card_revision integer NOT NULL DEFAULT 0,

  job_card_id uuid NOT NULL REFERENCES job_cards(id),
  jc_code_text text NOT NULL,

  order_qty integer NOT NULL,
  target_date date NOT NULL,

  closed_at timestamptz,
  closed_by uuid REFERENCES users(id),
  credited_qty integer,
  remarks text,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES users(id),
  deleted_at timestamptz,

  CONSTRAINT production_orders_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT production_orders_order_qty_check CHECK (order_qty > 0),
  CONSTRAINT production_orders_credited_qty_check CHECK (credited_qty IS NULL OR credited_qty >= 0)
);
```

### `idempotency_keys` — apps/api/src/db/migrations/0135_idempotency_keys.sql:19-29
```sql
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  status_code integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
```

Reservation table: `so_stock_reservations` above is the only reservation table. Store-issue lines table: **NOT PRESENT** (`store_issues` is one item per row). Party GRN header + lines above. Stock balance = `item_stock_balances` above.

---

## 3. SKILLS / AGENTS IN `.claude/`

The `test` worktree's own `.claude/` holds only `agents/form-behaviour.md` + `skills/`. The full agent set is in
`innovicerp/.claude/agents/` (13 files, symlinked as `C:\Innovic_projects\innovic-erp\.claude\agents` and mirrored to
`C:\Users\Asus\.claude\agents`). Descriptions are the frontmatter `description:` (truncated to one line).

| Agent | tools | Purpose (from frontmatter) |
|---|---|---|
| `_house-rules.md` | — (shared preamble, not an agent) | Hard bans (no git in sub-agents, never run api test suite — it deletes PROD job_cards, no db:push/seed, no leftover servers, no scope creep), verification by deploy-gate only, folder ownership, field width, reference-screen rules, no-wheel number inputs |
| `_workflow.md` | — | Requirement → deploy order: trace first, shared-file pre-pass, fan out in one message, one `erp-deploy-gate` pass, fix → retest, deploy |
| `bug-tracer` | Read, Grep, Glob, Bash, Edit, Write, Agent | Investigates ONE bug end-to-end UI → route → service → DB, proves root cause, smallest safe fix, RCA |
| `erp-backend` | Read, Edit, Write, Grep, Glob, Bash | ONE server-side change under `apps/api/` (route/service/validation/migration); never touches web or shared; never runs migrations or api tests; never commits |
| `erp-frontend` | Read, Edit, Write, Grep, Glob, Bash | ONE web change under `apps/web/src/`; enforces universal list search, header chrome, centred table data |
| `erp-deploy-gate` | Read, Grep, Glob, Bash | Pre-deploy check: typecheck, lint, build, blast radius, parallel-terminal dirty files, GO/NO-GO + eyeball list; edits nothing |
| `erp-test` | Read, Edit, Write, Grep, Glob, Bash, Agent | Playwright verification against the live site; may build its own SO → JC → ops data (in PROD); dispatches fixes |
| `erp-module-auditor` | Read, Grep, Glob, Bash, Agent | Functional-parity coordinator for ONE module vs legacy HTML; map → implement → verify loop |
| `erp-work-orchestrator` | Agent, Read, Grep, Glob, Edit | Legacy-migration workflow for ONE page: registry lookup → mapper → refactor; updates page status |
| `form-behaviour` | Read, Edit, Grep, Bash | Dependent-field auto-fill/reset wiring in forms |
| `legacy-canonical-mapper` | Read, Grep, Glob | Read-only element-by-element MATCH/DIFFERENT/MISSING/EXTRA report vs legacy HTML |
| `legacy-page-refactor` | Read, Edit, Grep, Glob, Bash | Refactor ONE React page to match legacy HTML; JSX/CSS only |
| `page-registry-builder` | Read, Grep, Glob, Bash, Write, Edit | Builds/maintains `docs/page-registry.yaml`; never guesses |

Skills (`.claude/skills/`, identical set on `test` and `main`):
| Skill | What it does |
|---|---|
| `dropdown/SKILL.md` | How the type-to-search dropdown ("Client★ (type to search)") opens, filters, keyboard-navigates, selects |
| `searchable-field/SKILL.md` | Wiring steps to make any select/picker searchable using the shared component — never hand-roll |
| `styling/SKILL.md` | List/table + KPI strip rules: single-line short cells, clickable rows, one-row count strip |
| `legacy-canonical-mapper.md` | Strict 1:1 mapping of a UI element to the legacy HTML; surfaces a comparison report; never invents |
| `refactor-page-to-legacy.md` | Refactor one React page to the legacy rendering; one page at a time |

`.claude/settings.local.json` (outer folder) — key `permissions.allow` only (allow-list of read-only Bash commands such as `pnpm --filter web typecheck`, `pnpm --filter web lint`, `pnpm --filter api exec tsc --noEmit`, `psql --version`); no secrets.
User-level `C:\Users\Asus\.claude\skills\` contains only `synced/`.

---

## 4. IN PROGRESS / PENDING

### 4.1 Recent commits on `test` (`git log --oneline -15`)
```
d95a1f6e fix(tasks): QC-call related link compiles on builds without the ?op= register param
12140614 feat(tasks): Task Board becomes Inbox / Outbox / My To-Do / All Tasks (ADR-176)
04c9eeec fix(tasks): daily-report + task-board popups use the app-standard overlay
9135e767 fix(job-cards): rework/repair child card reads Customer Dispatch Date from the parent's plan (ADR-174)
1c888c57 feat(nc): every NC disposition settles the rework chain (ADR-175)
9106667d fix(plans): Customer Dispatch Date review fixes (ADR-174)
a0e2465f feat(plans): Customer Dispatch Date on plans, flowed to PO/JC/dispatch; JC header shows parent/child cards (ADR-174)
d17115b8 feat(auth): the login ends when the last ERP tab closes — next open asks for login
0fd95af2 docs(rules): NEW FIELD — STANDARD FLOW appended to the Rule Book (CLAUDE.md)
d24d766e feat(qc-call-register): pending calls open the QC form as a popup (Op Entry pattern)
a85e2bf3 style(job-cards): header card compacted — smaller KPI tiles, tighter meta and reference rows
e94605bf style(lists): row thumbnail 48px on every list; SO lines table gets fixed column widths
76aae992 style(job-cards): header columns rebalanced — five KPI tiles across, references no longer wrap
6cfa14c8 fix(purchase-orders): a PR raised without a vendor ('TBD' / '(vendor TBD)') takes the vendor picked on the PO
caf2e865 fix(item-badge): a row-size badge fills its cell — the picture box sits at one x in every list row (the rule)
```
Latest ADRs: ADR-170 Production Orders (0133), ADR-171 Item Source make/buy (0134), ADR-172 Idempotency-Key (0135), ADR-173 header navigation, ADR-174 Customer Dispatch Date (0137), ADR-175 NC disposition settles the rework chain (0138), ADR-176 Task Board (0139) — `docs/DECISIONS.md:9124-9418`.

### 4.2 Uncommitted work
- `wt-test` (`test`): 18 modified tracked files — `CLAUDE.md` and 17 `apps/web/src/modules/*/routes/list.tsx` / job-card components / `sales-orders/components/so-sheet-table.tsx` / `route-cards/components/print-route-card-button.tsx` (a list-page restyle in progress, `git diff --stat` = 2912+/2099−); 12 untracked: `apps/web/e2e/flow-*.spec.ts` ×9, `apps/web/e2e/testsite-adr168.{config,spec}.ts`, `apps/web/scripts/`.
- `innovicerp` (`main`): 118 modified tracked files (API services, web routes, `apps/api/src/db/schema.ts`, `CLAUDE.md`, `.claude/agents/_house-rules.md` …) belonging to a parallel terminal — **not** to be committed by this session.
- `main` local HEAD `417b0b38` is behind `origin/main` `dcc349ba`.

### 4.3 Migrations: which are applied where — **NOT VERIFIED from the repo**
The repo keeps no applied-migration log (§0.3). A read-only probe of both Supabase projects was prepared but blocked by the session's permission policy (production reads), so the applied state below is taken from prior-session notes, not measured now:
- `0139_task_management` — noted as applied on **both** DBs (Task Board live on PROD as of 2026-09-21).
- `0132_final_inspection_qc_process` — noted as applied on TEST, **pending on PROD**.
- `0117`–`0138` (except 0132/0139) — applied on TEST (the `test` site runs on them); PROD status **NOT VERIFIED**; `main` (the PROD code branch) does not contain these files, so PROD code cannot depend on them yet.
To verify, run against each project: existence checks for `production_orders`, `idempotency_keys`, `jc_op_po_lines`, `items.procurement_type`, `items.image_path`, `plans.customer_dispatch_date`, `route_cards.plan_type`, `nc_register.parent_nc_id`, `tasks.task_type`, enum value `store_txn_source_type.production_order_close`, and the `Final Inspection` row in `qc_processes` (pattern: `docs/sql/check-migrations.sql`).

### 4.4 `docs/TASKS.md` (1591 lines — last "Active Task" entry is REFACTOR-1, dated 2026-07-16)
- Current Phase header still reads "Phase 4 — Sales Chain" (`docs/TASKS.md:87-89`) — stale; the file has not tracked work since July 2026.
- Open items recorded there: `T-034` sales-team cutover, gated on user planning (`:107`); "Continue building modules" (`:109`); REFACTOR-1 "STILL NOT COMMITTED" warning (`:344-345`, historical); **decisions queued for the user** (`:376-391`): hours-vs-minutes unit (ISSUE-177/204), ISSUE-178 gstPercent ADR conflict, Address textarea-vs-input, NC badge divergences, Production Dashboard tiles (ISSUE-074), `.blue` class (ISSUE-110); SQL data checks to run first (`:378-385`).
- `docs/PENDING-TASKS.md` (60 lines): all 19 change requests addressed (14 fixed on `fix/pending-tasks-batch-1`, 4 already-working, 1 data) and verified live 2026-07-28 (`:7-8`); documented follow-ups `:53-57`: T27 SO column on PO detail/list + GRN multi-SO display decision; T33 central gate in `op-entry-form.tsx`; T29 server-side SO search across all plans; T30b route-card data task.
- `docs/PENDING-qc-reject-refactor.md` — QC reject refactor notes (superseded by ADR-175 per commit `1c888c57`; not re-verified here).
- `docs/ISSUES.md`: 273 numbered issues (`## ISSUE-001` … `ISSUE-273`); latest three: ISSUE-271 Tool Issues stock display/guard unportable, ISSUE-272 Stop captures no qty, ISSUE-273 `machines.status` decorative (`docs/ISSUES.md:5582-5665`). No per-issue open/closed roll-up exists in the file header.
- `TODO|FIXME` in `apps/api/src` + `apps/web/src`: 1 hit (excluding the `TODO-` task-code prefix).

### 4.5 Known gaps relevant to a raw-material feature (facts from §1, not recommendations)
- No raw-material item type, no grade/size FK on `items`, no lot/heat/MTC fields, no BOM raw-material quantity or UOM, no location dimension, integer-only quantities, no reservation for JCs, store issues link to job cards by free text only, no store-issue return, no consumption (`out`) at op start / JC close / PO close, incoming-QC rejects of non-JC lines raise no NC, GRN header has no status, RLS is bypassed by the API connection (service guards are the enforcement), applied-migration state is not recorded anywhere in the repo.
