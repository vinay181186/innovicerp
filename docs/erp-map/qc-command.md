# QC Command Center
**Module key:** `qc-command` · **Domain:** Quality

## Purpose
Operational control tower for shop-floor QC. One aggregate read powers a multi-tab console: pending QC queue (with attempt no. + assignment), First-Pass Yield (FPY) analytics, rework tracking, rejection Pareto, inspector performance, and strip stats. Adds two writes — Pick Up (self-assign) and Assign (admin allocates an op to an inspector). Mirrors legacy `renderQCCommandCenter` (HTML L18613) and helpers `_qccQueueData`/`_qccFPYData`/`_qccPickUp`/`_qccAssign`.

## Pages / Screens
- **QC Command** (`qc-command`) — tabbed console. Tabs/components: `QueueTab`, `FpyTab`, `ReworkTab`, `ParetoTab`, `InspectorTab`, and `AssignModal` (admin allocate).

## Database Tables
Owns **`qc_assignments`** (migration 0040, `apps/api/src/db/schema.ts` L4586):
- Cols: `id`, `company_id`, `jc_op_id` (FK jc_ops, onDelete cascade), `inspector_user_id` (FK users), `inspector_name` (text snapshot, notNull), `note`, `assigned_by_text`, audit cols, `deleted_at`.
- Indexes: `qc_assignments_company_op_uq` UNIQUE `(company_id, jc_op_id) where deleted_at is null` (one ACTIVE assignment per op); `qc_assignments_company_inspector_idx`.
- RLS: `qc_assignments_company_read` (select, company); `qc_assignments_qc_write` (all, roles `admin`/`manager`/`qc`). Company-isolated.

Reads (RLS via base tables): `v_jc_op_status` (view — `qc_pending`, `qc_required`, `op_type`, `computed_status`), `jc_ops`, `job_cards`, `items`, `sales_order_lines`, `sales_orders`, `op_log` (`log_type='qc'`), `users`, `nc_register` (Pareto).

## API Endpoints
- `GET /qc-command` — aggregate: queue + fpy + rework + pareto + inspectorPerf + stats + inspector options. Any authenticated user.
- `POST /qc-command/pickup` — self-assign an op (`{ jcOpId }`). Requires QC writer (`admin`/`manager`/`qc`).
- `POST /qc-command/assign` — assign op to another inspector (`{ jcOpId, inspectorUserId, note? }`). **admin only.**

## Services / Key Functions
- `getQcCommand(user)` → `QcCommandResponse` — 5 parallel reads (pending ops, all QC op_log rows, active assignments, active users, all NCs), then in-JS grouping to build queue/FPY/rework/Pareto/inspector perf/stats.
- `pickUpQc(input, user)` → `{ jcOpId, inspectorName }` — QC writers only; upserts caller as inspector.
- `assignQc(input, user)` → `{ jcOpId, inspectorName }` — admin only; validates inspector in company; upserts assignment with `assignedByText`.
- Helpers: `upsertAssignment` (insert-or-update single active row per op), `assertOpInCompany`, `userName`. Writes run inside `withUserContext` tx.

## Entry Points
Web route `qc-command`. API `GET /qc-command`, `POST /qc-command/pickup`, `POST /qc-command/assign`.

## Business Logic
- **Queue** = ops from `v_jc_op_status` where `(qc_required OR op_type='qc')` AND `qc_pending > 0`. Each row gets: `ageDays` (since last `complete` op_log, else JC created_at), `attemptNo` (count of prior QC op_log entries for the op + 1), `isOverdue` (due_date < today), `assignedTo` (from active qc_assignments).
- **QC attempt history** — QC `op_log` rows grouped by `jc_op_id`, ordered oldest-first; `entry[0]` = first attempt.
- **First-Pass Yield** — a group is "first-pass" when it has exactly ONE QC entry with zero rejects (legacy rule L18339-18342). FPY reported overall + by operation + by inspector + by item (top 10, sorted worst-first).
- **Rework** = groups with >1 attempt OR any rejects on first attempt; reports attempts, total rejected, days elapsed first→last. Sorted by attempts desc.
- **Rejection Pareto** — ALL NCs grouped by `reason_category`, sorted by rejected qty desc, % of total qty, top-3 item codes per reason.
- **Inspector performance** — per inspector (op_log operator_name) over all QC entries: inspections, distinct JCs, accepted/rejected qty, reject rate %, current assigned load. Inspectors with a load but no entries still appear.
- **Assignment invariant** — exactly one ACTIVE assignment per op (unique partial index); upsert reuses the existing active row. Pick-Up = self; Assign-to-another = admin only (enforced in service, not RLS). `inspector_name` is a display snapshot that survives user rename.

## Dependencies on Other Modules
- **jc-ops / job-cards / op-entry** — QC ops, QC op_log entries (source of FPY/rework/attempts). Reads the `v_jc_op_status` view.
- **nc-register** — reads NC rows for the Pareto.
- **users** — inspector options + name resolution. **sales-orders / items** — display context.

## User Roles / Access (qc role matters here)
Read (`GET /qc-command`): any authenticated user. **Pick Up**: `admin`/`manager`/`qc` (QC_WRITERS) — the core `qc`-role action. **Assign to another inspector**: `admin` only. RLS write policy on `qc_assignments` allows admin/manager/qc.

## Reports
FPY (overall/by op/by inspector/by item), Rejection Pareto, Inspector Performance, Rework list, and strip stats are all in-console analytics. No file export.

## Imports / Exports
None.

## Background Jobs
None.
