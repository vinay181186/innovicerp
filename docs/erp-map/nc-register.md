# NC Register (Non-Conformance Register)
**Module key:** `nc-register` · **Domain:** Quality

## Purpose
Full lifecycle register of Non-Conformances (NC): quality rejects logged manually or auto-created from a QC reject. Supports create/edit (while pending), soft delete (while pending), a 5-way disposition workflow with cascades into production data, and a rework-close step. Surfaces the CAPA linked to each NC. Mirrors legacy `renderNCRegister` L22508 + `_disposeNC` L22618 + `_closeNCRework` L22708 + `_autoCreateNC` L3946.

## Pages / Screens
- **NC Register list** (`nc-register`) — searchable/filterable table (status, reason, JC, date range) with status + disposition badges, summary stat cards.
- **New / Edit / Detail** — `nc-register-form.tsx`; **Dispose panel** (`dispose-nc-panel.tsx`) for the disposition workflow. Badges: `nc-status-badge.tsx`, `nc-disposition-badge.tsx`.

## Database Tables
Owns **`nc_register`** (migration 0039+; `apps/api/src/db/schema.ts` L1724):
- Key cols: `id`, `company_id`, `code` (notNull), `nc_date`, `job_card_id` (FK jc, notNull), `jc_op_id` (FK jc_ops, set null), `op_seq`, `operation_text`, `qc_operation_text`, `item_id` (FK items, notNull), `item_code_text` (notNull snapshot), `item_name_text`, `so_code_text`, `machine_code_text`, `operator_text`, `rejected_qty` numeric(12,2), `reason_category` (enum), `reason`, `disposition` (enum, nullable), `disposition_date`, `disposition_by_text`, `disposition_remarks`, `rework_jc_code_text`, `rework_op_seq`, `rework_done_qty` numeric(12,2), `scrap_cost` numeric(12,2) default 0, `status` (enum default `pending`), `reported_by_text`, `time_logged`, audit cols, `deleted_at`.
- Enums: `nc_status` = `pending | disposed | rework_done | closed`; `nc_disposition` = `rework | scrap | use_as_is | return_to_vendor | make_fresh`; `nc_reason_category` = `dimensional | surface | material | process | operator_error | machine_fault | other`.
- Indexes: UNIQUE `nc_register_company_code_uniq (company_id, code)`; `nc_register_company_status_idx`, `nc_register_company_jc_idx`, `nc_register_company_date_idx`, `nc_register_jc_op_idx`, `nc_register_item_idx`. Checks: `rejected_qty > 0`; `rework_done_qty null OR >= 0`.
- RLS: `nc_register_company_read` (select, company); `nc_register_entry_write` (all, roles `admin`/`manager`/`operator`). Company-isolated.

Cascade writes touch: `jc_ops` (rework_qty), `op_log` (use_as_is), `job_cards` (make_fresh supplementary JC with `parent_nc_id`). Reads: `capa_records` (linked CAPA via `nc_refs @> [code]`), `items`, `operators`, `users`.

## API Endpoints
- `GET /nc-register` — list (search, status, reasonCategory, jobCardId, from/to date, limit/offset). Joins JC/op/item and linked CAPA code.
- `GET /nc-register/summary` — company-wide stat cards (declared before `/:id`).
- `GET /nc-register/:id` — single NC + linked CAPA code.
- `POST /nc-register` — create (201). Requires op-entry role.
- `PATCH /nc-register/:id` — light edit (date/reason/reportedBy/operator) — only while `pending`.
- `DELETE /nc-register/:id` — soft delete (204) — only while `pending`.
- `POST /nc-register/:id/dispose` — apply a disposition + cascades.
- `POST /nc-register/:id/close-rework` — close a rework-disposed NC, capture rework done qty.

