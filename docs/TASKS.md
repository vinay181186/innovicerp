# TASKS.md — Project Task Tracker

> Update at start AND end of every work session.
> Last updated: 2026-04-29 by first session

## Status Legend
- [ ] Not started · [~] In progress · [x] Done · [!] Blocked · [-] Cancelled

## Current Phase
**Phase 1 — Foundation (Week 1–2)**
Goal: Working dev environment, schema deployed, auth working, Items master end-to-end as the reference template.

## Active Task
**ID:** T-007
**Title:** Bootstrap React app (Vite, Tailwind, shadcn/ui, TanStack Query, TanStack Router)
**Status:** [ ] Not started
**Acceptance:**
- [ ] `apps/web/src/main.tsx` mounts a real React tree; index.html boots without errors
- [ ] Tailwind compiles (`@tailwind base/components/utilities` in entry CSS); `tailwind.config.ts` content paths correct
- [ ] TanStack Router skeleton (file-based or code-based routes; one root route for now)
- [ ] TanStack Query provider wraps the tree; `apiClient` helper in `src/lib/api.ts` uses `VITE_API_URL` and attaches Supabase access token
- [ ] At least one shadcn/ui component installed and rendering (Button, e.g.) to validate the styling pipeline
- [ ] `pnpm --filter web dev` serves at `http://localhost:5173` and the page renders without console errors

## Phase 0 Backlog (Bootstrap)
| ID | Task | Status |
|---|---|---|
| T-001 | Initialize repository structure | [x] Done (2026-04-29) |

## Phase 1 Backlog
| ID | Task | Status |
|---|---|---|
| T-002 | Provision Supabase project (dev only — Mumbai `ap-south-1`, Pro tier, pooler `aws-1-ap-south-1`, pg 17.6, connection verified) | [x] Done (2026-04-29) |
| T-003 | Design Phase 1 schema in `docs/SCHEMA.md` (companies, users, items + RLS helpers) | [x] Done (2026-04-29) |
| T-004 | Build Drizzle schema definitions in `apps/api/src/db/schema.ts` (mirror SCHEMA.md) | [x] Done (2026-04-30) |
| T-005 | Configure Drizzle migrations + seeding (drizzle-kit); applied to dev | [x] Done (2026-04-30) |
| T-006 | Bootstrap Fastify API (server, auth plugin, error handler, Pino logger) | [x] Done (2026-04-30) |
| T-007 | Bootstrap React app (Vite, Tailwind, shadcn/ui, TanStack Query, TanStack Router) | [ ] |
| T-008 | Implement auth flow end-to-end (login, JWT, protected routes, RLS session claims) | [ ] |
| T-009 | Build Items master module — API (routes, service, schema, tests) | [ ] |
| T-010 | Build Items master module — Web (api hooks, list/detail/create/edit) | [ ] |
| T-011 | Set up CI/CD via GitHub Actions (typecheck, lint, test, deploy) | [ ] |
| T-012 | Phase 1 sign-off: Items master fully working with RLS verified across roles | [ ] |

## Phase 2 Backlog — Master Data Migration (Week 3)
| ID | Task | Status |
|---|---|---|
| T-013 | Build one-time Firestore export script (`migration/export-firestore.ts`) | [ ] |
| T-014 | Build transformation script (JSON-blob → per-record rows, UUID + UID mapping) | [ ] |
| T-015 | Build bulk-load script in FK dependency order (`migration/load-supabase.ts`) | [ ] |
| T-016 | Migrate `users` (Firebase Auth UIDs → Supabase users) | [ ] |
| T-017 | Migrate `clients` master | [ ] |
| T-018 | Migrate `vendors` master | [ ] |
| T-019 | Migrate `items` master | [ ] |
| T-020 | Migrate `machines` master | [ ] |
| T-021 | Migrate `operators` master | [ ] |
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
| T-011 | CI/CD deploy | API hosting choice | Decide Railway vs Hetzner CCX13 (ADR-009 pending) |
| Future | Staging + prod Supabase | Defer | Provision when Phase 4 (sales chain) is in flight |

## Recently Completed (last 10)
| Date | ID | Task |
|---|---|---|
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
