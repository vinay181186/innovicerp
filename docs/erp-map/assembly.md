# Assembly Tracker
**Module key:** `assembly` · **Domain:** Catalog & Engineering

## Purpose
Per-Equipment-SO assembly readiness and unit tracking. Rolls up child-component availability against the SO's BOM to compute how many equipment units can be assembled, records each assembled unit (with serial no.), and tracks per-unit dispatch. Supports a manual readiness override per component.

## Pages / Screens
Web routes under `apps/web/src/modules/assembly/routes/`:
- `assemblies` (list.tsx) — all Equipment SOs with orderQty / assembled / dispatched counts + derived status.
- `assemblies/$soId` (detail.tsx) — component readiness table, assembled units, dispatch actions, readiness overrides.

## Database Tables
- `assembly_units` (L2603) — one row per assembled unit: `sales_order_id` (→sales_orders, cascade), `so_code_text`, `unit_no`, `serial_no`, `assembly_date`, `assembled_by`, `bom_master_id`, `part_no_text`, `customer_text`, `dispatched` bool + `dispatch_date/by/remarks`, `deductions` jsonb. Unique (sales_order_id+unit_no). Indexes on company+dispatched, serial_no. CHECK unit_no > 0.
- `assembly_tracking` (L2664) — manual override per (SO, child item code): `child_item_code`, `child_item_id` (→items, nullable), `ready_qty_override` (default 0), `remarks`. Unique (sales_order_id+child_item_code). CHECK override >= 0.

Both: `company_id`, audit columns, soft delete, RLS company_read / manager_write.

## API Endpoints
`routes.ts` (auth required):
- GET `/assemblies` — list Equipment SOs with counts.
- GET `/assemblies/:soId` — full readiness tracker for one SO.
- POST `/assemblies/:soId/units` — mark next unit assembled (201). Write role.
- PATCH `/assemblies/units/:unitId/dispatch` — mark a unit dispatched. Write role.
- DELETE `/assemblies/:soId/units/last` — undo the last (non-dispatched) unit. Write role.
- PUT `/assemblies/:soId/overrides/:childCode` — set readiness override for a component. Write role.

## Services / Key Functions
`service.ts` (all in `withUserContext` tx):
- `getAssemblyTracker(soId, user)` → header + components[] + rollup + units[]. The main aggregator.
- `listAssemblies(user)` → Equipment SOs with orderQty/assembled/dispatched + status (multi-query join in memory).
- `markUnitAssembled(soId, input, user)` → unit — computes next unit_no, caps at orderQty; emits ASSEMBLED.
- `markUnitDispatched(unitId, input, user)` → unit — blocks if already dispatched; emits DISPATCHED.
- `undoLastUnit(soId, user)` → `{ok, removedUnitNo}` — soft-deletes latest unit; blocked if dispatched; emits UNDO_ASSEMBLY.
- `setReadinessOverride(soId, childCode, input, user)` → `{ok}` — upsert (revives soft-deleted row); emits OVERRIDE_READY.

## Entry Points
Nav → Assembly / Assemblies list. Only surfaces SOs of `type='equipment'`. BOM comes from the SO's `bom_master_id`.

## Business Logic
- Only Equipment-type SOs apply (`markUnitAssembled` rejects non-equipment).
- Per-component readiness math: `totalNeed = qtyPerSet × unitsRequired`; `autoReadyQty = min(stockQty, totalNeed)`; `finalReady = max(autoReadyQty, overrideQty)`; `shortfall = max(0, totalNeed − finalReady)`; `enoughForUnits = floor(finalReady / qtyPerSet)`. Component status: ready / enough_for_some / shortage.
- `unitsRequired` = SUM of SO line order_qty. Rollup: `canAssembleAdditional = min(enoughForUnits across components)` capped by remaining (unitsRequired − assembledQty); bottleneck = component with the min enoughForUnits. SO status: done (assembled≥order) / assembling (assembled>0) / ready (canAssemble>0) / waiting.
- Stock read from `item_stock_balances.on_hand_qty`. Equipment SO without a BOM → empty components, canAssemble 0.
- Unit numbering: next unit_no = MAX+1; cannot exceed unitsRequired; uniqueness backed by partial unique index (race → ConflictError).
- Dispatch is one-way and blocks re-dispatch; undo requires the unit not be dispatched.
- Override upsert revives a soft-deleted tracking row; best-effort resolves child_item_id from code.
- Defensive: legacy SOs with a non-UUID `bom_master_id` are skipped in the list (bomCode null).
- Audit: ASSEMBLED / DISPATCHED / UNDO_ASSEMBLY / OVERRIDE_READY emit `activity_log`.

## Dependencies on Other Modules
- `sales-orders` (`sales_orders`, `sales_order_lines`) — Equipment SO header + line qty source.
- `bom-master` (`bom_masters`, `bom_master_lines`) — component list + qty_per_set.
- `items` + `item_stock_balances` — component names + on-hand stock.
- `activity-log` — audit.

## User Roles / Access
- Read: any authenticated company user (RLS company_read).
- Assemble / dispatch / undo / override: admin/manager (`requireWriteRole` + RLS manager_write).

## Reports
Readiness rollup and per-SO assembled/dispatched counts serve as an operational assembly-status report; no separate export.

## Imports / Exports
None.

## Background Jobs
None (readiness derived live on each read).
