# Party Material GRN (Client-Supplied Material Receipt)
**Module key:** `party-grn` · **Domain:** Procurement & Store

## Purpose
Records client-supplied raw material **received against a Job Work order**. Multi-line receipt document. Each line increments the linked `party_materials` on-hand (`stock_qty`) and cumulative `received_qty`. This is the party-material analogue of a vendor GRN, but the material is client-owned and tracked in the party-material ledger rather than company item stock. Numbering: `PGRN-NNNNN`. Mirrors legacy `renderPartyGRN` / `addPartyGRN`.

## Pages / Screens
- `apps/web/src/modules/party-grn/routes/list.tsx` — Party GRN list + 3-tile summary (total GRNs / total received / today)

## Database Tables
**`party_grn`** (owned) — schema.ts L2950
- Key cols: `code` (unique per company, `PGRN-NNNNN`), `grn_date`, `job_work_order_id` (FK jobWorkOrders, set null)/`jw_code_text`, `client_id` (FK clients, set null)/`client_code_text`, `client_po_no`, `dc_no`, `remarks`, `received_by_text`.
- Indexes: unique `(company_id, code)`; `(company_id, grn_date)`; `(company_id, job_work_order_id)`; `(company_id, client_id)` — where not deleted.

**`party_grn_lines`** (owned) — schema.ts L3006
- Key cols: `party_grn_id` (FK, cascade), `line_no`, `party_material_id` (FK party_materials, set null), `party_material_code_text` (notNull snapshot), `party_material_name`, `received_qty`, `jw_line_no_text`, `remarks`.
- Indexes: `(party_grn_id, line_no)`; `party_material_id` — where not deleted.

Both: `company_id` + audit; RLS `company_read` + `manager_write`.

## API Endpoints
routes.ts (authenticated):
- `GET /party-grn` — list (search, jobWorkOrderId, clientId, fromDate, toDate) + summary
- `GET /party-grn/next-code` — allocate next `PGRN-NNNNN`
- `GET /party-grn/:id` — detail (header + lines)
- `POST /party-grn` — create → 201

No update/delete endpoints — party GRN is create-only (append-style receipt record).

## Services / Key Functions
service.ts:
- `nextPartyGrnCode` / `getNextPartyGrnCode` — MAX(code suffix)+1, `PGRN-` padded 5.
- `listPartyGrn(input, user)` — raw SQL, client join + per-GRN line/received aggregates + 3-tile summary query.
- `getPartyGrnDetail(id, user)` — header + lines.
- `createPartyGrn(input, user)` → header — **transaction**:
  1. Validate the Job Work Order exists.
  2. Validate all referenced party materials exist; **lock each `party_materials` row `FOR UPDATE`**.
  3. Insert header (snapshots jw code, client id/po from the JW).
  4. Per line: insert line + `UPDATE party_materials SET stock_qty += received, received_qty += received`. Local cache accumulates so repeated same-material lines add up.
  - Requires at least one line (ValidationError otherwise).

## Entry Points
- `partyGrnRoutes` (Fastify). Reads job-work-orders + party-materials; mutates party-material stock counters.

## Business Logic
- **Client-material receipt against a JW:** header is bound to a Job Work Order and inherits its client + client PO number.
- **Stock ledger:** every received qty bumps the party-material's `stock_qty` and `received_qty`. This is the counterpart of party-material issue (which decrements stock, increments issued).
- **Concurrency:** `FOR UPDATE` locks on party-material rows prevent lost updates when two receipts hit the same material.
- **Code snapshot:** line stores `party_material_code_text`/`name` so history survives if the master changes.
- Create-only: corrections are handled by a new receipt, not edit/delete (no mutation endpoints exposed).

## Dependencies on Other Modules
- job-work-orders (header binding + client/PO snapshot), party-materials (stock counter mutation), clients (display).

## User Roles / Access
Read: any company user. Create: admin/manager (RLS `manager_write`). (Write enforced by RLS; service does not call requireWriteRole explicitly.)

## Reports
3-tile summary (total GRNs, total received qty, today's count) across all company party GRNs. List aggregates lines + received per GRN.

## Imports / Exports
None (a DC number field records the accompanying delivery challan reference).

## Background Jobs
None.
