# BOM_STORE_AUDIT_REPORT.md — Integrated BOM · Material Readiness · Store Issue · Returnables (Phase 1 audit)

Read-only audit + minimal-change design. No code, database or config changed. Nothing committed.

**Base:** worktree `C:\Innovic_projects\innovic-erp\wt-test`, branch `test`, commit `3d31ec0b` (fast-forwarded from `7e6119a5` at the start of this audit; includes ADR-179 partial Production Order close, migration 0140). All paths relative to that root; every line number from `grep -n` / `sed -n`.

**Companion:** `RM_AUDIT_REPORT.md` (repo root — `docs/specs/RM_AUDIT_REPORT.md` does not exist; the file was written at the root on 2026-09-22). Its section numbers are cited below as **RM §x**. Nothing it already establishes is re-derived here.

**Missing inputs:** `docs/specs/` did not exist. The "integrated workflow/UI reference HTML" and the "RM spec docx" named in the brief are **NOT PRESENT** anywhere under `C:\Innovic_projects\innovic-erp\` (only JC/SO/PO list mock-ups and a theme PDF). This audit therefore uses the specification text of the brief itself as the target; nothing was inferred from a UI reference.

Conventions: **NOT PRESENT** = looked for, does not exist. "PO" is written out as **Production Order** or **Purchase Order** throughout. RLS is bypassed by the API connection (RM §1m); "permission" below always means the `requireFormAccess` / `require*Role` guard in the service.

---

## PART 1 — EXISTING ARCHITECTURE (the 25 questions)

### 1. Existing architecture found
RM §0.1–0.3: pnpm monorepo; Fastify 5 + Drizzle + `postgres` driver on Railway (`railway.json`); React 18 / Vite / TanStack on Cloudflare Pages; Supabase Postgres ×2 (PROD, TEST) + one Storage bucket `qc-docs`; hand-written forward-only SQL migrations applied by `apply-sql.ts`, highest now **0140** (`apps/api/src/db/migrations/0140_*.sql`). Every write = `withUserContext` → `db.transaction` (`apps/api/src/db/with-user-context.ts:26-40`). Idempotency-Key plugin on every write (`apps/api/src/plugins/idempotency.ts`, RM §1q). No Supabase RPC anywhere (`grep -rn "\.rpc(" apps/api/src apps/web/src` → 0). No Realtime on stock screens.

### 2. Current BOM model and revision model
- Tables `bom_masters` / `bom_master_lines` / `bom_master_revisions` — RM §1b (`schema.ts:2776-2940`).
- **Single level, item-keyed.** A line is `(bom_master_id, child_item_id, qty_per_set numeric(12,2), bom_type manufacture|purchase|outsource, raw_material_grade/size FK+text)`; the header names `parent_item_id`. Nesting exists only *implicitly*: a child item may itself be `parent_item_id` of another BOM. There is **no `child_bom_master_id`, no level/path, no pinned child revision** — NOT PRESENT.
- Guards: parent may not be its own child (`bom-master/service.ts:127-143` `assertParentIsUsable`); duplicate child lines refused (`:145`). Deeper cycle detection (A→B→A across two BOMs): NOT PRESENT.
- Revision: integer `bom_masters.revision` (starts 1), bumped on every `updateBomMaster`; the PRE-update lines are snapshotted to `bom_master_revisions.items_snapshot jsonb` (`bom-master/service.ts:6-9`, `:726`). `status draft|active|obsolete` (`enums/bom-status.ts:7`). **Approved-revision concept: NOT PRESENT** — consumers always read the live lines, never a pinned revision (see §3, §7).
- Drawing revision lives on the SO/JWSO *line* (`sales_order_lines.revision`, ADR-178 `docs/DECISIONS.md:9520`), not on BOM lines — NOT PRESENT on BOM.
- Flags `traceability_required`, `is_critical`, `effective_from/to`: NOT PRESENT.
- Links out: `sales_orders.bom_master_id` is **`text`, not a FK** (`schema.ts:1414`; equipment SO), `sales_order_lines.source_bom_master_id` FK (`:1498`), `job_work_order_lines.source_bom_master_id` FK (`:1752`), `plans.bom_master_id` FK (`:3228`), `assembly_units.bom_master_id` FK (`:3408`).

### 3. Current BOM explosion logic
`getPlanningBom` — `apps/api/src/modules/so-planning/service.ts:1131-1329`, route `GET /so-planning/:id/bom/:lineId` (`so-planning/routes.ts:37`), UI `apps/web/src/modules/so-planning/components/bom-planning-modal.tsx`.
- BOM chosen = equipment SO's `sales_orders.bom_master_id` else the line's `source_bom_master_id` (`:1163-1167`).
- **One level only** (`bom_master_lines` of that BOM, `:1191-1199`). Per child: `totalNeed = qty_per_set × line.order_qty` (`:1289-1290`), `stockQty` = `item_stock_balances.on_hand_qty` (`:1203-1213`), `shortfall = max(0, totalNeed − stockQty)` (`:1292`). **Existing allocations, open Purchase Requests/Orders, open Production Orders and at-vendor qty are NOT subtracted** — only `plans` already raised for the same SO line + child code are shown as `existingPlan` (`:1215-1257`).
- Second explosion site: **BOM-8 cascade** `cascadeBomToSoLine` (`apps/api/src/modules/bom-master/cascade.ts:96`) — fired on SO create for every line with `source_bom_master_id` (`sales-orders/service.ts:1481-1487`) and on JWSO lines (`cascadeBomToJwLine`, `job-work-orders/service.ts:845,1129`); it **auto-spawns** a child Job Card (`manufacture`) or Purchase Request (`purchase`/`outsource`) per BOM line, qty = `order_qty × qty_per_set` (`cascade.ts:1-22`), idempotent per SO line. This is the opposite of the spec's "do not auto-create" rule (Part 1 §17, conflict C-3).
- Third: assembly readiness `computeListReadiness` / `computeSoCanAssemble` (`assembly/service.ts:1237-1388`) — same one-level maths, `finalReady = max(min(on_hand, need), readyQtyOverride)` (`:1319-1321`).
- Explosion never consumes stock (correct per spec).

### 4. Existing MAKE / BUY / OSP planning logic
- Item level: `items.procurement_type make|buy` (ADR-171, RM §1c); `bom_master_lines.bom_type manufacture|purchase|outsource`; `plans.plan_type manufacture|direct_purchase|full_outsource|assembly` (RM §1a); `route_cards.plan_type` default per item (0123).
- MAKE: Plan (`ops_source='route_card'`) → Production Order → Job Card (`production-orders/service.ts:616 createProductionOrder`, RM §1a). Old flow: `executePlan` (`plans/service.ts:1018`).
- BUY: `raisePlanningPr` (`so-planning/service.ts:1351`) → `purchase_requests.source_so_line_id`; or `plans.dp_pr_id` for a direct-purchase plan.
- MAKE+OSP: **not a separate type** — it is a route card with an `outsource` op; the Job Card stays open across the OSP leg (`jc_ops.outsource_*` counters, `v_osp_wip`, ADR-081 dual lane). Rule "only TPI may follow OSP; Final Inspection appended after a mid-route OSP" — ADR-179 B/C (`packages/shared/src/lib/jc-op-sequence.ts`, `apps/api/src/lib/jc-default-qc.ts`).
- SUBASSEMBLY: `plan_type='assembly'` (ADR-110) on a JWSO/SO line whose item is `item_type='assembly'` (`so-planning/service.ts:1274 supportsAssemblyPlan`); the Equipment SO path uses `assembly_units` instead (§7). A child subassembly *order* that feeds a parent Assembly Order: NOT PRESENT.
- Duplicate-supply guard: only `production_orders_plan_uniq` (one Production Order per plan) and the BOM-8 idempotency check; a planner can raise a second PR/plan for the same child by hand — no "uncovered requirement" ledger exists.

### 5. Existing Production / Job Card linkage
RM §1a chain (plans → production_orders → job_cards → jc_ops → op_log/running_ops; `job_cards.production_order_id`, `parent_job_card_id` for rework children). Finished-goods credit: RM §1o, now **progressive** under ADR-179 — `production_orders.status open|partially_closed|closed`, `lost_qty`, ledger table `production_order_closes` (`migrations/0140:20-60`, `schema.ts:6144`), `closeProductionOrder` `production-orders/service.ts:892`, `reverseProductionOrderClose :1055`, stock write `writeCloseStockTxn :853-891` (`source_type='production_order_close'`, sourceRef `<code>#n`). Route `POST /production-orders/:id/reverse-close` (`routes.ts:50`).

