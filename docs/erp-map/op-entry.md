# Op Entry (Shop-Floor Operation Logging)
**Module key:** `op-entry` · **Domain:** Job Work & Production Execution

## Purpose
The critical shop-floor write path. Operators start operations, log completed production quantity, and QC inspectors log accept/reject qty against Job Card Operations. All quantity/status derivation reads the `v_jc_op_status` view (the SQL mirror of legacy `calcEngine`, per ADR-011 #2); `op_log` is **immutable** (ADR-011 #4 — corrections are reversing entries, never UPDATE/DELETE). Running sessions live in `running_ops`. Completing/QC-clearing the last op cascades to close the source SO/JW line + header. QC rejects auto-create NCs; last-op QC accepts credit finished stock.

## Pages / Screens
- `op-entry` — main entry screen (`routes/index.tsx`): JC ops table, op-entry form, op-log history.
- `op-entry/machines` — machine view (`routes/machines.tsx`, `machine-card.tsx`).
- `op-entry/running` — running-ops board (`routes/running.tsx`, `running-ops-board.tsx`).
- Components: `jc-ops-table`, `op-entry-form`, `op-log-history`, `status-badge`.

## Database Tables
Owns writes to **`op_log`** and **`running_ops`**; reads `jc_ops`, `job_cards`, `machines`, view `v_jc_op_status`. (Also triggers writes in `nc_register`, `store_transactions`, `sales_order_lines`/`sales_orders` + JW equivalents, `purchase_requests`/`purchase_orders` via cascades.)

**`op_log`** (L870) — immutable log entries. Cols: `jc_op_id` FK (CASCADE), `log_no`, `log_type` (`op_log_type` enum: `start`|`complete`|`qc`), `log_date`, `shift` (enum day/night/general), `qty`, `reject_qty`, `operator_id` → operators, `operator_name`, `start_time`, `remarks`, TPI fields (`is_tpi`, `tpi_inspector`, `tpi_organization`, `tpi_cert_no`), QC report attachment (`qc_report_path`, `qc_report_name`). Indexes: `(company_id, jc_op_id, log_date)`; `(company_id, log_date) where is_tpi`; `(company_id, log_date) where log_type='complete'`; `(operator_id, log_date)`. Checks: `qty >= 0`, `reject_qty >= 0`. **No `deleted_at` / no updated_* — insert-only.** RLS: company read + three role-scoped INSERT policies — `operator` may insert `start`/`complete`, `qc` may insert `qc`, admin/manager may insert any.

**`running_ops`** (L941) — active shop-floor sessions. Cols: `jc_op_id` FK (CASCADE), `machine_id`, `is_osp`, `operator_id`, `operator_name`, `start_date`, `start_time`, `shift`, `status` (`running_op_status` enum), `ended_at`. Indexes: **unique `(company_id, jc_op_id) where status='running'`** (one running session per op); **unique `(machine_id) where status='running' AND is_osp=false`** (one running non-OSP op per machine); `(company_id, status, start_date)`. RLS: company read; operators write only their own rows; admin/manager write all.

## API Endpoints
`routes.ts`, all authenticated:
- `GET /op-entry/jc-ops` — enriched ops for a JC (by `jobCardId`/`jobCardCode`) or a machine (`machineId`); requires one filter.
- `GET /op-entry/op-log` — op_log entries for a JC or a single op.
- `GET /op-entry/running-ops` — running/ended sessions (optional status filter, cap 200).
- `POST /op-entry/op-log` — submit a **production-complete** log (201). Op-entry role.
- `POST /op-entry/qc-log` — submit a **QC inspection** log with accept/reject (201). Op-entry role.
- `POST /op-entry/start` — start an op → opens a `running_ops` session + `start` marker (201). Op-entry role.
- `POST /op-entry/running-ops/:id/stop` — stop a running session. Op-entry role.
- `POST /op-entry/osp-pr` — OSP auto-PR generation for an outsource op (201). **Write (admin/manager) role.**

## Services / Key Functions
`service.ts` (public):
- `listJcOpsEnriched(input, user)` → ops joined to `v_jc_op_status` (qty flow + computed status). Requires jobCardId | jobCardCode | machineId.
- `listOpLog(input, user)` → op_log rows (by JC or op), newest first.
- `listRunningOps(input, user)` → running sessions joined to JC/op/machine.
- `submitOpLog(input, user)` → OpLog. **Transaction.** Production-complete path (see logic).
- `submitQcLog(input, user)` → OpLog. **Transaction.** QC inspection path (accept/reject).
- `startOp(input, user)` → RunningOp. **Transaction.** Opens session + start marker.
- `stopOp(runningOpId, user)` → RunningOp. **Transaction.** Sets status `stopped`, `ended_at`.
- `generateOspPr(input, user)` → OSP PR/PO result. **Transaction.** Delegates to `osp-cascade.generateOspPrForOp`.
- Private: `loadJcOp`, `loadAvailability` (reads `v_jc_op_status.available`/`computed_status`), `nextLogNo`.

Cascade helpers (separate files, run inside the same tx): `sales-cascade.tryCascadeJcComplete`, `osp-cascade.generateOspPrForOp`, `qc-stock-cascade.tryApplyQcStockCascade`, `nc-register/cascades.autoCreateNcFromQcReject`.

## Entry Points
Web `apps/web/src/modules/op-entry/` (`api.ts` + routes/components). Primary operator screen; also a critical e2e flow per CLAUDE.md §9.

## Business Logic
**Op-log types:** `start` (qty 0, opens/records a session), `complete` (production qty good/reject), `qc` (inspection accept/reject). Chosen by which endpoint is called; enforced by RLS INSERT policies per role.

**`submitOpLog` (production complete):**
1. Rejects `outsource` ops (use procurement flow) and `qc` ops (use `/qc-log`).
2. Reads availability snapshot: if `computed_status='qc_pending'` → block (waiting for QC); if `qty > available` → block (cannot exceed planned qty). Both checks read `v_jc_op_status`, not a recomputation.
3. Inserts `op_log` (`log_type='complete'`).
4. Post-insert, if availability now `0`: transitions any `running` session for the op to `done` (sets `ended_at`); if the **next** op (op_seq+1) is QC/qc_required and has no `qc_call_date`, backfills it to this log_date (signals QC that the op is ready); calls `tryCascadeJcComplete`.
5. Emits `OP_COMPLETE` activity keyed by JC code.

**`submitQcLog` (QC inspection):**
1. Op must be QC-bearing (`op_type='qc'` OR `qc_required`), else reject.
2. Reads `qc_pending` from the view: rejects if none pending or if `qty + reject_qty > qc_pending`.
3. Backfills `qc_call_date` if null (most recent prior op's complete-log date, fallback to today) and sets `qc_attended_date = log_date`.
4. Inserts `op_log` (`log_type='qc'`) with accepted `qty`, `reject_qty`, TPI metadata, and optional QC report attachment (path/name).
5. **Auto-NC:** if `reject_qty > 0` → `autoCreateNcFromQcReject` (NC register) in the same tx.
6. **Stock cascade:** if accepted `qty > 0` AND this is the JC's last op → `tryApplyQcStockCascade` writes a `store_transactions` IN crediting the JC's item.
7. `tryCascadeJcComplete`, then emits `OP_QC` activity (accepted + rejected in detail).

**`startOp`:** rejects outsource ops; requires `available > 0`; inserts a `running_ops` row (`is_osp=false`). Uniqueness enforced by the two partial unique indexes — a `23505` becomes `ConflictError("Operation already running OR machine busy")`. Also appends a `start` op_log marker (qty 0) and emits `OP_START`.

**`stopOp`:** must be currently `running`; sets `stopped` + `ended_at`; emits `OP_STOP`.

**JC-complete cascade (`tryCascadeJcComplete`):** when a complete/QC log brings the JC to `v_jc_status.computed_status='complete'`, closes the source SO/JW line + header. Idempotent; no-op for source-less JCs / already-closed lines.

**OSP auto-PR (`generateOspPr`):** manager/admin only (deliberate delta from legacy where operators triggered on op-start). Creates PR, optional PO, op link, and audit rows in one transaction.

## Dependencies on Other Modules
- `jc-ops` / `job-cards` (the ops being logged; `v_jc_op_status` view).
- `nc-register` (`autoCreateNcFromQcReject`), `store-transactions` (QC stock credit), `sales-orders` + `job-work-orders` (close cascade), `purchase-requests`/`purchase-orders` (OSP), `operators`/`machines` masters, `activity-log`.
- `lib/auth` (`requireOpEntryRole`, `requireWriteRole`).

## User Roles / Access
- `start` / `complete` / `stop`: `requireOpEntryRole` = admin/manager/operator. RLS lets `operator` insert start/complete and touch only their own running_ops.
- `qc-log`: `requireOpEntryRole` at the service; RLS `op_log_qc_insert` allows `qc` role to insert qc logs (admin/manager also allowed).
- `osp-pr`: `requireWriteRole` = admin/manager only.
- Reads: any authenticated company user.

## Reports
Feeds every downstream progress number (JC status, prod lists, machine loading) via `op_log` sums in `v_jc_op_status`. Op-log history shown per op on the web screen. See also `op-log-viewer`.

## Imports / Exports
QC report file attachment (Storage `qc-docs`) referenced on qc logs. No spreadsheet import/export.

## Background Jobs
None server-side. **Realtime:** web subscribes to Supabase Realtime — `op_log` INSERTs filtered by `jc_op_id` (`useRealtimeOpLog`) and all `running_ops` changes company-wide via RLS (`useRealtimeRunningOps`) — invalidating TanStack Query caches; a 30s polling fallback also runs. Consistent with ADR-004 (Realtime only on hot shop-floor screens).
