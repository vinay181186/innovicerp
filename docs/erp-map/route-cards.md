# Route Cards
**Module key:** `route-cards` · **Domain:** Catalog & Engineering

## Purpose
Defines the standard operation sequence (routing) for manufacturing an item — the ordered list of machine/QC/outsource steps with cycle times, programs, tooling, and OSP vendors. One active route card per item; serves as the default-ops source when creating Plans and Job Cards.

## Pages / Screens
Web routes under `apps/web/src/modules/route-cards/routes/`:
- `route-cards` (list.tsx) — searchable list with item filter; per-row op count + current revision.
- `route-cards/$id` (detail.tsx) — header, ordered ops (with machine/vendor display), revision history.
- `route-cards/new` (new.tsx) — create a route card.
- `route-cards/$id/edit` (edit.tsx) — edit (bumps revision).

## Database Tables
- `route_cards` (L558) — header: `code`, `item_id` (→items), `current_revision` (int, default 1), `notes`. Unique `route_cards_company_code_uniq` (company+code) and `route_cards_company_item_uniq` (company+item — one active RC per item). Index on item_id. RLS company_read / manager_write.
- `route_card_ops` (L605) — one row per step: `op_seq`, `machine_id` (→machines, nullable) + `machine_code_text` fallback, `operation`, `op_type` (opTypeEnum, default 'process'), `cycle_time_min` numeric(10,2), `program`, `tool_no`, `tool_details`, `qc_required` bool, OSP fields (`osp_vendor_id`→vendors, `osp_vendor_code_text`, `osp_lead_days`). Unique (route_card_id+op_seq). Indexes on machine_id, osp_vendor_id. Cascade delete on route card.
- `route_card_revisions` (L665) — append-only: `revision_no`, `notes`, `ops_snapshot` jsonb. Unique (card+revision_no). Insert-only RLS.

All: `company_id`, audit columns, soft delete (revisions insert-only).

## API Endpoints
`routes.ts` (auth required):
- GET `/route-cards` — list (`listRouteCardsQuerySchema`: search, itemId, limit, offset).
- GET `/route-cards/:id` — detail.
- POST `/route-cards` — create (201). Write role.
- PUT `/route-cards/:id` — update / new revision. Write role.
- DELETE `/route-cards/:id` — soft delete. Admin only.

## Services / Key Functions
`service.ts` (all in `withUserContext` tx):
- `listRouteCards(query, user)` → list with itemCode/Name + opCount (raw SQL, LATERAL count).
- `getRouteCard(id, user)` → detail (ops joined to machine + OSP vendor display, revisions desc).
- `createRouteCard(input, user)` → detail — one-active-RC-per-item guard; revision 1 + snapshot.
- `updateRouteCard(id, input, user)` → detail — bumps revision, snapshots PRE-update ops, replaces ops; if item re-pointed, re-checks the one-per-item rule.
- `softDeleteRouteCard(id, user)` → header — admin only.
- `computeRouteCardDiffNote(oldOps, newOps)` — exported diff-note helper keyed by op_seq.

## Entry Points
Nav → Route Cards. Consumed by `plans` via `getDefaultRouteOpsForItem` ("Load default ops" button) and indirectly by Job Card creation.

## Business Logic
- `code` auto-generated as `IN-RC-NNNNN` (next numeric suffix per company) when not supplied; supplied codes dup-checked.
- One active route card per item per company — enforced by DB partial unique index and a friendly ConflictError in the service (create + re-point on update).
- Op types: `process` (machine step, machine_id or code text), `qc` (inspection; machine null, code text 'QC'), `outsource` (OSP; vendor id or code text + lead days).
- Revision lifecycle mirrors BOM: create=rev1+snapshot; update bumps revision, snapshots PRE-update ops, auto diff note when none supplied. Ops hard-deleted + re-inserted (pre-state in snapshot); one transaction.
- Referenced machines and OSP vendors validated to exist (ValidationError listing missing ids).
- Delete is admin-only; no link block (downstream JCs use op snapshots, not live FK).
- Audit: CREATE/EDIT/DELETE emit `activity_log` entity='Route Card'.

## Dependencies on Other Modules
- `items` — item validation + display; enforces one RC per item.
- `machines` — op machine references.
- `vendors` — OSP vendor references.
- `activity-log` — audit.
- Referenced BY: `plans` (`getDefaultRouteOpsForItem` copies ops into a plan), job-cards routing.

## User Roles / Access
- Read: any authenticated company user (RLS company_read).
- Create/edit: admin/manager (`requireWriteRole` + RLS manager_write).
- Delete: admin only (explicit service check).

## Reports
None dedicated.

## Imports / Exports
None (no xlsx/csv/pdf in this module).

## Background Jobs
None.