### 6. Existing purchase linkage
`purchase_requests.source_so_line_id / source_jc_op_id / po_id` (`schema.ts:1820-1831`), `purchase_order_lines.source_so_line_id / source_jc_op_id / source_pr_id / received_qty` (`:1992-2000`), `jc_op_po_lines` (0118: one OSP op ↔ many purchase-order lines), `jc_ops.outsource_pr_id / outsource_po_line_id`, GRN lines → `purchase_order_line_id` (RM §1e). PR short-close with reason (`purchase_requests.balance_closed_*`, 0117). PO types `standard | job_work | outsource | service` (`enums/po-type.ts:1`).

### 7. Existing Assembly logic
Module `apps/api/src/modules/assembly/` (service.ts 1,400+ lines, stock-cascade.ts 280 lines), Equipment SOs only (`service.ts:561`).
- Tables: **`assembly_units`** `schema.ts:3382-3457` — one row per assembled batch: `sales_order_id`, `so_code_text`, `unit_no`, `qty` (batch size), `status in_progress|completed` (CHECK `:3435`), **`serial_no`** (one per batch, auto-generated when omitted `:602`), `assembly_date`, `assembled_by`, `bom_master_id`, `part_no_text`, `customer_text`, `dispatched bool`, `dispatch_date/by/remarks`, `deductions jsonb`; unique (SO, unit_no). **`assembly_tracking`** `:3458-3508` — per (SO, child code) `ready_qty_override` = a *typed* readiness override (spec says readiness must not be typed → conflict C-5).
- Readiness: `deriveComponentStatus ready|enough_for_some|shortage` (`:96-106`), SO status `waiting|ready|assembling|done` (`:83-94`), `canAssemble = min over lines floor(finalReady/qtyPerSet)` (`:1316-1327`).
- Stock effect (ADR-115) `applyAssemblyStockCascade` `stock-cascade.ts:104-170`: on `markUnitAssembled` (`service.ts:533`, guards: not more than order balance `:581-586`, not more than `canAssemble` `:592-598`) and `stopAssembly` (`:774`, `:859`) → one `store_transactions` **`out`** per BOM child (`qty_per_set × batch`, `source_type='assembly'`, `:123-135`) and one **`in`** for `bom_masters.parent_item_id` (`:146-157`, sourceRef `… (output)`). `undoLastUnit` (`:968`) replays the written rows as compensating `in`/`out` (`reverseAssemblyStockCascade :172`). Not a gate — on-hand may go negative (`stock-cascade.ts:24-30`).
- `startAssembly` (`:675`) creates an `in_progress` unit **without** moving stock; `markUnitDispatched` (`:909`) only flips `dispatched=true` — **no ledger row**; the real FG stock-out is `customer-dispatches` (§13).
- Staging / kit verification / pick list / location: NOT PRESENT. Routes `assembly/routes.ts:21-81`; UI `apps/web/src/modules/assembly/routes/{list,detail}.tsx`.
- Permission: `requireWriteRole` only (`service.ts:538,680,779,914,972,1051`) — no `requireFormAccess` form key for assembly.

### 8. Existing inventory / stock / ledger model
RM §1f: `store_transactions` (append-only, **integer qty**, item-level, `txn_type in|out|adjust`, `source_type` enum of 11 values, `source_ref text`, `stock_before/after`) → AFTER-INSERT trigger `apply_store_txn_to_balance` → `item_stock_balances.on_hand_qty` → view `v_item_stock`. All 19 ledger insert sites (re-verified at `3d31ec0b`): `assembly/stock-cascade.ts:123,146,206,246`; `customer-dispatches/service.ts:158,218`; `delivery-challans/receipt-cascades.ts:263` (**dead code — no caller**, `grep -rn writeStoreTxnOnDcReceive apps/api/src` → definition only); `goods-receipt-notes/cascades.ts:362`; `jw-dc/service.ts:821,1081`; `jw-returns/service.ts:77`; `op-entry/qc-stock-cascade.ts:181`; `plans/service.ts:2306,2394`; `production-orders/service.ts:874`; `store-inventory/service.ts:243`; `store-issues/service.ts:220`; `tool-issues/service.ts:260,363`. Every site: `SELECT … FROM items … FOR UPDATE` → read `v_item_stock` → insert. **Lot / heat / serial / location / QC-status / ownership on stock: NOT PRESENT** (RM §1i, §1l). Party (customer-owned) material is a separate integer balance on `party_materials` that never touches the ledger (RM §1j).

### 9. Existing allocation model
`so_stock_reservations` (0099) — RM §1g. **Hard move**: reserving writes an `out` ledger row (`plans/service.ts:2283-2318`), so `on_hand` already excludes reserved qty; `available` is not a separate figure. Keyed to an SO/JW *line* only; status `active|released|dispatched`; dispatch consumes it (`customer-dispatches/service.ts:181-260 releaseReservedForDispatch`, writes a compensating `in` then the dispatch `out`). Allocation to a Production Order / Job Card / Assembly Order: NOT PRESENT. Concurrency: items row `FOR UPDATE` (`:2255`). Permission: `requireWriteRole` only (`:2268`). **Direct conflict with spec §E ("Allocation must NOT reduce physical stock")** — conflict C-1.

### 10. Existing warehouse / location model
NOT PRESENT — no `locations`, `warehouse`, `bin`, `rack` table or column (RM §1f; `grep -in "location|warehouse|bin_|rack" schema.ts` → 0). "At vendor" is derived from `jc_ops` counters + `v_osp_wip` (`migrations/0130:336`), not a location.

### 11. Existing Store Issue logic
RM §1h: `store_issues` (one item per row, `ref_type` free text `'Job Card'|'SO'|'Production'|'Maintenance'|'Other'` + `ref_no` text — **no FK to any document**), `createStoreIssue` refuses qty > on-hand and writes one `out` (`source_type='other'`). No pick list, no allocation link, no return, no consumption/remnant/scrap reconciliation, no lot/location. Permission `issue_create` entry.

### 12. Existing tools / instruments / returnables
- **`tool_issues`** `schema.ts:3509-3569` (comment `:3505` "tools / inserts / fixtures"): code `TIS-`, item_id FK items, qty, issued_to text, ref_type/ref_no text, purpose, `expected_return_date`, `return_status text default 'issued'` (values written by code: `issued|partial|returned` — `tool-issues/service.ts:380-385`), `return_good_qty / return_damaged_qty / return_consumed_qty`, `store_transaction_id`. **`tool_issue_returns`** `:3570-3622`: tool_issue_id FK, return_date, returned_by text, good/damaged/consumed qty, remarks, store_transaction_id.
- Behaviour: issue = `out` ledger (`:260`, refuses qty > on-hand `:246-250`); return = `in` ledger for **good qty only** (`:352-372`); over-return blocked (`:344-350`); partial return keeps `partial` status.
- NOT PRESENT: employee/department/machine/job FKs (text only), asset / instrument id, condition at issue, `overdue|damaged|under_repair|calibration_required|lost` statuses, custody by person, and **any calibration data** — the word appears only as a Service-Purchase-Order category (`packages/shared/src/schemas/service-po.ts:25`, `enums/po-type.ts:13`). Measuring-instrument master: NOT PRESENT. Consumables are ordinary `items` issued through `store_issues` (no `is_consumable` flag).

