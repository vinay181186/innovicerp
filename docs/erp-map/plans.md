# Plans (Production Planning)
**Module key:** `plans` · **Domain:** Catalog & Engineering

## Purpose
Production planning workbench (Phase B, ADR-030). A plan sits between an order (SO/JW line) and execution: it captures the item, quantity, operations, and sourcing decision (manufacture / assembly / direct purchase / full outsource), then finalizes and executes into Job Cards and/or Purchase Requests. Includes a planning dashboard and a "needs planning" (unplanned orders) view.

## Pages / Screens
Web routes under `apps/web/src/modules/plans/routes/`:
- `plans` (list.tsx) — searchable/filterable plan list (status, type) with per-row item + ops count.
- `plans/$id` (detail.tsx) — plan header, ops, sourcing details, status actions.
- `plans/new` (new.tsx) — create a plan (with "Load default ops" from the item's route card).
- `plans/$id/edit` (edit.tsx) — edit (in_planning / planned only).
- `planning-dashboard` (dashboard.tsx) — KPI tiles + recent plans + needs-planning drill.

## Database Tables
- `plans` (schema.ts L2417) — header: `code`, `plan_date`, `plan_status` (planStatusEnum, default 'in_planning'), `plan_type` (planTypeEnum). Source link (at most one of `so_line_id`→sales_order_lines / `jw_line_id`→job_work_order_lines) + `so_code_text`, `line_no`. Item (`item_id`→items nullable, `item_code_text`, `item_name_text`). `order_qty`, `plan_qty` (both CHECK > 0). `planned_start_date` / `planned_end_date`. BOM refs (`bom_master_id`, `bom_parent_code`, `bom_child_code`). `jc_id`→job_cards. Direct-purchase fields (dp_*: vendor, cost, remarks, `dp_pr_id`). Full-outsource fields (fo_*: vendor, process, rate, material src, delivery date, cost center, `fo_pr_id`, `fo_mat_pr_id`). `material_pr_id`. `required_docs` jsonb. Unique `plans_company_code_uniq`. Indexes on company+status, so_line, jw_line, jc_id, item, company+date. Status→FK CHECKs in migration 0024.
- `plan_ops` (L2536) — one row per op: `op_seq`, `machine_id` (+code text), `operation`, `op_type` (default 'process'), `cycle_time_min`, `program`, `tool_details`, `qc_required`, outsource fields (`outsource_vendor_id`, `outsource_vendor_text`, `outsource_cost`, `outsource_pr_id`, `outsource_lead_days`). Unique (plan_id+op_seq). Cascade delete on plan.

Both: `company_id`, audit columns, soft delete, RLS company_read / manager_write.

## API Endpoints
`routes.ts` (auth required):
- GET `/plans` — list (`listPlansQuerySchema`: search, status, planType, soLineId, limit, offset).
- GET `/plans/:id` — detail.
- POST `/plans` — create (201, always in_planning). Write role.
- PATCH `/plans/:id` — update (in_planning/planned only). Write role.
- POST `/plans/:id/finalize` — in_planning → planned. Write role.
- POST `/plans/:id/execute` — planned → jc_created | pr_created. Write role.
- DELETE `/plans/:id` — soft delete (in_planning/planned only). Write role.
- GET `/plans/default-ops?itemId=` — route-card ops for an item (form helper).
- GET `/planning-dashboard` — KPI counts + recent plans.
- GET `/planning-dashboard/unplanned` — open SO lines not fully planned.

## Services / Key Functions
`service.ts` (all in `withUserContext` tx):
- `listPlans` / `getPlan` — list (batched ops counts) / detail (ops ordered).
- `createPlan(input, user)` — auto PLN-NNNN code, inserts header + ops (in_planning).
- `updatePlan(id, input, user)` — patch; ops replace-all when provided; editable in in_planning/planned.
- `finalizePlan(id, user)` — in_planning → planned; idempotent; manufacture/assembly require ≥1 op.
- `executePlan(id, user)` — dispatches by type to `executeManufacture` (creates JC + copies plan_ops→jc_ops, sets jc_id, status jc_created), `executeDirectPurchase` (creates PR, dp_pr_id, pr_created), or `executeFullOutsource` (JW PR + optional material PR, fo_pr_id/fo_mat_pr_id, pr_created).
- `softDeletePlan(id, user)` — soft-deletes plan + ops; only in_planning/planned.
- `getDefaultRouteOpsForItem(itemId, user)` — maps the item's active route-card ops to PlanOpInput[].
- `getPlanningDashboard(user)` / `getUnplannedOrders(user)` — KPI aggregate / unplanned SO-line list.

## Entry Points
Nav → Planning dashboard / Plans list. New plans often start from an unplanned SO line (needs-planning drill). "Load default ops" pulls from route-cards.

## Business Logic
- Code auto-numbered `PLN-NNNN` per company (strict-shape codes only counted); user code dup-checked.
- A plan carries at most one source (SO line XOR JW line) — enforced at the service layer.
- **State machine**: in_planning → planned (finalize) → jc_created | pr_created (execute) → in_production → complete. Service guards mirror DB CHECKs; edits/deletes allowed only in in_planning/planned; execute requires planned.
- Finalize requires ≥1 op for manufacture/assembly plans; idempotent when already planned.
- Execute is type-specific and atomic (single tx, rollback unwinds JC/PR):
  - manufacture/assembly → requires resolved item_id + ≥1 op; creates JC (qty=plan_qty), copies ops to jc_ops, links source SO/JW line.
  - direct_purchase → requires a vendor; creates one PR (est cost = dp_cost).
  - full_outsource → requires vendor + process; creates a JW PR (`operation='OUTSOURCE'`) plus an optional material PR when `fo_material_src` is set and not self/inhouse.
- order_qty and plan_qty must be > 0 (DB CHECK). Ops de-duplicated by op_seq (ValidationError on dup).
- Generated PR codes: `PR-DP-/PR-FO-/PR-FOMAT-<planSlug>-NN`.
- Audit: CREATE / EDIT / PLAN_FINALIZED / PLAN_EXECUTED / DELETE emit `activity_log` entity='Plan'.

## Dependencies on Other Modules
- `items` — item display/validation.
- `route-cards` — default ops loader.
- `sales-orders` / `job-work-orders` (lines) — plan source + unplanned-orders query.
- `bom-master` — optional BOM reference.
- `job-cards` (`nextJcCode`, jobCards, jcOps) — manufacture execution target.
- `purchase-requests` — purchase/outsource execution target.
- `activity-log` — audit.

## User Roles / Access
- Read: any authenticated company user (RLS company_read).
- Create / edit / finalize / execute / delete: admin/manager (`requireWriteRole` + RLS manager_write).

## Reports
Planning dashboard (KPI counts by status + recent plans) and the Needs-Planning / unplanned-orders view. No file export.

## Imports / Exports
None (data-only endpoints; no xlsx/csv/pdf).

## Background Jobs
None (dashboards computed on read).
