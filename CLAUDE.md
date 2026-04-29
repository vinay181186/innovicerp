# CLAUDE.md — Innovic ERP Project Memory

> **READ THIS FILE COMPLETELY AT THE START OF EVERY SESSION.**
>
> This is your project memory. It contains everything you need to know to work on Innovic ERP. You also create and maintain the supporting reference files described in Section 2 — they don't exist yet on first run; you create them on first run.
>
> If a request conflicts with anything here, stop and ask the user before proceeding.

---

## Section 0 — Mandatory Behavior on Every Session

### At the start of every session, you MUST:

1. **Read this file (CLAUDE.md) completely.**
2. **Check if `docs/TASKS.md` exists.**
   - If NO → this is the first session. Run the **First Session Bootstrap** in Section 3.
   - If YES → read `docs/TASKS.md`, `docs/DECISIONS.md`, and `docs/SCHEMA.md` to load context.
3. **State out loud in your first message:** "I have loaded CLAUDE.md. Last task per TASKS.md: <X>. Next task: <Y>. Ready to proceed." This proves to the user you have context.
4. **Confirm the active task** with the user before starting work.

### After completing any meaningful work, you MUST:

1. **Update `docs/TASKS.md`** — mark current task done, set the next one.
2. **Append to `docs/DECISIONS.md`** if you made a non-trivial technical decision.
3. **Update `docs/SCHEMA.md`** if you changed the database schema.
4. **Update `docs/RUNBOOK.md`** if you added an operational procedure.
5. **Run all tests** before declaring work complete (Section 9).
6. **Show a diff summary** before any git commit. Never auto-commit.

### If you skip any of these steps:
The user has explicitly asked you to be reminded. They will say "follow CLAUDE.md" and you must restart from Section 0.

---

## Section 1 — Project Identity

- **Project:** Innovic ERP — manufacturing ERP for a job-shop environment
- **Migration source:** A 29,000-line single HTML file backed by Firebase Firestore (single-document-per-collection JSON-blob anti-pattern)
- **Migration destination:** This codebase
- **User scale:** 15–20 concurrent users today, must scale to 100 without rearchitecting
- **Data scale:** ~50 GB ultimate (5–15 GB Postgres, 35–45 GB file storage)
- **Region:** Mumbai (ap-south-1) — all data and compute stays in India
- **Timezone:** All timestamps stored in UTC, displayed in IST (`Asia/Kolkata`)
- **Original HTML file location:** `legacy/InnovicERP_v82_12_2_AuditFix.html` (after First Session Bootstrap moves it there). This file is the **specification source** — when in doubt about what a feature should do, read it.

---

## Section 2 — Reference Files You Maintain

These files are part of your project memory. You create them on the first session, then keep them updated.

| File | Purpose | When to update |
|---|---|---|
| `CLAUDE.md` | THIS FILE — the master spec. | Only when the user explicitly approves a change to project-wide rules. |
| `docs/ARCHITECTURE.md` | System design, component diagram, deployment topology. | When the architecture changes. |
| `docs/SCHEMA.md` | Living database schema — every table, column, index, RLS policy. Mirror of `apps/api/src/db/schema.ts`. | On every schema change, in the same commit. |
| `docs/TASKS.md` | Running task tracker: done, in-progress, blocked, next. | At the start AND end of every work session. |
| `docs/DECISIONS.md` | Append-only ADR log of architectural decisions. | When making any non-trivial technical choice. |
| `docs/CONVENTIONS.md` | Coding standards — naming, structure, error handling, etc. | When establishing or changing a convention. |
| `docs/RUNBOOK.md` | Operational procedures — deploy, restore, debug. | When you create or change an ops process. |
| `docs/MIGRATION-LOG.md` | Per-collection Firebase → Supabase migration record (row counts, anomalies, validation reports). | After each collection is migrated. |

**Rule:** any time you write something the user (or future-you) will need to remember, it goes in one of these files. Do not rely on the chat context.

---

## Section 3 — First Session Bootstrap

If `docs/TASKS.md` does not exist, this is your first session. Execute these steps in order. Show progress to the user, ask before destructive actions.

### Step 1 — Initialize repository
```bash
# In the project root
git init
echo "node_modules/\ndist/\n.env*\n!.env.example\n.DS_Store\ncoverage/\n*.log" > .gitignore
```

### Step 2 — Create the directory structure (Section 4)
Create every folder and placeholder file listed in Section 4. Use `mkdir -p` and `touch`.