### 13. Existing FG / dispatch logic
- FG receipt = the credits in §5 (`production_order_close`), `qc_accept` last-op (RM §1o), `grn_qc` (bought parts), `assembly` output (§7). No put-away / location step.
- Dispatch = **`customer_dispatches`** + `customer_dispatch_lines` (`schema.ts:4839-4943`, status `dispatched|cancelled` only — `enums/customer-dispatch-status.ts:1`). `createDispatch` (`customer-dispatches/service.ts:815`, permission `dispatch_create` entry `:820`) locks the SO lines (`:824-830`), releases reservations (`:910`), then `moveDispatchStock` writes the **`out`** (`:124-169`, `source_type='dispatch'`, refuses qty > on-hand `:143-148`); equipment/assembly lines dispatch the parent FG item (`:303-354`, `:920-925`); `cancelDispatch` (`:948`, needs `edit` **and** `approve` `:953-954`) writes compensating `in` rows. Pick list / dispatch staging / gate-out / DC-Invoice linkage from the dispatch row: NOT PRESENT (`invoices` has no FK to `customer_dispatches`; JW returns go by `jw_return_challans`, `jw-returns/service.ts:274`).
- `sales_order_lines.dispatched_qty` (0050) + `soStatus` cascade (`syncSoDispatchStatus :55`).

### 14. Existing genealogy / serial / heat model
- Serial: `assembly_units.serial_no` (one per batch, not per piece); `qc_documents.sr_from / sr_to` (`schema.ts:5488-5489`) — a **piece serial range** assigned per QC log in order of accepted qty (`qc-documents/service.ts:711-729`: running counter per Job Card, `srFrom = runSr+1, srTo = runSr+accepted`) — this is the only per-piece numbering in the system and it is per-JC, not global.
- Heat / lot / MTC: NOT PRESENT (RM §1i). Document genealogy = FK-based Related-Documents panel (`lib/traceability.ts`, `getXxxRelated` on 12 modules). Rework genealogy = `job_cards.parent_job_card_id` + `nc_register.parent_nc_id / child_job_card_id / split_from_nc_id` (0122/0129).

### 15. Existing APIs / services / RPCs / triggers
Routes per module: RM §1 (plans, production-orders, job-cards, GRN, incoming-qc, store-*, tool-issues, party-*, dispatch, DC). Added since RM: `POST /production-orders/:id/reverse-close` (`production-orders/routes.ts:50`). Triggers/views/functions catalogue: RM §1f (one stock trigger; views `v_item_stock`, `v_jc_op_status`, `v_jc_status`, `v_osp_wip`, `v_nc_op_breakup`, `v_op_machine_output`). RPC: NOT PRESENT. OSP flow specifics found here: outward DC is **stock-neutral** (ADR-067, `delivery-challans/service.ts:1154-1160`) and only stamps `jc_ops.outsource_sent_qty` (`applyOutwardToJcOp`); receive → `receiveAgainstDeliveryChallan :1360` → auto-GRN `insertGrnForOspReceipt` (`:1527`) → Incoming QC → `creditGrnQcStock` (skipped mid-route / Production-Order JC); op flips `received` via `isOspOpFullyBack` (`receipt-cascades.ts:110`). NC: `disposeNcCascade` (`nc-register/cascades.ts:196`) — `rework|repair` raise a child JC (`:340-343`), `scrap|make_fresh` → `failed_qty`, `use_as_is` → `cleared_qty` + last-op credit, `return_to_vendor` → DC with `nc_id`; ADR-175 settles the whole chain. `nc-register/*` writes **no** ledger row itself.

### 16. Existing RLS / permissions
RM §1m. Relevant form keys already registered: `bom_create, plan_create, prodorder_create, jc_create, op_entry, item_create, grn_create, issue_create, toolissue_create, party_create, qc_incoming, dispatch_create, pr_create, po_create, ospdc_create` (`packages/shared/src/enums/access-control.ts:59-112`); actions `view|entry|edit|approve`; per-page OFF switches. Modules still on the coarse `requireWriteRole` (admin/manager) instead of a form key: **assembly** (all writes), **SO reservations** (`plans/service.ts:2268,2352`). Override-with-reason: no generic mechanism (RM §1m).

### 17. Exact gaps (spec vs. code)
| # | Spec requirement | Status | Evidence |
|---|---|---|---|
| G1 | Multi-level BOM with paths 1 / 1.1 / 1.1.1 | NOT PRESENT (one level; nesting only implicit via items) | §2 |
| G2 | Approved BOM revision pinned on orders | NOT PRESENT (`revision` int + snapshots only; consumers read live lines) | §2 |
| G3 | Supply type MAKE / BUY / MAKE+OSP / SUBASSEMBLY on a BOM line | Partial: `bom_type manufacture|purchase|outsource`; no `subassembly`; MAKE+OSP derivable from route card | §4 |
| G4 | Traceability-required / critical flags | NOT PRESENT | §2 |
| G5 | Explosion nets allocated / open supply / at-vendor | NOT PRESENT — nets on-hand only | §3 |
| G6 | Planning selectively releases; no auto-creation | **CONFLICT** — BOM-8 cascade auto-creates child JC/PR on SO/JWSO save | §3 |
| G7 | Allocation that does not reduce physical stock; "Available = on-hand − allocated" | **CONFLICT** — reservation is a hard `out` | §9 |
| G8 | Allocation to Production Order / Assembly Order / FG-to-SO with source link | NOT PRESENT (SO line only) | §9 |
| G9 | Blocked allocation of rejected / hold / wrong-ownership / expired-heat stock | NOT PRESENT (no such stock states) | §8 |
| G10 | Lot / heat / serial / MTC on stock | NOT PRESENT | §14 |
| G11 | Locations (Component Store, Assembly Staging, WIP, FG Store, Dispatch Staging, Quarantine) | NOT PRESENT | §10 |
| G12 | Store issue against an allocation / requirement, typed destination, pick list | NOT PRESENT (free-text ref) | §11 |
| G13 | Production consumption / return / remnant / scrap reconciliation | NOT PRESENT | §11 |
| G14 | Assembly Order, pick list, staging transfer, kit verification, assembly issue → WIP | NOT PRESENT (assembly = one-shot consume at completion) | §7 |
| G15 | Readiness from authoritative data only | Partial — `assembly_tracking.ready_qty_override` is typed | §7 |
| G16 | Subassembly order feeding a parent assembly | NOT PRESENT | §4 |
| G17 | Returnable custody (person/dept/machine/job), condition, overdue/damaged/repair/lost statuses | Partial (`tool_issues` + returns; text-only who/where) | §12 |
| G18 | Measuring instruments, calibration validity, issue block on expiry | NOT PRESENT | §12 |
| G19 | FG put-away, FG allocation to SO, dispatch pick, staging, gate-out, single stock-out | Partial (dispatch = one `out` at save; no staging; reservation exists for SO lines) | §13 |
| G20 | Equipment genealogy (serial → subassemblies → component lots → RM heat/GRN/MTC) | NOT PRESENT beyond FK document links + per-JC serial ranges | §14 |
| G21 | Override records user/time/reason/old/new | Partial (activity_log free text; reasons on a few actions) | §16 |
| G22 | Idempotent posting | PRESENT (ADR-172) — reusable as-is | §1 |
| G23 | Row-lock + transaction per posting | PRESENT pattern — reusable as-is | §8 |

