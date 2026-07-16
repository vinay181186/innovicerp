# Party Materials (Customer-Supplied Material Master)
**Module key:** `party-materials` · **Domain:** Procurement & Store

## Purpose
Catalogue of raw materials **supplied by clients** for Job Work orders — material the shop does not own but must track (client-owned inventory). Distinct from the `items` master. Each record carries its own stock ledger fields: on-hand (`stock_qty`), `issued_qty`, `received_qty`. These counters are mutated by downstream flows (Party GRN increments stock+received; JW Issue increments issued and decrements stock). This module owns only the master record. Numbering: `PM-NNNN`.

## Pages / Screens
- `apps/web/src/modules/party-materials/routes/list.tsx` — party-material list (search/client filter)

## Database Tables
**`party_materials`** (owned) — schema.ts L2892
- Key cols: `code` (unique per company, `PM-NNNN`), `name`, `description`, `material`, `uom` (default 'NOS'), `client_id` (FK clients, set null)/`client_code_text`, `item_id` (FK items, set null)/`item_code_text`, `stock_qty`, `issued_qty`, `received_qty` (all int default 0).
- Indexes: unique `(company_id, code)`; `(company_id, client_id)`; `(company_id, item_id)` — where not deleted.
- `company_id` + audit; RLS `company_read` + `manager_write`.

## API Endpoints
routes.ts (authenticated):
- `GET /party-materials` — list (search, clientId)
- `GET /party-materials/next-code` — allocate next `PM-NNNN`
- `GET /party-materials/:id` — detail
- `POST /party-materials` — create → 201
- `PATCH /party-materials/:id` — update
- `DELETE /party-materials/:id` — soft delete

## Services / Key Functions
service.ts:
- `nextPartyMaterialCode(tx, companyId)` / `getNextPartyMaterialCode(user)` — MAX(code suffix)+1, `PM-` padded 4.
- `listPartyMaterials(input, user)` — raw SQL with client + item joins.
- `getPartyMaterial(id, user)` — single record.
- `createPartyMaterial(input, user)` — dup-code check, client existence check, optional item resolution; inserts with stock/issued/received = 0.
- `updatePartyMaterial(id, input, user)` — field patch; re-resolves client/item on change.
- `softDeletePartyMaterial(id, user)` — **blocked if `stock_qty > 0`** (must issue material back first).

Note: stock counters are NOT written here — only by party-grn (receive) and JW-issue flows.

## Entry Points
- `partyMaterialsRoutes` (Fastify). Referenced by party-grn (lines link `party_material_id` and bump its counters).

## Business Logic
- **Client-owned inventory:** party materials belong to a client, tracked separately from company `items`. Optional `item_id` cross-links to the internal item master.
- **Stock counters are derived by downstream services**, never edited directly: Party GRN `+stock_qty +received_qty`; JW material issue `+issued_qty -stock_qty`.
- **Delete guard:** cannot delete while on-hand stock exists.
- **Numbering:** server-allocated `PM-NNNN` inside the request tx.

## Dependencies on Other Modules
- clients (owner), items (optional cross-link), party-grn (mutates counters), JW DC / job-work-orders (issue flow — decrements stock).

## User Roles / Access
Read: any company user. Create/update/delete: admin/manager (RLS `manager_write`). (Service does not call an explicit requireWriteRole; write is enforced by RLS.)

## Reports
None dedicated. List shows per-material stock/issued/received snapshot.

## Imports / Exports
None.

## Background Jobs
None.
