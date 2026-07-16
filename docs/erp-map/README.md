# ERP Map — Module Encyclopedia

> Read-only reference documentation of the Innovic ERP codebase. **No code is described here that was changed** — this is a map, not a migration.
> Start with **[00-overview.md](./00-overview.md)** for the system-level picture, then drill into any module below.

Each module page follows a fixed template: Purpose · Pages/Screens · Database Tables · API Endpoints ·
Services/Key Functions · Entry Points · Business Logic · Dependencies · User Roles/Access · Reports ·
Imports/Exports · Background Jobs.

**Coverage:** 82 API modules, one doc each (built from `routes.ts` + `service.ts` + `schema.ts` + `db/schema.ts` + web `routes/`).

---

## Master Data
Reference entities that everything else points at.

| Module | Doc | Notes |
| --- | --- | --- |
| Companies | [companies.md](./companies.md) | Admin-only; edited via `settings`, no own page |
| Users | [users.md](./users.md) | Admin-only; the only module touching Supabase Auth |
| Clients | [clients.md](./clients.md) | Auto-code `CLI-###` |
| Vendors | [vendors.md](./vendors.md) | Auto-code `VND-###`; **Excel import/export** |
| Operators | [operators.md](./operators.md) | Auto-code `OP-###` |
| Machines | [machines.md](./machines.md) | Manual unique code |
| Cost Centers | [cost-centers.md](./cost-centers.md) | Manual unique code |
| Doc Numbers | [doc-numbers.md](./doc-numbers.md) | Owns no table; next-code helper for SO/PO/GRN |
| Report Types | [report-types.md](./report-types.md) | Mandatory-doc config; RLS-only write gate |

## Catalog & Engineering
Item master, structure (BOM), routing, and engineering work.

| Module | Doc | Notes |
| --- | --- | --- |
| Items | [items.md](./items.md) | Item master; **Excel import (web-only)** |
| BOM Master | [bom-master.md](./bom-master.md) | Cascades JCs/PRs from BOM lines; Excel import |
| Route Cards | [route-cards.md](./route-cards.md) | Operation routing; delete admin-only |
| Assembly | [assembly.md](./assembly.md) | URL `assemblies` |
| OSP Processes | [osp-processes.md](./osp-processes.md) | Master; surfaced under `settings`, no own page |
| Tool Issues | [tool-issues.md](./tool-issues.md) | |
| Plans | [plans.md](./plans.md) | Planning dashboard; `executePlan` creates JCs + PRs |
| Tasks | [tasks.md](./tasks.md) | URL `task-board`; self-or-manager write |

## Sales & SO Analytics
The Sales Order and every derived read-only view over it.

| Module | Doc | Notes |
| --- | --- | --- |
| Sales Orders | [sales-orders.md](./sales-orders.md) | **Anchor module** — only true CRUD; edit admin-only |
| SO Overview | [so-overview.md](./so-overview.md) | Read-only; calc-engine |
| SO Status | [so-status.md](./so-status.md) | Read-only |
| SO Timeline | [so-timeline.md](./so-timeline.md) | Read-only report |
| SO Costing | [so-costing.md](./so-costing.md) | Read-only report |
| SO Cycle Time | [so-cycle-time.md](./so-cycle-time.md) | Read-only; so-phase-data |
| SO Documents | [so-documents.md](./so-documents.md) | Writes `file_registry` attachments |
| SO Planning | [so-planning.md](./so-planning.md) | Read-only planning view |
| SO QC Status | [so-qc-status.md](./so-qc-status.md) | Read-only |
| Pending SO Value | [pending-so-value.md](./pending-so-value.md) | Read-only report |
| Prod SO List | [prod-so-list.md](./prod-so-list.md) | Read-only production list |

## Job Work & Production Execution
JWO → Job Card → Operations → Op Log — the shop-floor spine.