### Step 3 — Move the legacy HTML file
If a file matching `InnovicERP_*.html` is in the project root, move it:
```bash
mkdir -p legacy
mv InnovicERP_*.html legacy/
```
If not present, ask the user where it is. Do not proceed without it — it's the spec source.

### Step 4 — Create the supporting reference docs
Create `docs/ARCHITECTURE.md`, `docs/SCHEMA.md`, `docs/TASKS.md`, `docs/DECISIONS.md`, `docs/CONVENTIONS.md`, `docs/RUNBOOK.md`, `docs/MIGRATION-LOG.md` with the **starter content templates in Section 14** of this file. Don't leave them empty.

### Step 5 — Initialize the monorepo
```bash
# Root package.json
pnpm init
# Edit package.json: add "private": true, set workspace
echo 'packages:\n  - "apps/*"\n  - "packages/*"' > pnpm-workspace.yaml
```

### Step 6 — Create the first three tasks in TASKS.md
- T-001: Initialize repository structure (mark done after this bootstrap)
- T-002: Provision Supabase project (dev + staging + prod)
- T-003: Apply complete schema to Supabase dev

### Step 7 — Append the bootstrap decision to DECISIONS.md
Use ADR-001 template from Section 14.

### Step 8 — First commit
```bash
git add .
git status   # show user
# wait for user approval, then:
git commit -m "chore: initial project bootstrap per CLAUDE.md"
```

### Step 9 — Confirm with the user
"Bootstrap complete. Repository initialized. Reference docs created in `docs/`. Ready to start T-002 (provision Supabase). Proceed?"

---

## Section 4 — Repository Structure (Hard Rule)

You create this structure during First Session Bootstrap. After that, every new module follows it exactly.

```
innovic-erp/
├── apps/
│   ├── api/                    # Fastify backend
│   │   ├── src/
│   │   │   ├── modules/        # ONE FOLDER PER ERP MODULE
│   │   │   │   └── <module>/
│   │   │   │       ├── routes.ts       # Fastify route declarations only
│   │   │   │       ├── service.ts      # Business logic (only place it lives)
│   │   │   │       ├── schema.ts       # Zod schemas (or re-export from shared)
│   │   │   │       ├── service.test.ts # Unit tests
│   │   │   │       └── routes.test.ts  # Integration tests
│   │   │   ├── db/
│   │   │   │   ├── schema.ts   # Drizzle table definitions (entire DB)
│   │   │   │   ├── client.ts   # Drizzle client setup
│   │   │   │   └── migrations/ # Generated by drizzle-kit
│   │   │   ├── lib/            # auth, errors, logger, helpers, permissions
│   │   │   ├── plugins/        # Fastify plugins (auth, error handler, etc.)
│   │   │   └── server.ts       # App entry point
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── web/                    # React frontend
│       ├── src/
│       │   ├── modules/        # MIRRORS apps/api/src/modules/ exactly
│       │   │   └── <module>/
│       │   │       ├── api.ts          # TanStack Query hooks
│       │   │       ├── components/     # Module-specific components
│       │   │       ├── routes/         # Route components
│       │   │       └── schemas.ts      # Re-exports from shared
│       │   ├── components/ui/  # shadcn/ui components (copied, owned)
│       │   ├── components/shared/ # Shared app components
│       │   ├── lib/            # API client, auth helpers, utils
│       │   └── main.tsx
│       ├── index.html
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   └── shared/                 # Types + Zod schemas shared between api and web
│       ├── src/
│       │   ├── schemas/        # Zod schemas — single source of truth
│       │   ├── types/          # Inferred TypeScript types
│       │   └── enums/          # Shared enums (statuses, roles, etc.)
│       ├── tsconfig.json
│       └── package.json
│
├── migration/                  # ONE-TIME Firebase → Supabase migration scripts
│   ├── export-firestore.ts
│   ├── transform.ts
│   ├── load-supabase.ts
│   └── README.md
│
├── legacy/
│   └── InnovicERP_v82_12_2_AuditFix.html  # SPEC SOURCE — DO NOT MODIFY
│
├── docs/                       # YOUR PERSISTENT MEMORY — KEEP UPDATED
│   ├── ARCHITECTURE.md
│   ├── SCHEMA.md
│   ├── TASKS.md
│   ├── DECISIONS.md
│   ├── CONVENTIONS.md
│   ├── RUNBOOK.md
│   └── MIGRATION-LOG.md
│
├── .github/workflows/          # CI/CD
│   ├── ci.yml
│   └── deploy.yml
│
├── CLAUDE.md                   # ← THIS FILE
├── README.md
├── package.json                # Workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .eslintrc.cjs
├── .prettierrc
├── .gitignore
└── .env.example
```