### 18. Tables / columns proposed to REUSE (unchanged)
`items` (+ additive columns), `bom_masters`, `bom_master_lines` (+ additive columns), `bom_master_revisions` (as the approved-revision snapshot), `sales_orders / sales_order_lines`, `plans`, `production_orders`, `production_order_closes`, `job_cards / jc_ops / op_log`, `purchase_requests / purchase_orders / purchase_order_lines / jc_op_po_lines`, `goods_receipt_notes / _lines`, `delivery_challans / _receipts`, `nc_register`, `assembly_units`, `store_transactions` + trigger + `item_stock_balances` + `v_item_stock` (kept as the **item-level truth**), `store_issues` (+ additive columns), `tool_issues / tool_issue_returns` (+ additive columns), `so_stock_reservations` (frozen; superseded, see D3), `customer_dispatches / _lines` (+ lot column), `qc_documents` (serial ranges), `activity_log`, `idempotency_keys`, `user_access` + `ACCESS_FORMS`, `file_registry` (MTC files).

### 19. Minimum DB changes proposed (all additive, nullable or defaulted; hand-written SQL, both DBs)
See PART 3 for the design. Summary: **5 new tables** (`stock_locations`, `stock_lots`, `stock_lot_movements`, `stock_allocations`, `store_issue_returns`) + **1 new master** (`instruments`) + additive columns on `items`, `bom_master_lines`, `store_issues`, `tool_issues`, `customer_dispatch_lines`, `goods_receipt_note_lines`, `production_order_closes` + 3 new `store_txn_source_type` values (`store_issue`, `store_return`, `location_transfer`). No drop, no rename, no type change.

### 20. Minimum API changes proposed
New routes under existing modules (no new module for stock): `GET /so-planning/:id/bom-tree/:lineId` (recursive explosion), `GET /assemblies/:soId/readiness`, `POST /stock-allocations`, `POST /stock-allocations/:id/release`, `POST /store-issues/pick-list`, `POST /store-issues` (extended body), `POST /store-issues/:id/return`, `POST /assemblies/:soId/stage`, `POST /assemblies/:soId/issue`, `POST /customer-dispatches/:id/stage`, `POST /tool-issues/:id/return` (extended), `GET/POST /instruments`, `GET /stock-lots`. Extended responses: `getPlanningBom` (+ allocated / open-supply / at-vendor / available / lifecycle), `listStoreInventory` (+ lot breakdown), `closeProductionOrder` (+ lot creation). Every stock-writing call keeps the existing `withUserContext` + items `FOR UPDATE` + Idempotency-Key pattern.

### 21. Existing screens / components to modify
`so-planning/components/bom-planning-modal.tsx` (readiness columns, tree), `so-planning/routes/workflow.tsx`, `assembly/routes/{list,detail}.tsx` (staging/kit/issue), `store-issues/routes/list.tsx` (issue queue + slip), `tool-issues/components/tool-issue-register-view.tsx` (custody + condition), `store-inventory/routes/list.tsx` + `store-transactions/components/stock-ledger.tsx` (lot/location columns), `customer-dispatches/routes/create.tsx` (staging/pick), `production-orders/routes/close.tsx` (lot/heat on close), `goods-receipt-notes/routes/{detail,edit}.tsx` + `incoming-qc/routes/index.tsx` (heat/MTC capture), `items/routes/edit.tsx` (item class), `bom-master/components/bom-form.tsx` (supply type, flags, child BOM), `access-control/routes/list.tsx` (new form keys appear automatically from `ACCESS_FORMS`).

### 22. Exact source files expected to change
API: `apps/api/src/db/schema.ts`; `apps/api/src/db/migrations/0141_*.sql … 0146_*.sql`; `apps/api/src/modules/{so-planning,assembly,store-issues,tool-issues,store-inventory,store-transactions,customer-dispatches,production-orders,goods-receipt-notes,incoming-qc,bom-master,items,plans}/service.ts` + `routes.ts`; new `apps/api/src/modules/stock-lots/{service,routes}.ts`, `apps/api/src/modules/instruments/{service,routes}.ts`, `apps/api/src/lib/stock-post.ts` (the ONE shared posting helper); `apps/api/src/server.ts` (register 2 modules). Shared: `packages/shared/src/enums/{store-txn-source-type,bom-line-type,access-control,item-class,stock-location-kind,allocation-status,returnable-status}.ts`, `packages/shared/src/schemas/{stock-lot,stock-allocation,store-issue,tool-issue,instrument,bom-master,planning-bom}.ts`, `index.ts`. Web: the files in §21 + `apps/web/src/modules/{stock-lots,instruments}/`, `router.tsx`, `lib/access-control.ts` (no change needed — keys come from shared). Docs: `docs/SCHEMA.md`, `docs/DECISIONS.md` (ADR-180…), `docs/TASKS.md`.

### 23. Regression risks — see PART 4.
### 24. Migration plan — see PART 5.
### 25. Test plan — see PART 6.

---

## PART 2 — AUDIT TABLE (required format)

