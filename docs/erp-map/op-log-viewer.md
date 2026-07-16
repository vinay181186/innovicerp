# Op Log Viewer
**Module key:** `op-log-viewer` (web dir: `op-log`) · **Domain:** Job Work & Production Execution

## Purpose
Read-only, paginated, human-readable view of the `op_log` table — every start/complete/qc entry joined to its op, job card, item, machine and creating user. Mirrors legacy `renderOpLog`. Deliberately **no delete action** (legacy `delLog` hard-deleted rows, which violated Rule #8 and broke downstream qty-done recalc since every module's progress comes off `op_log` sums); corrections are made via a new reversing log entry instead.

## Pages / Screens
- `op-log` — filterable log grid (web `apps/web/src/modules/op-log/routes/list.tsx`).

## Database Tables
Owns none. Reads `op_log` joined to `jc_ops`, `job_cards`, `items`, `machines`, `users`. Company-scoped + RLS via `withUserContext`.

## API Endpoints
`routes.ts`, authenticated:
- `GET /op-log` — paginated log list. Filters (schema in `op-log-viewer/schema.ts`): `jcNo` (ILIKE on JC code), `logType` (`start`|`complete`|`qc`), `shift`, `operatorId`, `fromDate`/`toDate`, `limit` (≤200, default 50), `offset`.

## Services / Key Functions
`service.ts` (public):
- `listOpLog(input, user)` → `{ items, total, limit, offset }`. Drizzle query: `op_log ⨝ jc_ops ⨝ job_cards ⨝ items ⨝ machines(left) ⨝ users(left)`; projects log no/type/date, JC code, item code, op seq/operation, machine code (falls back to `machine_code_text`), shift, qty, reject qty, operator name, remarks, TPI flag, QC report path/name, created-at + created-by name. Ordered by `log_date DESC, created_at DESC, log_no ASC`. Count runs in parallel over the same filters.

## Entry Points
Web `apps/web/src/modules/op-log/` (`api.ts`, `routes/list.tsx`). Note: API module dir is `op-log-viewer`; web module dir is `op-log`.

## Business Logic
- **Read-only by design** — no create/update/delete. Op-log entries are written by the `op-entry` module and are immutable (ADR-011 #4). This viewer never mutates.
- **Machine display fallback:** shows master machine code, or the denormalized `machine_code_text` (e.g. `'QC'`) when there's no machine FK.
- **Filtering** by JC number, log type, shift, operator and date range; capped page size 200.
- Own local `schema.ts` (not re-exported from shared): `opLogTypeSchema`, `listOpLogQuerySchema`, `opLogListItemSchema`, `listOpLogResponseSchema`.

## Dependencies on Other Modules
- `op-entry` (producer of the rows viewed); `jc-ops`/`job-cards`, `items`, `machines`, `operators`/`users` for display joins.

## User Roles / Access
Read: any authenticated company user (RLS company read on `op_log`). No writes.

## Reports
This module is itself the op-log report/audit surface.

## Imports / Exports
None.

## Background Jobs
None.