**Hard rule:** every new ERP module gets a folder under `apps/api/src/modules/` AND `apps/web/src/modules/` with the file structure above. No exceptions, no consolidation, no shortcuts.

---

## Section 5 — The Stack (Locked Choices)

These choices are NOT up for debate. Do not suggest alternatives. Do not "improve" them mid-project. If something seems wrong, ask first.

### Backend
- **Language:** TypeScript (strict mode, no `any` without comment justification)
- **Runtime:** Node.js 24 (current). Originally specified as Node 20 LTS; upgraded to 24 by user decision — see ADR-008 in `docs/DECISIONS.md`.
- **Framework:** Fastify 4.x
- **ORM:** Drizzle ORM (NOT Prisma, NOT TypeORM, NOT Knex)
- **Validation:** Zod (every route input + output validated)
- **Logging:** Pino (structured JSON, never `console.log`)
- **Auth:** Supabase Auth (JWT-based, validated server-side)
- **Job queue:** BullMQ + Redis (only when async jobs are actually needed; not premature)
- **Testing:** Vitest + Supertest

### Frontend
- **Framework:** React 18 + Vite 5 + TypeScript
- **Routing:** TanStack Router (NOT React Router)
- **Data fetching:** TanStack Query v5 (NOT SWR, NOT raw fetch)
- **State:** Zustand (NOT Redux, NOT Context for high-frequency updates)
- **Forms:** react-hook-form + Zod resolver
- **Styling:** Tailwind CSS + shadcn/ui (NOT Material UI, NOT Chakra)
- **Tables:** TanStack Table
- **Testing:** Vitest + React Testing Library + Playwright (e2e on critical flows only)

### Database & Infrastructure
- **Database:** Supabase Postgres 15 (Mumbai region, `ap-south-1`)
- **File storage:** Supabase Storage (S3-compatible)
- **Realtime:** Supabase Realtime (selective use, not everywhere)
- **API hosting:** Railway (default) or Hetzner CCX13 (alt) — confirm with user in DECISIONS.md
- **Frontend hosting:** Cloudflare Pages
- **Email:** Resend
- **Error tracking:** Sentry (free tier)
- **Uptime monitoring:** Better Stack
- **Offsite backup:** Backblaze B2 (daily `pg_dump`)

### Tooling
- **Monorepo:** pnpm workspaces (NOT npm workspaces, NOT Yarn)
- **Linting:** ESLint + Prettier
- **Type checking:** `tsc --noEmit` runs in CI
- **CI/CD:** GitHub Actions
- **Migrations:** Drizzle Kit (`drizzle-kit generate` + `drizzle-kit migrate`)

---

## Section 6 — The Ten Non-Negotiable Engineering Rules

Violated only with explicit user approval. They override convenience.

1. **No business logic in the frontend.** The React app shows data and submits intents. Validation, calculations, authorization happen server-side. The browser is hostile and inspectable.
2. **Every write goes through a service layer.** Routes call `service.doX()`, never the ORM directly. Services are independently testable.
3. **Every table has `company_id`, `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at`, and an RLS policy.** No exceptions, even for "internal" or "settings" tables.
4. **Daily automated `pg_dump` to a second provider** (Backblaze B2). Restore drill on the first Monday of every month.
5. **All times stored as `timestamptz` in UTC, displayed in IST.** Use `date-fns-tz` on the frontend with `Asia/Kolkata`.
6. **No `SELECT *`. No N+1 queries.** Drizzle makes both visible — review them and reject in PRs.
7. **Structured JSON logs only (Pino).** Never `console.log` in committed code.
8. **No hard deletes — only soft deletes** (`deleted_at` timestamp). Hard deletes only via documented admin scripts after a backup.
9. **Schema changes via Drizzle migrations only.** Never modify production schema in Supabase Studio. All migrations PR-reviewed and version-controlled.
10. **Secrets in environment variables only.** Never in code, never in CLAUDE.md, never in any file under git. Use `.env.local` for dev, platform env vars for prod.

---

## Section 7 — Workflow Rules — How You Operate

### Before starting any task

1. **State the task** in your own words to confirm understanding.
2. **List the files you will read** for context, then read them.
3. **List the files you will create or modify**, with a one-line justification each.
4. **Wait for the user's approval** for non-trivial work (anything beyond a single file edit or a documentation update).

### While working

- **One module at a time.** Never modify code across more than one module per task unless the task explicitly requires it.
- **Small commits.** Each logical unit of work = one commit. Don't batch unrelated changes.
- **Match existing patterns.** Before writing new code, find a similar existing module and mirror its structure exactly.
- **Ask, don't guess.** If a requirement is ambiguous, stop and ask. Never invent business rules.
- **Pause every 30 minutes of work.** Summarize what you've done, ask if you should continue.