| Existing entity/table | Current purpose | API/service | Current stock effect | Reusable? | Gap | Proposed minimal change | Regression risk |
|---|---|---|---|---|---|---|---|
| `items` | Item master; `item_type component\|assembly`, `procurement_type make\|buy`, free-text `material`, integer `min_stock_qty` | `items/service.ts:37-395` | none | Yes | No class for raw material / consumable / tool / instrument; no traceability flag | Add `item_class text NOT NULL DEFAULT 'component'` (CHECK raw_material\|component\|assembly\|consumable\|tool\|instrument\|fixture), `traceability_required bool DEFAULT false`, `is_returnable bool DEFAULT false` | Low — additive; list filters unchanged |
| `bom_masters` / `bom_master_lines` / `bom_master_revisions` | Single-level BOM, int revision, jsonb snapshots | `bom-master/service.ts`; `cascade.ts:96,342` | none (cascade spawns JC/PR, not stock) | Yes | G1–G4, G6 | Lines: add `child_bom_master_id uuid FK NULL`, `child_bom_revision int NULL`, `traceability_required bool`, `is_critical bool`; enum `bom_line_type` + `'subassembly'`; header: add `approved_at/approved_by` (NULL = draft). **Gate the BOM-8 cascade behind a company setting `auto_spawn_from_bom` (default false)** | Medium — the cascade is live behaviour on SO/JWSO save; flipping the default changes what appears after saving an SO (conflict C-3 needs a decision) |
| `sales_orders.bom_master_id` (text) | Equipment SO → BOM | `so-planning`, `assembly` | none | Yes (as is) | Not a FK | Leave; add index only | None |
| `plans` / `plan_ops` | Planning line per SO/JW line; `plan_type`; RM grade/size; PR/JC links | `plans/service.ts` | reservation only (`:2306,2394`) | Yes | No allocation to plan; explosion one level | Reuse `plans` (`plan_type='assembly'`) as the **Assembly Order** header (code stays `PLN-`); add `plans.bom_revision int NULL` (pinned) | Low |
| `production_orders` + `production_order_closes` | Plan + route card → JC; progressive close credits FG | `production-orders/service.ts:616,892,1055` | `in` per close; `out` on reversal | Yes | Credit has no lot / heat / location | On close: create one `stock_lots` row per close (lot_no = `<PO code>#n`, serial optional) and one `stock_lot_movements` IN to `FG Store`; add `production_order_closes.stock_lot_id uuid NULL` | Low — same tx, additive |
| `job_cards` / `jc_ops` / `op_log` | Shop-floor routing; op counters; QC logs | `op-entry/service.ts:2004 startOp`, `:1197 submitQcLog` | last-op `qc_accept` credit (`qc-stock-cascade.ts:181`) | Yes | No RM requirement / issue link; no WIP stock | Add `job_cards.rm_required_qty numeric(12,3) NULL`, `rm_uom text NULL` (from route card / BOM); WIP tracked as a **location** (`WIP-<JC code>` virtual location) on `stock_lot_movements`, not a new table | Low |
| `purchase_requests` / `purchase_orders` / `_lines` / `jc_op_po_lines` | Buy + OSP supply | `purchase-*`, `so-planning:1351` | none | Yes | Explosion ignores open supply | Read-only: explosion sums `qty − received_qty` of open PO lines and open PR qty per (SO line, item) | None |
| `goods_receipt_notes` / `_lines` | Receipt + per-line QC qty/status/report | `goods-receipt-notes/service.ts:758`; `incoming-qc/service.ts:492` | `in` on QC accept (`cascades.ts:362`) | Yes | No heat / lot / MTC / location; rejected qty has no stock state | Add `goods_receipt_note_lines.heat_no text NULL`, `lot_no text NULL`, `mtc_file_path text NULL`, `mtc_no text NULL`; on accept create `stock_lots` (+ movement to `Quarantine`→`Component Store`); on reject create a lot with `qc_status='rejected'` in `Quarantine` (0 effect on item on-hand — the item ledger stays as today) | Low–Medium — `creditGrnQcStock` gains one call; three early-returns must still hold |
| `delivery_challans` / receipts (OSP) | OSP outward (stock-neutral) / receive → auto-GRN | `delivery-challans/service.ts:1021,1360` | none on send; receive → GRN path | Yes | "At vendor" is a counter, not a location; ownership not recorded | Outward DC: move the sent lot(s) to virtual location `VENDOR-<vendor code>` (`location_transfer`, item on-hand **unchanged**, matches ADR-067); receive: lot returns via GRN lot creation with `parent_lot_id` = sent lot | Low — purely additive movements |
| `nc_register` (+ recovery) | Rejects, dispositions, rework chains, RTV | `nc-register/cascades.ts:196`, `recovery.ts` | none directly | Yes | Rejected pieces have no stock state / location | On `autoCreateNcFromQcReject` for a lot-tracked item: move rejected qty to `Quarantine`; `scrap` → `SCRAP` location; `use_as_is` → back to store; `return_to_vendor` → `VENDOR-…` | Medium — touches the ADR-175 chain; must stay a no-op when the item has no lots |
| `store_transactions` + trigger + `item_stock_balances` | Item-level append-only ledger; on-hand | 19 sites (§8) | the ledger | **Yes — stays the truth for item on-hand** | No lot/location/status | **Do not change.** Every new lot movement that changes item on-hand also writes a `store_transactions` row (via the shared `stock-post.ts` helper) and carries `store_transaction_id`; location-only transfers write no ledger row. Invariant job: Σ lot on-hand per item = `item_stock_balances.on_hand_qty` | Low — additive; the trigger is untouched |
| `so_stock_reservations` | Hard-move SO-line reservation | `plans/service.ts:2264,2347`; `customer-dispatches:181` | `out` on reserve, `in` on release/dispatch | Partially | Conflict C-1 (hard move) | **Freeze** (no new rows once `stock_allocations` ships; existing rows keep working until released/dispatched); new UI button writes a soft `stock_allocations` row instead | Medium — the SO Planning "Reserve" button + dispatch release path change meaning; needs the user's decision |
| `assembly_units` / `assembly_tracking` | Equipment SO builds; typed readiness override | `assembly/service.ts:533,675,774,909,968,1045` | `out` children + `in` parent at completion (`stock-cascade.ts:123,146`) | Yes | G14, G15 | Keep completion cascade as the **assembly issue** fallback; add stage/issue steps as lot movements (`Component Store → ASSY-STAGING-<SO>` = transfer; `→ WIP-ASSY-<SO>` = the existing `out`); keep `ready_qty_override` but mark it in the UI as "manual override" and require a reason (activity_log) | Medium — `computeSoCanAssemble` must subtract lots already staged/issued so it does not double count |
| `store_issues` | Consumable / ad-hoc issue, free-text ref | `store-issues/service.ts:172` | `out` (`:220`) | Yes | G12, G13 | Add nullable FKs `job_card_id`, `production_order_id`, `assembly_plan_id` (→plans), `cost_center_id`, `machine_id`, `operator_id`, `allocation_id`, `stock_lot_id`, `from_location_id`, `to_location_id`, `issue_kind text` (production\|assembly\|consumable\|cutting_tool\|osp\|internal_transfer\|fg_staging), `issued_qty_returned int DEFAULT 0`; keep `ref_type/ref_no` for legacy rows; new source_type `store_issue` | Low — existing create path keeps working with all new columns NULL |
| NEW `store_issue_returns` | Return / remnant / scrap / consumed against an issue | new in `store-issues/service.ts` | `in` for returned + remnant (`store_return`); none for consumed/scrap (scrap = lot to `SCRAP`) | — | G13 | Mirrors `tool_issue_returns` exactly (`schema.ts:3570`): issue FK, return_date, good/remnant/scrap/consumed qty, remarks, store_transaction_id, `remnant_lot_id` (child lot with `parent_lot_id`); reconciliation = issued − Σ(returned+remnant+scrap+consumed) must be 0 before JC / Production Order close (guard in `closeBlockedReason`) | Medium — adds a close guard; default OFF per company until RM issues are in use |
| `tool_issues` / `tool_issue_returns` | Returnable tools; good/damaged/consumed returns | `tool-issues/service.ts:219,307` | `out` / `in` good | Yes | G17, G18 | Add `issued_to_user_id`, `department text`, `machine_id`, `job_card_id`, `instrument_id`, `condition_at_issue text`, `return_status` values `issued\|partial\|returned\|overdue\|damaged\|under_repair\|calibration_required\|lost` (CHECK); `tool_issue_returns.condition text`; overdue **derived** (`expected_return_date < today AND status IN (issued, partial)`) | Low |
| NEW `instruments` | Measuring instruments + calibration | new module | none (an instrument is an asset, not stock qty) | — | G18 | `id, company_id, code, item_id NULL, name, serial_no, calibration_due_date, calibration_cert_path, status active\|blocked\|under_repair\|lost, [audit cols]`; issue guard in `createToolIssue`: instrument must be `active`, `calibration_due_date >= today`, not already on an open `tool_issues` row | Low — new table, one guard |
| `customer_dispatches` / `_lines` | FG stock-out at save; SO dispatched_qty | `customer-dispatches/service.ts:815,948` | `out` (`:158`); `in` on cancel | Yes | G19 | Add `customer_dispatch_lines.stock_lot_id uuid NULL`, `customer_dispatches.staged_at timestamptz NULL`; staging = lot transfer `FG Store → DISPATCH-STAGING` (no ledger row); confirm = today's `out` + lot movement to `CUSTOMER` | Low–Medium — pick order (FIFO by lot) must be deterministic |
| `qc_documents.sr_from/sr_to` | Per-JC piece serial ranges on QC docs | `qc-documents/service.ts:711` | none | Yes | Serial not global | Reuse as the serial *source*: FG lot created at Production Order close records `serial_from/serial_to` copied from the JC's accepted range | None |
| `party_materials` (+ GRN/issue) | Customer-owned stock, separate integer balance | `party-*/service.ts` | own balance only | Yes | Ownership not on the main ledger | Out of scope for phase 1; later a `stock_lots.ownership='party'` row per Party GRN can mirror it — **not proposed now** (would double-count with `party_materials.stock_qty`) | — |
| `activity_log` | Free-text audit | `activity-log/service.ts:154` | none | Yes | No old/new value | Add nullable `old_value text`, `new_value text`, `reason text` columns; `emitActivityLog` gains optional fields | None |
| `user_access` + `ACCESS_FORMS` | Tiers per dept; form keys | `lib/access.ts:58` | — | Yes | Keys for allocate / pick / issue / return / adjust / assembly issue / dispatch confirm missing | Add keys `store_allocate, store_pick, store_issue, store_return, stock_adjust, assembly_issue, dispatch_confirm, instrument_create` to `enums/access-control.ts` (dept `store` / `production` / `sales`); reuse `edit` for override, `approve` for adjustment | Low — unconfigured users are refused by `requireFormAccess`, so grant tiers first |
| `idempotency_keys` + plugin | Replay-safe writes | `plugins/idempotency.ts` | — | Yes as-is | — | none | — |