## Services / Key Functions
- `listNcRegister`, `getNcRegister`, `getNcRegisterSummary` — reads; list uses a LATERAL join to resolve the linked CAPA code (`nc_refs @> to_jsonb(ARRAY[code])`).
- `createNcRegister(input, user)` — `requireOpEntryRole`; dup-code check, FK asserts (JC/item/op), snapshots item code, status `pending`, emits `CREATE NonConformance` activity-log.
- `updateNcRegister(id, input, user)` — pending-only; ConflictError otherwise; patches date/reason/reportedBy/operator; emits `EDIT`.
- `softDeleteNcRegister(id, user)` — pending-only (disposed/closed are permanent); emits `DELETE`.
- `disposeNcRegister(id, input, user)` → `{ result, nc }` — runs `disposeNcCascade` in-tx; emits `NC_DISPOSE` (+ a `CREATE JobCard` row on make_fresh).
- `closeNcRework(id, input, user)` — runs `closeNcReworkCascade`; emits `NC_CLOSE_REWORK`.
- **cascades.ts**: `disposeNcCascade` (5 paths), `closeNcReworkCascade`, `autoCreateNcFromQcReject` (called by op-entry `submitQcLog` in the same tx). All writes run inside `withUserContext` transactions.

## Entry Points
Web routes `nc-register` list/new/edit/detail. API `/nc-register` (+ `/summary`, `/:id/dispose`, `/:id/close-rework`). Auto-created from op-entry QC reject via `autoCreateNcFromQcReject`.

## Business Logic
- **Reason category** — one of 7 defect classes; defaults to `other` (auto-created NCs leave it blank until disposition). **rejected_qty must be > 0** (DB check).
- **Status machine**: `pending` → (dispose) → `disposed` (rework path) or `closed` (scrap/use_as_is/return_to_vendor/make_fresh); `disposed` + rework → (close-rework) → `closed`. `rework_done` is a valid interim status accepted by close-rework. Only `pending` NCs can be edited/deleted; disposed/closed are permanent.
- **Disposition cascades** (`disposeNcCascade`, all in one tx):
  - `rework` → status `disposed`; `jc_ops.rework_qty += rejected_qty` on the picked rework op (`reworkOpSeq` or NC's opSeq); stores `rework_op_seq`. Rework-qty is a PASSIVE audit column (does not re-route op-entry planned/actual).
  - `scrap` → status `closed`; stores `scrap_cost`.
  - `use_as_is` → status `closed`; appends an `op_log` row (`log_type='qc'`, qty=rejected, operator resolved by name against operators master, else null FK + note) with remarks "Use As Is — from <ncCode>". Requires resolved `op_seq` + `jc_op_id`.
  - `return_to_vendor` → status `closed`; no other cascade.
  - `make_fresh` → status `closed`; creates a supplementary Job Card (`<originCode>-S<n>`) inheriting origin item / source SO/JW link, `order_qty = rejected_qty`, `parent_nc_id` = this NC; stores `rework_jc_code_text`.
- **Close-rework** — flips a rework-disposed (`disposed`/`rework_done`) NC to `closed`, optionally storing `rework_done_qty` (≥0). Rejects if disposition isn't `rework`.
- **Auto-NC from QC reject** — `autoCreateNcFromQcReject` generates code `NC-AUTO-<jcCode>-Op<seq>-<HHMMSSmmm>` (ms suffix + retry-with-nonce on collision), snapshots item code, `reason_category='other'`, status `pending`; emits a CREATE audit row. Runs in the SAME tx as the QC log so rollback unwinds both.
- **Linked CAPA** — resolved by scanning `capa_records.nc_refs` jsonb array for the NC code (earliest CAPA wins), surfaced as `linkedCapaCode`.
- Every mutation emits an activity-log row (CREATE / EDIT / DELETE / NC_DISPOSE / NC_CLOSE_REWORK).

## Dependencies on Other Modules
- **job-cards / jc-ops** — FK targets; rework updates jc_ops.rework_qty; make_fresh creates a supplementary JC.
- **op-entry** — calls `autoCreateNcFromQcReject`; use_as_is writes an op_log row.
- **items**, **operators**, **users** — FK / name resolution. **capa** — reverse link via nc_refs. **activity-log** — audit trail.

## User Roles / Access (qc role matters here)
Read: any authenticated company user. Write (create/edit/delete/dispose/close-rework): **op-entry roles = `admin`/`manager`/`operator`** (`requireOpEntryRole`; RLS `nc_register_entry_write` lists admin/manager/operator). Note: the `qc` role is NOT in the NC write set — QC rejects flow in via op-entry's auto-create, not direct NC writes.

## Reports
`GET /nc-register/summary` — company-wide stat cards: total, pending, total rejected qty, rework qty, scrap qty. The filterable list is the working report.

## Imports / Exports
None (auto-create is an internal cascade, not a file import).

## Background Jobs
None.