### Before declaring work complete

Run through this checklist explicitly in your reply:

- [ ] All tests pass (`pnpm test`)
- [ ] TypeScript compiles with no errors (`pnpm typecheck`)
- [ ] Lint passes (`pnpm lint`)
- [ ] No `console.log`, no `any` without justification, no orphan `// TODO` left undocumented
- [ ] `docs/TASKS.md` updated
- [ ] `docs/DECISIONS.md` appended if any decision was made
- [ ] `docs/SCHEMA.md` updated if schema changed
- [ ] All new code follows the file structure in Section 4
- [ ] Diff shown to user before commit

---

## Section 8 — Module Creation Protocol

When asked to build a new ERP module, follow this exact sequence:

1. **Confirm the module's domain** with the user (what entity, what fields, what relationships).
2. **Check `legacy/InnovicERP_*.html`** for existing behavior. Quote the relevant sections.
3. **Update `docs/SCHEMA.md`** with the new table(s), columns, indexes, RLS policies. Get user approval.
4. **Create Drizzle schema** in `apps/api/src/db/schema.ts`.
5. **Generate migration:** `pnpm --filter api drizzle-kit generate`. Review SQL. Apply: `pnpm --filter api drizzle-kit migrate`.
6. **Create Zod schemas** in `packages/shared/src/schemas/<module>.ts`. Re-export inferred types.
7. **Create API module:**
   - `apps/api/src/modules/<module>/service.ts` — business logic
   - `apps/api/src/modules/<module>/routes.ts` — route declarations
   - `apps/api/src/modules/<module>/service.test.ts` — unit tests covering success, validation failure, authorization failure, edge cases
   - `apps/api/src/modules/<module>/routes.test.ts` — integration tests
8. **Run tests** (`pnpm --filter api test`). Tests pass before continuing.
9. **Create Web module:**
   - `apps/web/src/modules/<module>/api.ts` — TanStack Query hooks
   - `apps/web/src/modules/<module>/components/` — forms, tables, etc.
   - `apps/web/src/modules/<module>/routes/` — list view, detail view, create/edit
10. **Run frontend tests** (`pnpm --filter web test`).
11. **Update `docs/TASKS.md`** — mark the task done, propose next.
12. **Show user the diff. Wait for approval before committing.**

---

## Section 9 — Testing Requirements

### What MUST have tests
- **Service layer functions** — unit tests for every public function. Cover: success, validation failure, authorization failure, edge cases.
- **API routes** — integration test for each route hitting a test database (Supabase test schema or local Postgres).
- **Validation schemas** — at least one positive and one negative case per Zod schema.
- **Migration scripts** — fixture-based tests confirming transform output matches expected shape.
- **Critical user flows** — Playwright e2e for: login, create a Job Card, log an Operation, generate a Sales Order.

### What does NOT need tests
- Pure UI components without logic
- Auto-generated code (Drizzle types)
- Trivial getters/setters
- shadcn/ui copied components

### Coverage minimums
- Service layer: **70% statement coverage** (enforced in CI)
- API routes: every route has at least one happy-path and one error-path integration test
- Migration scripts: 100% branch coverage on the transform function

### How to run tests
```bash
pnpm test               # All packages, run once
pnpm test --watch       # Watch mode (use during active dev)
pnpm test --coverage    # Coverage report
pnpm test:e2e           # Playwright e2e (only critical flows)
pnpm typecheck          # Type checking across all packages
pnpm lint               # ESLint across all packages
```

### Test database
- Use a separate Supabase project for tests, OR a local Postgres container.
- Tests run migrations against it before each suite.
- **NEVER run tests against production.**
- Test data: deterministic fixtures in `apps/api/test/fixtures/`. Reset DB between test suites.

### Test file location
Tests live next to the code they test:
- `service.ts` → `service.test.ts`
- `routes.ts` → `routes.test.ts`

NOT in a separate `tests/` folder.

---

## Section 10 — Communication Rules

- **Be direct.** No "great question" or "I'd be happy to."
- **Surface trade-offs.** When making a non-obvious choice, name the alternatives you rejected and why.
- **Show, don't summarize.** Code changes get displayed as diffs, not described in prose.
- **Push back when wrong.** If the user asks for something that violates these rules, name the rule and ask whether to proceed anyway.
- **The user prefers:** clear stances over balanced discussions, operational reality over academic correctness, decisions over options. They are operator-minded — give levers, not lectures.