---

## PART 3 — PROPOSED MINIMAL DESIGN

### D1. ONE generic stock-lot layer (the only new stock structure) — why the item ledger cannot meet the spec by reuse
The item ledger is integer, item-level, with no lot, location, status or ownership (§8). The spec needs heat/lot/serial genealogy, locations, QC-hold, ownership and allocation on the same rows. Adding those as columns on `store_transactions` would break its append-only, single-row-per-movement contract and every one of the 19 writers. So: **keep `store_transactions` as the item-level truth, and add one lot layer underneath it, shared by raw material, components, sub-assemblies and finished goods.** No per-feature lot tables.

```sql
-- 0141_stock_locations.sql
stock_locations(id, company_id, code UNIQUE/company, name, kind text CHECK IN
  ('store','staging','wip','vendor','quarantine','scrap','fg_store','dispatch_staging','customer'),
  is_virtual bool DEFAULT false, is_active bool DEFAULT true, [audit cols])
-- seeded per company: STORE-MAIN, FG-STORE, QUARANTINE, SCRAP, DISPATCH-STAGING, CUSTOMER;
-- ASSY-STAGING-<SO>, WIP-<JC>, VENDOR-<vendor> are created on demand (is_virtual=true).

-- 0142_stock_lots.sql
stock_lots(id, company_id, item_id FK items NOT NULL, lot_no text NOT NULL,      -- 'IN-GRN-00012/2', 'IN-PRO-00007#3', 'IN-SO-00570 unit #2'
  heat_no text, serial_no text, serial_from int, serial_to int,
  mtc_no text, mtc_file_path text,                                              -- qc-docs bucket path
  ownership text NOT NULL DEFAULT 'own' CHECK IN ('own','party'), client_id FK clients NULL,
  qc_status text NOT NULL DEFAULT 'accepted' CHECK IN ('accepted','hold','rejected'),
  source_type store_txn_source_type NOT NULL, source_ref text NOT NULL,          -- same vocabulary as the ledger
  grn_line_id FK NULL, production_order_close_id FK NULL, assembly_unit_id FK NULL, -- typed origin (one of)
  parent_lot_id FK stock_lots NULL,                                              -- remnant / split / OSP-return genealogy
  on_hand_qty integer NOT NULL DEFAULT 0 CHECK (>= 0),                           -- maintained by trigger from movements
  uom uom NOT NULL, [audit cols]; UNIQUE (company_id, lot_no) WHERE deleted_at IS NULL)

-- 0143_stock_lot_movements.sql  (append-only, same discipline as store_transactions)
stock_lot_movements(id, company_id, stock_lot_id FK NOT NULL,
  from_location_id FK NULL, to_location_id FK NULL,                              -- NULL from = receipt; NULL to = leaves the company
  qty integer NOT NULL CHECK (> 0),
  movement_type text NOT NULL CHECK IN ('receipt','transfer','issue','return','consume','scrap','dispatch','adjust'),
  store_transaction_id FK store_transactions NULL,                               -- set when item on-hand changed
  source_type store_txn_source_type NOT NULL, source_ref text NOT NULL,
  store_issue_id FK NULL, allocation_id FK NULL, remarks text, created_at, created_by)
-- trigger apply_lot_movement_to_lot(): +qty when to_location is an on-hand kind (store, fg_store, staging, wip, quarantine),
--   -qty when from_location is; mirrors 0020's shape.
-- Invariant (nightly + on-demand check, docs/sql): SUM(stock_lots.on_hand_qty WHERE qc_status='accepted' AND location kind IN (store, fg_store, staging)) per item
--   == item_stock_balances.on_hand_qty.  Rejected / hold / WIP / vendor lots are NOT part of item on-hand (matches today: rejects are never credited).
```
**Rule for every writer:** a movement that changes *item on-hand* (receipt, issue, consume, dispatch, adjust) is posted through ONE helper `apps/api/src/lib/stock-post.ts postStockMove()` which (inside the caller's tx) locks the items row, writes the `store_transactions` row exactly as today, then the `stock_lot_movements` row(s) with `store_transaction_id`. A pure `transfer` (store → staging, FG → dispatch staging, own → vendor) writes **no** ledger row — item on-hand unchanged (spec §H, §J, ADR-067). Items whose `traceability_required=false` get one implicit lot per receipt so the layer is uniform; nothing is optional per feature.

### D2. Multi-level BOM (additive)
`bom_master_lines` + `child_bom_master_id` (nullable FK → the child's own BOM) + `child_bom_revision` (pinned int) + `traceability_required` + `is_critical`; `bom_line_type` gains `'subassembly'`; `bom_masters` + `approved_at/approved_by` (an order may only pin an approved revision). Explosion = one recursive CTE in a new `explodeBom(tx, bomId, qty, depth≤10)` in `bom-master/service.ts`, emitting `path '1.2.1'`, `level`, `gross_qty = Π qty_per_set × order_qty`, cycle guard on the visited set. `getPlanningBom` calls it and adds per line: `allocated` (Σ active `stock_allocations`), `available = on_hand_accepted − allocated`, `open_make` (open Production Orders / plans qty), `open_buy` (open PR + PO qty − received), `at_vendor` (`v_osp_wip`), `shortage = max(0, gross − available − open_make − open_buy − at_vendor)`, `lifecycle` (derived, see D6). MAKE+OSP is **derived** from the item's route card having an `outsource` op — no new supply-type value.

### D3. Allocation = soft reservation (new `stock_allocations`; `so_stock_reservations` frozen)
```sql
-- 0144_stock_allocations.sql
stock_allocations(id, company_id, item_id FK, stock_lot_id FK NULL,            -- NULL = item-level allocation, lot chosen at pick
  demand_type text CHECK IN ('so_line','production_order','assembly_plan','job_card'), demand_id uuid NOT NULL,
  qty integer CHECK (> 0), status text CHECK IN ('active','picked','issued','released','cancelled') DEFAULT 'active',
  released_reason text, [audit cols]; INDEX (company_id, item_id) WHERE status='active')
```
Semantics: **never a ledger row.** `available = item_stock_balances.on_hand_qty − Σ active allocations` (computed in SQL, one CTE, reused by explosion, readiness, store queue). Concurrency: `SELECT … FROM items … FOR UPDATE` then `INSERT … WHERE available ≥ qty` re-checked inside the lock (same shape as `reserveStock`). Blocks: lot `qc_status ≠ 'accepted'`, `ownership ≠ demand owner`, expired heat (if `traceability_required` and no `heat_no`), `available < qty`. The existing hard-move reservation stays readable and dispatchable but its create route is switched off behind a flag once D3 ships (**decision needed — conflict C-1**).

### D4. Store issue engine (extend `store_issues`, add `store_issue_returns`)
One posting helper, one table, `issue_kind` decides semantics: `production` / `assembly` / `osp` / `fg_staging` require an `allocation_id` (store issues against an allocation; store never picks the job); `consumable` / `cutting_tool` need only a cost object (`cost_center_id` or `job_card_id`) and expect no return; `internal_transfer` is a `transfer` movement (no ledger). Pick list = `GET /store-issues/pick-list?allocationId` returning the FIFO lots at the source location (`stock_lots` ordered by `created_at`), exact `lot_no / heat_no / location`; the issue posts the chosen lot(s). Production issue = movement `STORE-MAIN → WIP-<JC>` + ledger `out` (`source_type='store_issue'`). Returns: `store_issue_returns` (good → `in` + movement back to store; remnant → new child lot `parent_lot_id` = issued lot, `in`; scrap → lot to `SCRAP`, no ledger; consumed → none). Reconciliation guard `issued − (consumed+returned+remnant+scrap) = 0` before Job Card / Production Order close, bypassable only with `store_adjust approve` + reason (activity_log old/new).

### D5. Assembly Order on existing rows
Assembly Order = `plans` row with `plan_type='assembly'` (already exists, ADR-110) for a component/JWSO assembly, or the Equipment SO itself (as today) — no new header table. Stage = `POST /assemblies/:soId/stage` → allocation → pick → `transfer STORE-MAIN → ASSY-STAGING-<SO>` (no ledger). Kit verification = all BOM lines staged qty ≥ need (server computed) → flag `assembly_units.kit_verified_at`. Assembly issue = `POST /assemblies/:soId/issue` → `issue ASSY-STAGING → WIP-ASSY-<SO>` = the **existing** `applyAssemblyStockCascade` `out` rows, now lot-aware; completion keeps writing the parent `in` (lot = `<SO> unit #n`, `serial_no` from `assembly_units`). Existing one-shot behaviour stays for SOs with nothing staged (`stopAssembly`/`markUnitAssembled` unchanged when no staged lots exist) so live SOs keep working.

### D6. Lifecycle status (derived, never stored)
Map to what already exists: NOT PLANNED (no plan/PR), RM PENDING (plan, no RM lot allocated), RM ALLOCATED (`stock_allocations` active for the Production Order), IN PRODUCTION (`v_jc_status open`), AT QC (`qc_pending`), AT VENDOR (`v_osp_wip.at_vendor_qty>0`), OSP INWARD/QC PENDING (GRN line `qc_status pending|in_progress`), FINAL QC PENDING (last op `qc_pending`), READY IN STORE (lot in `STORE-MAIN`/`FG-STORE`, accepted, unallocated), ALLOCATED TO ASSEMBLY (allocation `demand_type=assembly_plan`), ASSEMBLY STAGING (lot at `ASSY-STAGING-*`), ISSUED TO ASSEMBLY (lot at `WIP-ASSY-*`), CONSUMED (movement `consume`), REJECTED/NC (`nc_register` open / lot `rejected`), UNDER REWORK (`nc_status under_rework|under_repair`). One SQL function `lifecycle_for_requirement()` reused by the readiness screen and the store queue.

### D7. FG / dispatch
Production Order close (ADR-179) creates the FG lot; `customer-dispatches` gains staging (`transfer FG-STORE → DISPATCH-STAGING`, no ledger) and the existing `out` becomes the confirm step with lot movement `→ CUSTOMER`; `customer_dispatch_lines.stock_lot_id` records the exact lot/serial. Cancel keeps writing compensating `in` (today's behaviour) + movement back.

### D8. Returnables / instruments
`tool_issues` extended (Part 2 row) + `instruments` master + issue guard. Statuses `overdue` derived; `damaged|under_repair|calibration_required|lost` set by the return's `condition`. Outstanding = `qty − Σ good returned` (already how `return_status` is computed, `tool-issues/service.ts:380-385`).

### D9. Permissions / overrides
New `ACCESS_FORMS` keys (Part 2 row). Store users: `store_issue entry`, `store_return entry`, `stock_adjust` **not granted** (adjust needs `approve` = L4/L5). Every override (`store_adjust`, allocation override, readiness override, reconciliation bypass) = `emitActivityLog` with `old_value/new_value/reason` (additive columns) — reusing the existing writer, no new audit table.

### D10. NEW TABLES — justification (why an existing table cannot be reused)
| New table | Why not reuse |
|---|---|
| `stock_locations` | No location concept exists anywhere (§10); locations are a master, not a column on items |
| `stock_lots` | `store_transactions` is one row per movement and append-only; a lot is a *balance holder* with identity (heat/serial/ownership/QC status) — putting that on the ledger or on `items` would either duplicate per row or lose per-lot state |
| `stock_lot_movements` | Location transfers must not write `store_transactions` (they would corrupt item on-hand via the trigger); a second append-only table with a nullable link to the ledger keeps both invariants |
| `stock_allocations` | `so_stock_reservations` is (a) keyed to an SO line only and (b) a hard move by design (`plans/service.ts:2243-2248`); reusing it would force the same ledger `out` the spec forbids |
| `store_issue_returns` | `store_issues` has no return path; `tool_issue_returns` is FK-bound to `tool_issues` (`schema.ts:3577`) and its columns (good/damaged/consumed) do not express remnant genealogy |
| `instruments` | No asset/instrument master exists (§12); an instrument is an identity with a calibration date, not a stock quantity — `items` rows are quantities |
Not proposed: an `assembly_orders` table (reuse `plans` + `assembly_units`), a `pick_lists` table (a pick list is a read of allocations + lots; the issue row records what was picked), a genealogy table (`parent_lot_id` + movements + typed origin FKs give the chain).

---

## PART 4 — REGRESSION RISKS (and the callers to check first)
| Risk | Callers / evidence | Mitigation |
|---|---|---|
| Any change to `store_transactions` semantics breaks 19 writers + the balance trigger | §8 list; `0020:77-113` | **No change** to the table or trigger; lot layer is additive; `postStockMove()` wraps, does not replace, the existing insert shape |
| Double counting in assembly readiness once lots can be staged | `assembly/service.ts:1237-1340`, `1336 computeSoCanAssemble` | Subtract lots at `ASSY-STAGING-*`/`WIP-ASSY-*` and active allocations from `stockMap`; keep the override path |
| BOM-8 auto-spawn flipped off changes SO/JWSO save behaviour | `sales-orders/service.ts:1481-1487`, `job-work-orders/service.ts:845,1129`, tests `bom-master/cascade.test.ts` | Company flag default = **current behaviour** until the user decides (conflict C-3) |
| Reservation semantics change (hard → soft) affects dispatch release maths | `customer-dispatches/service.ts:181-260`, `plans/service.ts:2264-2420` | Old rows keep hard semantics until drained; new rows soft; `available` CTE handles both (`on_hand − soft active`) |
| Close guards (reconciliation) block existing Job Cards / Production Orders that never had an issue | `production-order-close-guard.ts:44-57`, `sales-cascade.ts:96` | Guard applies only when the JC has ≥1 `store_issues` row of kind production; company flag |
| Incoming QC credit path gains lot creation — the three early-returns (mid-route OSP, Production-Order JC, no item) must stay | `goods-receipt-notes/cascades.ts:318-345` | Lot creation placed *after* the existing early-returns; tests in §6 |
| `qc_status='rejected'` lots must never enter item on-hand (today rejects are simply uncredited) | `incoming-qc/service.ts:581-589` | Trigger counts only accepted lots in on-hand kinds; invariant check |
| ADR-175 NC chain: new quarantine moves must be no-ops for non-lot items and never alter `cleared/failed` maths | `nc-register/cascades.ts:196-620`, `recovery.ts` | Movement calls guarded by "lot exists for this piece"; NC ledger untouched |
| Permission keys unknown to existing `user_access.forms` → refusals | `lib/access.ts:58-81` | Seed tiers: store dept L2+ gets issue/return; ship with the Access Control matrix updated first |
| Pre-existing prettier drift + 400-line rule (`CLAUDE.md:433`) on the files touched | RM §0.5 | Only touched files formatted; new logic in new files (`stock-post.ts`, `stock-lots/`) |
| Both Supabase projects must receive every migration; nothing auto-applies | RM §0.3 | Migration plan Part 5; verify with a `check-migrations.sql`-style probe |

**Conflicts to decide before implementation:**
- **C-1** Spec §E "allocation must not reduce physical stock" vs `so_stock_reservations` hard move (`plans/service.ts:2243-2248`, ADR text in `0099:3-8`).
- **C-2** Spec §L "ROLLBACK on failure" is already the case; but spec §M "reversible migrations" vs this repo's forward-only convention (`migrations/README.md`) — read as additive/nullable (brief).
- **C-3** Spec §D "do not auto-create Production Orders/PR after explosion" vs BOM-8 cascade on SO/JWSO save.
- **C-4** Spec §I instrument/calibration data — nothing exists; needs a new master (D8) or is out of scope.
- **C-5** Spec §B "readiness never typed" vs `assembly_tracking.ready_qty_override` (kept, but flagged).
- **C-6** Spec §A "drawing revision on BOM line" vs ADR-178 (revision lives on the SO/JWSO line, capital letters, never backwards) — propose to keep ADR-178 and *display* the line revision on the readiness grid, not store it on the BOM.
- **C-7** Spec §F integer vs decimal: the ledger is integer; raw material in KG/MTR needs decimals. The lot layer proposes `integer` too for consistency with `item_stock_balances`; if RM must be weighed, `stock_lots.on_hand_qty` and movements should be `numeric(14,3)` **and** the item ledger stays integer for piece items only — decision needed.

---

## PART 5 — MIGRATION PLAN (hand-written SQL, forward-only, idempotent, both DBs, TEST first)
| # | File | Content | Backward-compatible? |
|---|---|---|---|
| 0141 | `0141_stock_locations.sql` | table + seed 6 locations per company + RLS company_read | yes (new) |
| 0142 | `0142_stock_lots.sql` | table + unique + RLS; `ALTER TYPE store_txn_source_type ADD VALUE 'store_issue','store_return','location_transfer'` (each its own statement — enum ADD VALUE cannot run in a tx, see `0099:13-16`) | yes |
| 0143 | `0143_stock_lot_movements.sql` | table + trigger `apply_lot_movement_to_lot()` (SECURITY DEFINER, mirrors 0020) + backfill: one implicit lot per item = current `item_stock_balances.on_hand_qty` at `STORE-MAIN` (so the invariant holds from day one) | yes |
| 0144 | `0144_stock_allocations.sql` | table + partial index; **no** data migration of `so_stock_reservations` | yes |
| 0145 | `0145_bom_items_store_additive.sql` | `items.item_class/traceability_required/is_returnable`; `bom_master_lines.child_bom_master_id/child_bom_revision/traceability_required/is_critical`; `ALTER TYPE bom_line_type ADD VALUE 'subassembly'`; `bom_masters.approved_at/by`; `store_issues.*` FKs + `issue_kind`; `goods_receipt_note_lines.heat_no/lot_no/mtc_no/mtc_file_path`; `customer_dispatch_lines.stock_lot_id`; `production_order_closes.stock_lot_id`; `activity_log.old_value/new_value/reason`; `tool_issues` custody columns + CHECK; `companies.auto_spawn_from_bom bool DEFAULT true`, `companies.rm_reconciliation_gate bool DEFAULT false` | yes — all `ADD COLUMN IF NOT EXISTS`, nullable/defaulted |
| 0146 | `0146_store_issue_returns_instruments.sql` | `store_issue_returns`, `instruments` tables + RLS | yes |
Order of code deploy: shared enums → API (reads new columns as optional) → web. Apply 0141–0146 to TEST, run the invariant SQL, eyeball, then PROD only on the user's explicit instruction (prod migrations run by the user). `docs/SCHEMA.md` updated in the same commit as `schema.ts` (`CLAUDE.md:52-55`).

---

## PART 6 — TEST PLAN (Vitest on services with an in-memory/mocked tx where the repo does so; Playwright on TEST site; **never** `pnpm --filter api test` — it hits PROD, `_house-rules.md:22-25`)
| Spec test | Where | Assertion |
|---|---|---|
| multi-level explosion | `bom-master/service.test.ts` (new `explodeBom` cases) | 3-level BOM → paths `1, 1.1, 1.1.1, 1.2`, gross qty products; cycle A→B→A throws |
| revision consistency | same | order pins `child_bom_revision`; editing the BOM after pin does not change the pinned explosion |
| MAKE/BUY/OSP requirement | `so-planning` test | `open_make/open_buy/at_vendor` reduce shortage; `subassembly` recurses |
| accepted stock offsets | same | rejected/hold lots excluded from `available` |
| allocation ≠ physical | `stock-allocations` test | after allocate: `item_stock_balances` unchanged, `available` reduced |
| no double allocation | concurrency test with two txs on one item | second allocate refused when `available < qty` |
| production issue → WIP | `store-issues` test | ledger `out` + movement `STORE→WIP-<JC>`; lot on-hand at WIP |
| reconciliation | same | issued 10, consumed 8, remnant 1, scrap 1 → close allowed; consumed 8 only → close blocked |
| remnant genealogy | same | child lot `parent_lot_id` = issued lot, heat copied |
| purchased part ready only after QC + put-away | `incoming-qc` test | lot `hold` in `QUARANTINE` before accept; `accepted` in `STORE-MAIN` after |
| manufactured part ready only after close | `production-orders` test | no lot before close; lot + `FG-STORE` after; partial close → partial lot qty |
| OSP outward keeps ownership | `delivery-challans` test | transfer to `VENDOR-*`, no ledger row, item on-hand unchanged (ADR-067 preserved) |
| OSP inward does not auto-complete | existing `receipt-cascades` tests (`isOspOpFullyBack`) | unchanged + lot returns with `parent_lot_id` |
| staging ≠ consume | `assembly` test | `stage` writes no ledger row; `issue` writes the `out` |
| assembly issue genealogy | same | `assembly_units` lot lists consumed component lots via movements |
| consumable non-returnable | `store-issues` test | `issue_kind='consumable'` refuses a return |
| returnable custody / partial / over-return | `tool-issues` test (extend existing) | outstanding maths; over-return `ConflictError` (`tool-issues/service.ts:344-350` already) |
| expired calibration blocks | `instruments` test | `calibration_due_date < today` → `ValidationError` |
| no double instrument issue | same | open `tool_issues` row → refused |
| FG staging no stock-out; dispatch once | `customer-dispatches` test | stage: no ledger; confirm: exactly one `out`; second confirm refused |
| idempotent retry | existing `plugins/idempotency.test.ts` pattern | same key → replay, no second ledger row |
| unauthorized override | `lib/access` tests | L2 store user `stock_adjust` → `AuthorizationError` |
| rollback | service test with a thrown error after the ledger insert | no `store_transactions`, no lot movement persisted |
| invariant | `docs/sql/check-stock-invariant.sql` | Σ accepted on-hand lots per item == `item_stock_balances.on_hand_qty` |
Playwright (TEST site only): Items → BOM (3 levels) → SO → Planning readiness → Production Order → GRN with heat/MTC → Incoming QC → allocation → pick → issue → return → close → FG lot → dispatch stage → confirm; verification PDF in the RM §-format (Action | Document | Qty | Header Status | Overall Status | Result).

---

## STOP
Phase 1 audit/design complete. No implementation started. Awaiting approval and the decisions on conflicts C-1 … C-7.
