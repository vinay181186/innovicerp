# TASKS.md — Project Task Tracker

> Update at start AND end of every work session.
> Last updated: 2026-04-30 (T-022 — clients module shipped; vendors/machines/operators modules pending)

## Status Legend
- [ ] Not started · [~] In progress · [x] Done · [!] Blocked · [-] Cancelled

## Current Phase
**Phase 2 — Master Data Migration (Week 3)**
Goal: Build the one-time Firestore export → transform → bulk-load pipeline, then migrate users/clients/vendors/items/machines/operators with row-count + sample validation.

## Active Task
**ID:** T-022 (continuing — vendors/machines/operators)
**Title:** Build admin screens for each master entity (web)
**Status:** [~] In progress — clients module done; 3 entities remaining
**Scope:** Per CLAUDE.md §8, build the API + Web modules for `clients`, `vendors`, `machines`, `operators` to mirror the existing `items` reference module. The storage layer, RLS, and migrated data are all in place from T-014/T-015.
**Acceptance:**
- [ ] For each of clients/vendors/machines/operators:
  - [ ] Zod schemas in `packages/shared/src/schemas/<name>.ts` (with `code`, validation rules, etc.)
  - [ ] API module: `apps/api/src/modules/<name>/{routes,service,schema}.ts` + tests (mirror items pattern; CLAUDE.md §9 coverage)
  - [ ] Web module: `apps/web/src/modules/<name>/{api,components,routes}` (mirror items pattern; preserve UI from legacy HTML per memory `feedback_ui_match_legacy_html`)
  - [ ] Add to web nav alongside Items
- [ ] Manual smoke per CLAUDE.md §7 — list/create/edit/soft-delete each entity in production Railway
- [ ] CI green
**Sequencing:** clients first (simplest, 1 record), then vendors, machines, operators. Each takes ~1.5–2h once items pattern is followed.

## Phase 2 carry-over notes (from Phase 1 sign-off)
- **CORS currently permissive** (`origin: true, credentials: true` in `apps/api/src/server.ts`). Acceptable while web is local-only; **tighten to a specific allowlist before Cloudflare Pages web deploy** is wired.
- **CI tests reuse dev Supabase secrets.** Tests prefix-isolate (`T009R-`) and clean up after themselves so this is safe at current scale, but **provision a separate CI/staging Supabase project before Phase 4** (sales chain) — test data volume + concurrency will grow.
- **Smoke session behaviour to confirm in Phase 2:** when a non-admin (`viewer`) attempts a write, the API returns an error — confirm whether it's a clean 403 (handled by service-layer role check) or a 500 leaking a Postgres RLS error. If 500, add explicit role checks in `apps/api/src/modules/items/service.ts` and propagate `AuthorizationError`. (Tracked as a Phase-2 hardening item; user reported "all working" on smoke so write was correctly blocked, but the response-shape detail wasn't captured.)
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
| T-022 | Build admin screens for each master entity (web) | [ ] |
| T-023 | Validation pass: row counts match, sample records identical, no orphaned FKs | [ ] |

## Phase 3 Backlog — Op Entry (Week 4–5, Critical)
| ID | Task | Status |
|---|---|---|
| T-024 | Migrate `jobCards`, `jcOps`, `opLog` data | [ ] |
| T-025 | Build Op Entry screen (TanStack Query optimistic updates + Realtime subscription) | [ ] |
| T-026 | Implement server-side validations (cannot exceed planned qty, cannot skip required QC, etc.) | [ ] |
| T-027 | Run parallel mode (operators in BOTH systems, end-of-day reconciliation, 5 working days) | [ ] |
| T-028 | Cutover operators to new system only | [ ] |

## Phase 4 Backlog — Sales Chain (Week 6–7)
| ID | Task | Status |
|---|---|---|
| T-029 | Migrate `sales_orders`, `sales_order_lines`, `job_work_orders` | [ ] |
| T-030 | Build SO list / detail / create / edit screens | [ ] |
| T-031 | Build JW list / detail screens | [ ] |
| T-032 | Build JC list with filtering (status, machine, operator) | [ ] |
| T-033 | Implement server-side cascade (SO status auto-updates from JC completion — fixes existing bug) | [ ] |
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
| T-012 | Full CI test job | Pending CI secrets | Add `CI_DATABASE_URL`, `CI_DATABASE_URL_POOLED`, `CI_SUPABASE_URL`, `CI_SUPABASE_ANON_KEY`, `CI_SUPABASE_SERVICE_ROLE_KEY`, `CI_SUPABASE_JWT_SECRET` in GH repo settings |

## Recently Completed (last 10)
| Date | ID | Task |
|---|---|---|
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