---

## Section 11 — When You Are Stuck

In order:

1. Re-read the relevant section of CLAUDE.md.
2. Check `docs/DECISIONS.md` — has a similar question been answered before?
3. Check `legacy/InnovicERP_v82_12_2_AuditFix.html` — does the existing system show what the behavior should be?
4. Check the user's earlier messages in this session.
5. **Ask the user.** Do not invent. Do not guess. Do not "leave a TODO" silently.

---

## Section 12 — Anti-Patterns — Do Not Do These

Even if asked, push back before doing any of these:

- **Storing JSON-serialized arrays as a single column.** This is exactly the anti-pattern we're migrating AWAY from. Every record gets its own row.
- **Subscribing to entire collections via Realtime.** Use row-filtered Postgres Realtime subscriptions only.
- **Auth checks in React components.** RLS at the database, role checks in services. Frontend hides UI but never enforces.
- **Cross-module imports without going through a defined interface.** If module A needs data from module B, call B's service function.
- **Adding a library "just to try it."** Every dependency has a maintenance cost. Justify in DECISIONS.md before adding.
- **`any` types.** If you must, leave a `// any: <reason>` comment.
- **Magic numbers in code.** Use named constants in a `constants.ts` file per module.
- **Files over 400 lines.** Split it. Long files are unreviewable.
- **`console.log` in committed code.** Use Pino on the API, a debug helper on the web.
- **Hard deletes from app code.** Soft delete only.

---

## Section 13 — Glossary (Domain Terms)

Use these consistently across code and docs.

- **SO** — Sales Order. Customer order header.
- **JW / JWO** — Job Work Order. Outsourced or internal production order, may roll up under an SO.
- **JC** — Job Card. Production batch on the shop floor for a specific item and quantity.
- **JC Op** — Job Card Operation. A single step in the routing of a Job Card (turning, milling, QC, etc.).
- **Op Log** — Operation Log. Time-stamped entries of work done against a JC Op by an operator.
- **PO** — Purchase Order to a vendor.
- **GRN** — Goods Receipt Note. Records material received against a PO.
- **DC** — Delivery Challan. Document accompanying material movement (in or out).
- **NC** — Non-Conformance. Quality issue logged against a JC Op or item.
- **CAPA** — Corrective and Preventive Action. Follow-up record on an NC.
- **BOM** — Bill of Materials.
- **Route Card** — Sequence of operations defined for an item.
- **Operator** — Shop floor worker (may or may not have a login).
- **OSP** — Outside Processing. External vendor work on a JC Op.

When in doubt about a term, check `legacy/InnovicERP_*.html` for usage in context.

---

## Section 14 — Starter Content for Reference Files

When you create the reference files in `docs/` during First Session Bootstrap, use the templates below.

### `docs/TASKS.md` (starter content)

```markdown
# TASKS.md — Project Task Tracker

> Update at start AND end of every work session.
> Last updated: <date> by <session>

## Status Legend
- [ ] Not started · [~] In progress · [x] Done · [!] Blocked · [-] Cancelled

## Current Phase
**Phase 1 — Foundation (Week 1–2)**
Goal: Working dev environment, schema deployed, auth working, Items master end-to-end as the reference template.

## Active Task
**ID:** T-002
**Title:** Provision Supabase project (dev + staging + prod)
**Status:** [ ] Not started
**Acceptance:**
- [ ] Three Supabase projects created in Mumbai region
- [ ] Connection strings stored in .env.example with placeholders
- [ ] User has logged into each project once

## Phase 1 Backlog
| ID | Task | Status |
|---|---|---|
| T-001 | Initialize repository structure | [x] Done |
| T-002 | Provision Supabase project (dev + staging + prod) | [ ] |
| T-003 | Apply complete schema to Supabase dev | [ ] |
| T-004 | Build Drizzle schema definitions matching SCHEMA.md | [ ] |
| T-005 | Configure Drizzle migrations + seeding | [ ] |
| T-006 | Bootstrap Fastify API (server, auth plugin, error handler, logger) | [ ] |
| T-007 | Bootstrap React app (Vite, Tailwind, shadcn/ui, TanStack Query, Router) | [ ] |
| T-008 | Implement auth flow end-to-end (login, JWT, protected routes) | [ ] |
| T-009 | Build Items master module — API | [ ] |
| T-010 | Build Items master module — Web | [ ] |
| T-011 | Set up CI/CD via GitHub Actions | [ ] |
| T-012 | Phase 1 sign-off: Items master fully working with RLS | [ ] |

## Future Phases
- Phase 2 (Week 3): Master data migration
- Phase 3 (Week 4–5): Op Entry module — critical
- Phase 4 (Week 6–7): Sales chain (SO → JW → JC)
- Phase 5 (Week 8): Procurement (PO → GRN)
- Phase 6 (Week 9): QC, NC, Dispatch
- Phase 7 (Week 10): Reports + dashboards
- Phase 8 (Week 11): Peripheral modules (design, CRM, tools, CAPA)
- Phase 9 (Week 12): Final cutover

## Blockers
| ID | Task | Blocker | Needs |
|---|---|---|---|
| — | — | — | — |

## Recently Completed (last 10)
| Date | ID | Task |
|---|---|---|
| <today> | T-001 | Repository bootstrap |
```

