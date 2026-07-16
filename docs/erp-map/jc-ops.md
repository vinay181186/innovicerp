# JC Operations Board (JC Ops)
**Module key:** `jc-ops` · **Domain:** Job Work & Production Execution

## Purpose
Flat, enriched cross-JC list of every Job Card Operation (`jc_ops`) — the "JC Ops board". A JC Op is one step in a Job Card's routing (turning, milling, QC, outsource, etc.). This module provides the board read and the machine-reassignment action. Status/qty derivation comes from the `v_jc_op_status` view (SQL mirror of legacy `calcEngine`). Mirrors legacy `renderJCOps`.

## Pages / Screens
- `jc-ops` — board list (`routes/list.tsx`).

## Database Tables
Owns **`jc_ops`** (shared with the job-cards module, which creates them). Reads `job_cards`, `items`, `machines`, `vendors`, `purchase_requests`, `purchase_order_lines`, `purchase_orders`, view `v_jc_op_status`.

**`jc_ops`** (L780). Key cols:
- `job_card_id` FK (ON DELETE CASCADE), `op_seq`, `machine_id` → machines, `machine_code_text`, `operation` (not null), `op_type` (`op_type` enum: `process`|`qc`|`outsource`, default `process`), `cycle_time_min` (numeric, minutes), `program`, `tool_no`, `tool_details`, `qc_required` (bool), `qc_call_date`, `qc_attended_date`, `rework_qty`.
- Outsource/OSP: `outsource_vendor_id` → vendors, `outsource_vendor_text`, `outsource_cost`, `outsource_status` (enum), `outsource_pr_id` → purchase_requests (SET NULL), `outsource_po_line_id` → purchase_order_lines (SET NULL), `outsource_dc_no`, `outsource_sent_qty`, `outsource_sent_date`, `outsource_returned_qty`.
- Scheduling (migration 0034): `queue_position`, `planned_start`, `planned_end` (all nullable).
- Indexes: unique `(job_card_id, op_seq) where deleted_at is null`; `(machine_id)`; `(company_id, op_type)`; `(outsource_vendor_id) where op_type='outsource'`; `(outsource_pr_id)`; `(outsource_po_line_id)`. RLS: `company_read` / `manager_write`.

## API Endpoints
`routes.ts`, authenticated:
- `GET /jc-ops` — board list (optional `jcCode` filter, `search` on JC code / operation / item code; paginated; also returns `jcOptions` for the JC dropdown).
- `PATCH /jc-ops/:id/machine` — reassign the op to a different machine.

## Services / Key Functions
`service.ts` (public):
- `listJcOpsBoard(input, user)` → `{ items, total, limit, offset, jcOptions }`. Raw SQL over `jc_ops ⨝ job_cards ⨝ items ⨝ machines ⨝ vendors ⨝ purchase_requests ⨝ purchase_order_lines ⨝ purchase_orders ⨝ v_jc_op_status`. Per op returns qty flow (`inputAvail`, `completed`, `qcAccepted`, `qcPending`, `available`), `cycleTime` (converted minutes→hours), `pendingHrs = round(cycle_min × available / 60)`, computed `status`, and OSP fields (vendor/PR/PO codes, sent qty). Ordered by JC code then op_seq.
- `changeJcOpMachine(jcOpId, input, user)` → `{ ok: true }`. Verifies the op is still editable (computed status must be `waiting` or `available` — no logged work), verifies target machine exists in the company, then updates `machine_id` + `machine_code_text`.

## Entry Points
Web `apps/web/src/modules/jc-ops/` (`api.ts`, `routes/list.tsx`). Board used by production supervisors to see all ops and re-slot machines.

## Business Logic
- **Status source of truth:** `v_jc_op_status` — the SQL mirror of legacy `calcEngine`. Derives per-op `computed_status`, `input_avail`, `completed_qty`, `qc_accepted_qty`, `qc_pending`, `available`. This module never recomputes qty; it reads the view.
- **Op sequencing / routing:** ops belong to a JC and are ordered by `op_seq` (unique per JC). Availability of an op depends on upstream ops' completed qty (encoded in the view's `input_avail`).
- **Pending hours:** `available_pcs × (cycle_time_min / 60)` — feeds machine loading.
- **Machine reassignment guard:** allowed only while status is `waiting`/`available` (before any op_log). If logged work exists (`in_progress`/etc.), `ConflictError`. Both `machine_id` and the denormalized `machine_code_text` are updated together.
- **OSP visibility:** outsource ops surface their vendor, PR code, PO code and sent qty joined from procurement tables.

## Dependencies on Other Modules
- `job-cards` (owner/creator of `jc_ops` rows), `machines`, `vendors`, `items`, procurement (`purchase-requests`, `purchase-orders`) for OSP display, and `v_jc_op_status`.
- Sibling of `op-entry` (which writes the op_log that drives the view) and `machine-loading` (consumes the same pending-hrs math).

## User Roles / Access
Read: authenticated company user. Machine change: company user within RLS (`manager_write` gates the underlying update; service enforces the status guard). Editable only pre-work.

## Reports
The board itself is the operational report (qty flow, pending hrs, OSP status per op).

## Imports / Exports
None.

## Background Jobs
None.
