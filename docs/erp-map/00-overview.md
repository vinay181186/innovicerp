# Innovic ERP — System Overview

> Top-level map of the Innovic ERP. Read this first, then drill into any `docs/erp-map/<module>.md`.
> This is a documentation-only encyclopedia. It describes the code as-is; it does not change it.

## What this system is

A manufacturing ERP for a **job-shop** environment: customer orders (Sales Orders) are broken into
production work (Job Work Orders → Job Cards → Operations) on the shop floor, backed by procurement,
stores/inventory, quality control, dispatch, and design tracking. It is a migration off a 29,000-line
single-HTML + Firebase Firestore system; the legacy HTML in `legacy/` remains the behavioral spec source.

## Stack (see CLAUDE.md §5 for the locked list)

| Layer | Technology |
| --- | --- |
| Backend | TypeScript (strict), Node 24, **Fastify 5**, **Drizzle ORM**, **Zod**, Pino logs |
| Frontend | React 18 + Vite 5, **TanStack Router / Query / Table**, Zustand, react-hook-form, Tailwind + shadcn/ui |
| Database | Supabase **Postgres 15** (Mumbai `ap-south-1`), RLS-enforced multi-tenancy |
| Storage | Supabase Storage (S3-compatible) for file uploads/attachments |
| Async jobs | **BullMQ + Redis** (`apps/api/src/lib/queue.ts`; alerts worker + `job-queue` module) |
| Realtime | Supabase Realtime — selective (Op Entry, alerts) only |
| Shared | `packages/shared` — Zod schemas + inferred types + enums, single source of truth |

## Repository layout

```
apps/api/src/modules/<module>/   routes.ts · service.ts · schema.ts · *.test.ts
apps/web/src/modules/<module>/   api.ts · components/ · routes/ · schemas.ts
apps/api/src/db/schema.ts        entire Drizzle schema (~85 tables)
packages/shared/src/             schemas/ · types/ · enums/ (33 enums)
```

Every ERP module is mirrored: one folder under `apps/api/src/modules/` and one under `apps/web/src/modules/`.
**82 API modules** exist today. Routes call services; services own all business logic and DB access.

## Cross-cutting invariants (CLAUDE.md §6)

- Every table carries `company_id`, `created_at/by`, `updated_at/by`, `deleted_at`, and an RLS policy.
- **No hard deletes** — soft-delete via `deleted_at`; the `trash` module restores.
- All timestamps stored `timestamptz` UTC, displayed in IST (`Asia/Kolkata`).
- No business logic in the frontend; the React app shows data and submits intents.
- Authorization is 3-layered: JWT (Fastify) → RLS (Postgres) → service-level role checks.

## User roles

`admin · manager · operator · qc · procurement · dispatch · design · viewer`
(`packages/shared/src/enums/user-role.ts`)

Fine-grained gating uses the **access-control registry** (`packages/shared/src/enums/access-control.ts`):
9 departments × form keys × `view ⊂ entry ⊂ edit` actions. The same registry drives the API guard,
sidebar visibility, per-button gating, and the matrix editor.

## Domain glossary (CLAUDE.md §13)

SO (Sales Order) · JWO/JW (Job Work Order) · JC (Job Card) · JC Op (operation) · Op Log (operation log) ·
PO (Purchase Order) · GRN (Goods Receipt Note) · DC (Delivery Challan) · NC (Non-Conformance) ·
CAPA · BOM · Route Card · OSP (Outside Processing) · TPI (Third-Party Inspection).

## The core production flow

```
Client → Sales Order (SO) ──► Job Work Order (JWO) ──► Job Card (JC) ──► JC Operations ──► Op Log entries
                                                              │                    │
   BOM / Route Card define items & routing                   │                    ├─► Machine loading
                                                              │                    └─► OSP (vendor work) via JW-DC
Purchase Request → Purchase Order → GRN → Store inventory ────┘  (material feeds production)
                                                              │
                          Incoming/Process QC → NC → CAPA ◄───┘  (quality gates each stage)
                                                              │
                        Assembly ► Customer Dispatch ► Delivery Challan ► Invoice ► SO closed
```

## Module domains (drill-down index is in `README.md`)

| Domain | Modules (representative) |
| --- | --- |
| Master Data | companies, users, clients, vendors, operators, machines, cost-centers, doc-numbers, report-types |
| Catalog & Engineering | items, bom-master, route-cards, assembly, osp-processes, tool-issues, plans, tasks |
| Sales & SO Analytics | sales-orders, so-overview, so-status, so-timeline, so-costing, so-cycle-time, so-planning, so-qc-status, pending-so-value, prod-so-list |
| Job Work & Execution | job-work-orders, jw-dc, jwso-documents, prod-jw-list, job-cards, jc-ops, op-entry, op-log-viewer, machine-loading |
| Production Mgmt & Shop Floor | production-dashboard, production-schedule, shop-floor, sc-dashboard, stuck-dashboard, job-queue, daily-report, daily-task-reports |
| Procurement & Store | purchase-orders, purchase-requests, service-pos, goods-receipt-notes, party-grn, party-materials, store-inventory, store-issues, store-transactions, stock-valuation |
| Quality | incoming-qc, qc-processes, qc-command, qc-dashboard, qc-documents, qc-history, nc-register, capa, tpi |
| Dispatch, Finance & Design | customer-dispatches, delivery-challans, invoices, design-projects, design-tracker, design-issues, design-work-log |
| Dashboards, Reporting & System | dashboard, reports, saved-reports, access-control, activity-log, alerts, approval-config, backup, data-integrity, print-templates, trash |

## Status enums (shared, `packages/shared/src/enums/`)

SO status/type · PO status/type · PR status · GRN QC status · DC status · invoice status ·
customer-dispatch status · JC computed status / priority · running-op status · op-log/op type ·
outsource status · NC status/disposition/reason-category · plan status/type · task status/priority ·
store-txn type/source · BOM status/line-type · daily-report line status · item-type · UOM · shift · user-role.