### `docs/DECISIONS.md` (starter content)

```markdown
# DECISIONS.md — Architectural Decision Log

> Append-only. Never edit or delete past entries.

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

## ADR-001: Use Supabase over self-hosted or AWS
**Date:** <today>
**Status:** Accepted

### Context
Existing system uses Firebase Firestore with a JSON-blob anti-pattern. Need a relational database supporting concurrency, transactions, reporting.

### Decision
Supabase Pro (Mumbai region) for Postgres + Auth + Storage + Realtime. Separate Fastify API on Railway/Hetzner.

### Alternatives Considered
- AWS RDS + Cognito + S3 — rejected: $60/mo vs $26/mo for identical functionality at our scale, 5–10 hr/mo of ops overhead.
- Self-hosted Postgres on Hetzner — rejected: operational burden too high.
- Stay on Firebase with per-record fix — rejected: doesn't solve authorization, reporting, or relational integrity. User explicitly rejected as a temp solution.

### Consequences
- Positive: lowest TCO, fastest setup, includes auth/storage/realtime, standard Postgres = portable.
- Negative: PgBouncer kills long queries; Edge Functions have cold starts.
- Risks: Supabase pricing/pivot — mitigated by pg_dump portability (1-day migration to AWS RDS if needed).

## ADR-002: Drizzle ORM over Prisma
**Date:** <today>
**Status:** Accepted

### Decision
Use Drizzle ORM. Lighter, transparent SQL, raw SQL escape hatch, no codegen.

### Alternatives
- Prisma — rejected: heavy, hides too much, codegen step.
- Knex — rejected: not type-safe enough.
- Raw pg — rejected: too much boilerplate.

## ADR-003: TanStack Query over manual fetch / SWR / RTK Query
**Date:** <today>
**Status:** Accepted

### Decision
Use TanStack Query v5. Replaces ~2,000 lines of hand-rolled cache/sync logic from the legacy system.

## ADR-004: Selective Realtime, not Realtime everywhere
**Date:** <today>
**Status:** Accepted

### Decision
Realtime ONLY on Op Entry, Live Operations Board, Machine Status, Task Allocation. Everything else uses TanStack Query polling (30s lists, 60s detail).

### Rationale
WebSocket connections cost server memory (~50 KB each). 100 users × 5 tabs = 500 connections. Polling scales linearly with simple HTTP, easier to debug.

## ADR-005: RLS for multi-tenancy and authorization
**Date:** <today>
**Status:** Accepted

### Decision
Every table has RLS enabled. Every table has at minimum a `company_isolation` policy. JWT claims (`company_id`, `role`) propagated to Postgres session.

## ADR-006: Soft delete via `deleted_at`, no hard deletes from app
**Date:** <today>
**Status:** Accepted

### Decision
Every table has `deleted_at timestamptz`. App never executes DELETE. To "delete" → set `deleted_at = now()`. Standard queries filter `where deleted_at is null`.

## ADR-007: pnpm workspaces over npm/yarn
**Date:** <today>
**Status:** Accepted

### Decision
pnpm workspaces. Fast, disk-efficient, strict module boundaries.

(Append new decisions below as ADR-008, ADR-009, ...)
```

### `docs/SCHEMA.md` (starter content)