| Module | Doc | Notes |
| --- | --- | --- |
| Job Work Orders | [job-work-orders.md](./job-work-orders.md) | |
| JW-DC | [jw-dc.md](./jw-dc.md) | Outsourcing challans; stock moves lock item rows |
| JWSO Documents | [jwso-documents.md](./jwso-documents.md) | Hooks-only, consumed by JWO screens |
| Prod JW List | [prod-jw-list.md](./prod-jw-list.md) | Read-only |
| Job Cards | [job-cards.md](./job-cards.md) | Direct create gated off (Planning-sourced) |
| JC Ops | [jc-ops.md](./jc-ops.md) | Reads `v_jc_op_status` view |
| **Op Entry** | [op-entry.md](./op-entry.md) | **Critical path**; Realtime; heavy in-tx cascades |
| Op Log Viewer | [op-log-viewer.md](./op-log-viewer.md) | Web dir is `op-log`; `op_log` is insert-only |
| Machine Loading | [machine-loading.md](./machine-loading.md) | |

## Production Management & Shop Floor
Mostly read-only aggregation dashboards over the execution tables.

| Module | Doc | Notes |
| --- | --- | --- |
| Production Dashboard | [production-dashboard.md](./production-dashboard.md) | Read-only |
| Production Schedule | [production-schedule.md](./production-schedule.md) | Writes `jc_ops` planned_start/end/machine |
| Shop Floor | [shop-floor.md](./shop-floor.md) | Stop-op status write only |
| SC Dashboard | [sc-dashboard.md](./sc-dashboard.md) | Read-only |
| Stuck Dashboard | [stuck-dashboard.md](./stuck-dashboard.md) | Read-only; so-phase-data engine |
| Job Queue | [job-queue.md](./job-queue.md) | **NOT BullMQ** — persisted per-machine reorder list |
| Daily Report | [daily-report.md](./daily-report.md) | Read-only per-day op-log summary |
| Daily Task Reports | [daily-task-reports.md](./daily-task-reports.md) | CRUD; owns `daily_reports` + lines |

## Procurement & Store
PR → PO → GRN into an append-only stock ledger.

| Module | Doc | Notes |
| --- | --- | --- |
| Purchase Requests | [purchase-requests.md](./purchase-requests.md) | Delete blocked once a PO exists |
| Purchase Orders | [purchase-orders.md](./purchase-orders.md) | Value-ceiling approval via `approval_config` |
| Service POs | [service-pos.md](./service-pos.md) | Approval admin-only |
| Goods Receipt Notes | [goods-receipt-notes.md](./goods-receipt-notes.md) | Pivot into inventory; QC-accept credits stock |
| Party GRN | [party-grn.md](./party-grn.md) | Client-owned material receipts |
| Party Materials | [party-materials.md](./party-materials.md) | Client-owned stock counters (separate world) |
| Store Inventory | [store-inventory.md](./store-inventory.md) | Derived on-hand via `v_item_stock` |
| Store Issues | [store-issues.md](./store-issues.md) | |
| Store Transactions | [store-transactions.md](./store-transactions.md) | **Append-only stock ledger** |
| Stock Valuation | [stock-valuation.md](./stock-valuation.md) | Latest-cost proxy (not FIFO) |

## Quality
QC inspection, NC, CAPA, TPI, and the QC document matrix.

| Module | Doc | Notes |
| --- | --- | --- |
| Incoming QC | [incoming-qc.md](./incoming-qc.md) | Read-only |
| QC Processes | [qc-processes.md](./qc-processes.md) | Master CRUD; write admin/manager |
| QC Command | [qc-command.md](./qc-command.md) | Pickup/assign; assign is admin-only |
| QC Dashboard | [qc-dashboard.md](./qc-dashboard.md) | Read-only |
| QC Documents | [qc-documents.md](./qc-documents.md) | MIR/MCR/DIR/TPI matrix |
| QC History | [qc-history.md](./qc-history.md) | Also backs web `qc-call-register` |
| NC Register | [nc-register.md](./nc-register.md) | 5-disposition state machine + cascades |
| CAPA | [capa.md](./capa.md) | Corrective/preventive follow-up |
| TPI | [tpi.md](./tpi.md) | Read-only third-party inspection |

## Dispatch, Finance & Design
Finished goods out the door, invoicing, and the design pipeline.

