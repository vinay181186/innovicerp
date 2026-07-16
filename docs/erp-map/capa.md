# CAPA (Corrective & Preventive Action)
**Module key:** `capa` · **Domain:** Quality

## Purpose
Records corrective/preventive actions raised (typically) against one or more NCs. Implements the legacy 5-step CAPA process — problem → root cause → corrective action → verification → preventive/effectiveness review — with an Open→In Progress→Verified→Closed status flow and effectiveness tracking. Mirrors legacy `renderCAPA` L22779 + `_capaNew`/`_capaEdit`.

## Pages / Screens
- **CAPA list** (`capa`) — table with counters (total/open/in-progress/verified/closed + effectiveness %), overdue flagging. Create/edit handled via list-page form/modal.

## Database Tables
Owns **`capa_records`** (migration 0036; `apps/api/src/db/schema.ts` L4321):
- Cols: `id`, `company_id`, `code` (`CAPA-NNNN`), `type` (text default `Corrective` — Corrective|Preventive), `capa_date`, `nc_refs` (jsonb array of NC codes, default `[]`), `jc_no`, `so_no`, `item_code`, `operation`, `problem` (notNull), `root_cause_method`, `root_cause`, `corrective_action`, `responsible`, `target_date`, `verification`, `verified_by`, `verified_date`, `preventive_action`, `effectiveness` (Effective|Not Effective|Monitoring|''), `review_date`, `status` (text default `Open`), `department`, audit cols, `deleted_at`.
- Indexes: UNIQUE `capa_records_company_code_uniq (company_id, code)`; `capa_records_company_status_idx (company_id, status)` (both `where deleted_at is null`).
- RLS: `capa_records_company_read` (select, company); `capa_records_qc_write` (all, roles `admin`/`manager`/`qc`). Company-isolated.
- Enum-ish (Zod, not DB enums): `CAPA_TYPES` [Corrective, Preventive]; `CAPA_STATUSES` [Open, In Progress, Verified, Closed]; `CAPA_EFFECTIVENESS` ['', Effective, Not Effective, Monitoring]; `CAPA_RC_METHODS` [5-Why, Fishbone, Other].

## API Endpoints
- `GET /capa` — list + counters. Any authenticated user.
- `POST /capa` — create. Roles `admin`/`manager`/`qc` via RLS.
- `PATCH /capa/:id` — update (5-step fields + status). Same roles.

(No delete endpoint — CAPA records are not soft-deleted from the API.)

## Services / Key Functions
- `listCapa(user)` → `{ items, counters }` — orders by capa_date desc; computes `overdue` per record + counters incl. `effectivenessPct` (Effective / closed × 100).
- `createCapa(input, user)` → `CapaRecord` — generates next `CAPA-NNNN` (`nextCapaNo` scans existing codes for max), status `Open`.
- `updateCapa(id, input, user)` → `CapaRecord` — patches only provided fields; `''` clears date fields (target/verified/review); NotFound if absent.
- `toRecord` — maps row → API shape and derives `overdue`.
No explicit multi-table transactions (single-table writes inside `withUserContext`).

## Entry Points
Web route `capa`. API `GET/POST /capa`, `PATCH /capa/:id`.

## Business Logic
- **Code** auto-generated `CAPA-<0000>` — next number is max existing +1, zero-padded to 4.
- **5-step model** captured in columns: (1) problem + nc_refs/context, (2) root cause — `root_cause_method` (5-Why/Fishbone/Other) + `root_cause`, (3) `corrective_action` + `responsible` + `target_date`, (4) `verification` + `verified_by` + `verified_date`, (5) `preventive_action` + `effectiveness` + `review_date`.
- **Status flow**: Open → In Progress → Verified → Closed (free-set via update).
- **Overdue** = status not Closed and not Verified AND `target_date < today`.
- **Effectiveness %** = Effective-rated closed CAPAs / total closed CAPAs.
- **NC linkage** — `nc_refs` jsonb array of NC codes; the NC Register reads this back (via `@>` containment) to show each NC's linked CAPA.
- Create defaults: `capa_date` = today if unset, `type` from input, status `Open`.

## Dependencies on Other Modules
- **nc-register** — CAPAs reference NC codes in `nc_refs`; NC Register resolves the reverse link. Context fields (`jc_no`, `so_no`, `item_code`, `operation`) are text snapshots, not FKs.
- **companies**, **users** — FK owners/audit.

## User Roles / Access (qc role matters here)
Read: any authenticated user. Write (create/update): `admin`/`manager`/`qc` per `capa_records_qc_write` RLS — the `qc` role is a first-class writer of CAPA records.

## Reports
Counters block (total/open/in-progress/verified/closed + effectiveness %) is the summary report; the list itself is filterable in-page.

## Imports / Exports
None.

## Background Jobs
None.