```markdown
# SCHEMA.md — Living Database Schema

> MUST mirror `apps/api/src/db/schema.ts` exactly. Update in same commit as schema changes.

## Conventions

Every table has:
- `id uuid primary key default gen_random_uuid()`
- `company_id uuid not null references companies(id)`
- `created_at timestamptz not null default now()`
- `created_by uuid not null references users(id)`
- `updated_at timestamptz not null default now()`
- `updated_by uuid not null references users(id)`
- `deleted_at timestamptz` (null = active)
- RLS enabled with `company_isolation` policy at minimum

## Modules
- Master Data: companies, users, clients, vendors, items, machines, operators
- Sales & Production: sales_orders, sales_order_lines, job_work_orders, job_cards, jc_ops, op_log
- Procurement: purchase_orders, po_lines, grn, grn_lines, store_transactions
- Quality: qc_inspections, qc_attachments, nc_register, capa_records
- Dispatch: dispatch_log, delivery_challans
- Design: design_projects, design_tasks, design_issues, design_work_log
- CRM: leads, communications, crm_reminders
- Audit & Config: activity_log, dashboard_config, alert_config, print_templates

(Detailed table-by-table specs go here as schema is built. Add a section per table with all columns, indexes, FKs, RLS policies.)

## RLS Policy Pattern

```sql
alter table <table_name> enable row level security;

create policy company_isolation on <table_name>
  for all using (company_id = current_company_id());
```

Tables with role-restricted writes get additional policies (admin/manager only for inserts, etc.).

## Index Discipline

MUST have indexes:
- Every foreign key column (Postgres does NOT auto-index FKs)
- `(company_id, status) where deleted_at is null` on transaction tables
- Time-range columns used in reports
- Unique business keys (so_number, jc_number, etc.)

## Migration History
| Date | Migration | Notes |
|---|---|---|
| <date> | 0001_initial_schema | Initial schema |
```

### `docs/CONVENTIONS.md` (starter content)

```markdown
# CONVENTIONS.md — Coding Standards

## File Naming
- kebab-case for files: `job-cards.service.ts`
- PascalCase for React components: `JobCardForm.tsx`
- camelCase for variables/functions
- PascalCase for types/interfaces/classes/enums
- SCREAMING_SNAKE_CASE for constants

## TypeScript
- Strict mode mandatory.
- No `any` without `// any: <reason>` comment.
- Define data shapes in Zod, infer TS types from them.
- `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.

## Backend Module Structure
Each module has exactly:
- `routes.ts` — Fastify routes only, no logic
- `service.ts` — All business logic
- `schema.ts` — Zod schemas (or re-export from shared)
- `service.test.ts` — Unit tests
- `routes.test.ts` — Integration tests

## Routes Discipline
Routes ONLY: declare endpoint, validate input, call service, return response. NO business logic, NO database queries, NO conditionals beyond auth/validation.

## Service Discipline
- All business logic lives here.
- Always takes `(input, currentUser)` parameters.
- Always returns typed result.
- Wraps multi-table writes in transactions.
- Throws typed errors (not strings).

## Error Handling
- API throws domain errors: `NotFoundError`, `ValidationError`, `AuthorizationError`, `ConflictError`.
- Fastify error handler maps these to HTTP codes (404, 400, 403, 409).
- All errors logged via Pino with context (user_id, request_id).
- Frontend catches errors via TanStack Query onError, shows toast notifications.

## React Component Discipline
- Components are presentational. Logic in custom hooks.
- Forms use react-hook-form + Zod resolver.
- Server state via TanStack Query, NEVER `useEffect` + `fetch`.
- Local UI state in Zustand or component state.
- No prop drilling beyond 2 levels — use Zustand.

## API Client (frontend)
- Single `apiClient` in `apps/web/src/lib/api.ts` (axios or ky).
- Adds auth header from Supabase session automatically.
- Refreshes token on 401.

## Logging
- API: Pino with request context (req_id, user_id, company_id).
- Frontend: a single `log()` helper, ships errors to Sentry.
- Never `console.log` in committed code.

## Imports
- Absolute imports via `@/` alias for in-package imports.
- No `../../` beyond two levels.

## Git Commits
Format: `<type>: <subject>` where type is feat/fix/chore/docs/refactor/test.
Examples:
- `feat(job-cards): add op-entry endpoint`
- `fix(grn): correct quantity rollup on partial receipt`
- `chore: bump drizzle to 0.30.0`
```

### `docs/RUNBOOK.md` (starter content)

```markdown
# RUNBOOK.md — Operational Procedures

## Deploy to Staging
```bash
git checkout staging
git merge main
git push origin staging
# GitHub Actions handles the rest
```

## Deploy to Production
1. Merge to `main` after staging verification.
2. GitHub Actions runs CI; manual approval gate triggers.
3. Approve in GitHub Actions UI.
4. Migrations run automatically via Drizzle Kit.
5. Verify health: `curl https://api.<domain>/health`.

## Restore from Backup
1. Pull latest dump from Backblaze B2:
   ```bash
   b2 download-file innovic-backups innovic-<date>.sql.gz ./
   gunzip innovic-<date>.sql.gz
   ```