| Module | Doc | Notes |
| --- | --- | --- |
| Customer Dispatches | [customer-dispatches.md](./customer-dispatches.md) | Ready-qty from `v_jc_op_status`; moves stock |
| Delivery Challans | [delivery-challans.md](./delivery-challans.md) | Most cascade-heavy; cancel admin-only |
| Invoices | [invoices.md](./invoices.md) | `unpaid → partial → paid`; caps at dispatched−invoiced |
| Design Projects | [design-projects.md](./design-projects.md) | Owns all design-issue writes |
| Design Tracker | [design-tracker.md](./design-tracker.md) | Approve/revise gates BOM on Equipment SOs |
| Design Issues | [design-issues.md](./design-issues.md) | Read-only cross-project view |
| Design Work Log | [design-work-log.md](./design-work-log.md) | Daily timesheet (≠ design_time_log) |

## Dashboards, Reporting & System
Cross-cutting infrastructure, config, and audit.

| Module | Doc | Notes |
| --- | --- | --- |
| Dashboard | [dashboard.md](./dashboard.md) | Role-aware home; owns `dashboard_config` |
| Reports | [reports.md](./reports.md) | 19 canned SQL reports + XLSX export |
| Saved Reports | [saved-reports.md](./saved-reports.md) | Ad-hoc builder; owns `saved_reports` |
| Access Control | [access-control.md](./access-control.md) | Permission matrix; owns `user_access` |
| Activity Log | [activity-log.md](./activity-log.md) | Append-only audit trail |
| Alerts | [alerts.md](./alerts.md) | 15 rules; **BullMQ 30-min digest worker** |
| Approval Config | [approval-config.md](./approval-config.md) | Per-company approval workflow |
| Backup | [backup.md](./backup.md) | On-demand JSON snapshot (real backup = RUNBOOK pg_dump) |
| Data Integrity | [data-integrity.md](./data-integrity.md) | 8-check scanner; lives under `settings` |
| Print Templates | [print-templates.md](./print-templates.md) | 15 print blocks + revision history |
| Trash | [trash.md](./trash.md) | Soft-delete recovery over 17 entity types |

---

## Web-only modules (no API module of their own)

These live under `apps/web/src/modules/` but have no matching `apps/api/src/modules/` folder — they are UI surfaces over other modules' APIs:

- **`settings`** — hosts Companies, OSP Processes, and Data Integrity panels.
- **`op-log`** — web surface for the API `op-log-viewer` module.
- **`qc-call-register`** — web surface backed by the `qc-history` API.
- **`outsource-jobs`** — OSP-related web view (related to `osp-processes` / `jw-dc`).

## System-wide patterns to know

- **Two SQL status views are the source of truth**: `v_jc_op_status` (operation-level) and `v_jc_status` (job-card-level) — the SQL mirror of the legacy `calcEngine`. Nearly every production/QC/dispatch read leans on them instead of recomputing.
- **Stock is never a mutable column** — `store_transactions` is an append-only ledger; on-hand is derived/cached (`item_stock_balances` / `v_item_stock`). Client-owned **party materials** are a separate stock world with their own counters.
- **Write-side couplings (cascades) worth tracing**: BOM→JC/PR, Plan→JC/PR, Op-Entry→(SO/JW close · auto-NC · stock credit · auto-PR/PO for OSP), GRN→(PO rollup · stock credit), Delivery-Challan→(stock · jc_ops flip · auto-NC · JC/SO completion), Dispatch→(stock · dispatched_qty)→Invoice.
- **Authorization is uneven by design**: some services call `requireWriteRole`/`requireAdminRole` explicitly; others rely solely on `*_manager_write` / `*_qc_write` RLS policies. The `qc` role in particular is a writer for QC docs/CAPA/assignments but **not** for the QC-process master or the NC register. Each doc's "User Roles / Access" section records the specifics.
- **Append-only / no-soft-delete exceptions** (deliberate): `op_log`, `store_transactions`, `activity_log`, `alert_deliveries`, and the alert config/subscription tables.