2. Restore to a NEW Supabase project (NOT production):
   ```bash
   psql "<test-connection-string>" < innovic-<date>.sql
   ```
3. Verify: connect API to test instance via env var, run smoke tests.
4. Promote: cut over via DNS.

## Rotate Secrets
1. Generate new value (Supabase service key, JWT secret, etc.).
2. Update Railway environment variable.
3. Redeploy API.
4. Revoke old value at the source.

## Common Issues

### "Connection pool exhausted"
- Check Supabase dashboard → Database → Connection Pooler usage.
- Increase pool size, or add PgBouncer between API and Postgres.

### "Realtime subscription drops"
- Check WebSocket connection in browser dev tools.
- Verify token hasn't expired.
- Reconnect logic in TanStack Query handles this.

### "Migration fails on production"
- DO NOT manually fix in Supabase Studio.
- Roll back deployment.
- Fix migration locally, test in staging, redeploy.

## Monthly Restore Drill
First Monday of every month:
1. Pull latest backup.
2. Restore to test instance.
3. Boot API against it.
4. Run smoke test suite.
5. Log result in MIGRATION-LOG.md (or a new DRILL-LOG.md if you create one).
```

### `docs/ARCHITECTURE.md` (starter content)

```markdown
# ARCHITECTURE.md — System Design

## System Diagram
Browser → Cloudflare Pages (React SPA) → Fastify API on Railway → Supabase (Postgres + Auth + Storage + Realtime)
+ Backblaze B2 (offsite backup), Sentry (errors), Better Stack (uptime), Resend (email)

## Component Responsibilities
- React SPA: UI only, zero business logic
- Fastify API: business logic, validation, authorization, integration
- Supabase Postgres: source of truth, RLS-enforced multi-tenancy
- Supabase Storage: file uploads with same access policies as DB
- Supabase Auth: JWT issuance and validation
- Supabase Realtime: selective WebSocket delivery for hot screens

## Authorization Model
3 layers: JWT validation (Fastify) → RLS (Postgres) → Service-level role checks (TypeScript).
Roles: admin, manager, operator, qc, procurement, dispatch, design, viewer.

## Multi-Tenancy
Every table has `company_id`. RLS enforces isolation. JWT claim `company_id` set on Postgres session.

## Realtime Strategy
ONLY on: Op Entry, Live Operations Board, Machine Status, Task Allocation.
Polling elsewhere: 30s lists, 60s detail screens.

## Performance Targets (at 100 users)
- p50 API: <100ms · p95: <300ms · p99: <800ms
- Page load (cold): <2s · (warm): <500ms
- DB query: <50ms p95
- Realtime delivery: <500ms

## Backup & Recovery
- Supabase auto: daily, 7-day PITR
- Offsite: pg_dump → B2 daily 02:00 IST, 30-day retention
- RPO: 24h · RTO: 4h
- Restore drill: first Monday of every month
```

### `docs/MIGRATION-LOG.md` (starter content)

```markdown
# MIGRATION-LOG.md — Firebase → Supabase Migration Record

> One entry per collection migrated. Append-only.

## Template
```
## <collection_name>
**Date:** YYYY-MM-DD
**Source records:** <count from Firebase>
**Loaded records:** <count in Supabase>
**Discrepancy:** <count> — <reason>
**Anomalies:** <fields with missing/inconsistent data>
**Validation:** <PASS / FAIL — what was checked>
**Cutover:** <date users switched to new system for this module>
```

## Pending Collections
- users, clients, vendors, items, machines, operators (Phase 2)
- jobCards, jcOps, opLog (Phase 3)
- salesOrders, jobWorkOrders (Phase 4)
- purchaseOrders, grn, storeTransactions (Phase 5)
- qcProcesses, qcAssignments, qcDocUploads, ncRegister, capaRecords (Phase 6)
- jwDCOutward, jwDCInward, challans, dispatchLog (Phase 6)
- designProjects, designTasks, designIssues, designWorkLog, designTimeLog, designDCRs, designDCNs (Phase 8)
- leads, communications, crmReminders (Phase 8)
- toolIssues, storeIssues, partyMaterials, partyGrn (Phase 8)
- printTemplates, printTemplateRevisions, dashboardConfig, alertConfig (Phase 8)
- activityLog (Phase 9)
```

---

## Section 15 — End-of-File Acknowledgment

When you finish reading this file, your first response in the session must include:

> "I've loaded project memory. CLAUDE.md sections read: 0–15. Last task per TASKS.md: <X> (or 'no TASKS.md yet — running First Session Bootstrap'). Ready to proceed with: <Y>."

Do not skip this acknowledgment. It tells the user you have context.
