# Stuck Activity Dashboard
**Module key:** `stuck-dashboard` · **Domain:** Production Management & Shop Floor

## Purpose
Flags sales orders whose current stage has run past a day-threshold — i.e. work that is "stuck". Scans active SOs across the whole lifecycle (design → planning → JC → material → production ops → QC → assembly → dispatch) and reports each phase over its threshold. Mirrors legacy `renderStuckDashboard` (L18017). Read-only. Pure rule helpers live in `rules.ts` (unit-tested in `rules.test.ts`).

## Pages / Screens
- Web route `stuck-dashboard` (`.../stuck-dashboard/routes/page.tsx`). List of stuck items with stage colour, days over threshold, and detail; summary tiles (total / critical / stages affected).

## Database Tables
Owns/writes: **none** — pure read/aggregation.
Reads (via `loadSoPhaseData` in `lib/so-phase-data.ts` + a direct op query): `sales_orders`, `sales_order_lines`, `clients`, `job_cards`, `jc_ops`, `op_log`, and the `v_jc_op_status` view. Op query pulls `MAX(op_log.log_date)` as the last-activity date per op. Company-isolated via RLS + explicit `company_id` filters.

## API Endpoints
- `GET /stuck-dashboard` — returns `{ items, summary, thresholds }`. Auth required; no role gate.

## Services / Key Functions
- `getStuckDashboard(user) → StuckDashboardResponse` — loads SO phase-data, derives phase-level stuck items (`derivePhaseStuckItems`), then gates op-level rules to SOs where production started but QC not all done (`firstOpStart && !lastQcEnd`), loads op candidates (`loadOpCandidates`), classifies each (`classifyOpStuck`), sorts by most-over-threshold, and rolls up the summary.
- `derivePhaseStuckItems(data, thr, today)` (pure) — phase rules below.
- `classifyOpStuck(candidate, thr, today)` (pure) — QC-pending qty → "QC Pending" (qc threshold); else available production op → "Production Op" (productionOp threshold).

## Entry Points
`server.ts` registers `stuckDashboardRoutes`.

## Business Logic
"Stuck" = a stage entered/started, its next milestone not reached, and elapsed days > that stage's threshold. Excludes closed/cancelled/already-dispatched SOs.
Phase rules (each fires only if days-since-entry > threshold):
- Design: `designAssigned && !designApproved` (thr 15)
- Planning: design ready (`designApproved` or `bomLinked`) `&& !planCreated` (thr 3, `designToPlan`)
- JC Creation: `planCreated && !jcCreated` (thr 2, `planToJc`)
- Material Procurement: `prRaised && !grnReceived` (thr 10)
- Assembly: `assemblyStarted && !assemblyDone` (thr 5)
- Dispatch Pending: `assemblyDone && !dispatched` (thr 2, `assemblyToDispatch`)
Op-level (only when `firstOpStart && !lastQcEnd`): QC Pending (qcPending>0, thr 3), Production Op (available>0, thr 5). Op "since" date = last op_log entry, else jc_date.
Defaults (`DEFAULT_STUCK_THRESHOLDS`, from legacy L17998): design 15, designToPlan 3, planToJc 2, materialProc 10, productionOp 5, qc 3, assembly 5, assemblyToDispatch 2 — shipped as constants (no config store yet).
Summary: `criticalStuck` = items >5 days over threshold; `stagesAffected` = distinct stages. Items sorted by `(days − threshold)` desc.

## Dependencies on Other Modules
Uses the shared SO phase-data engine (`lib/so-phase-data.ts`, also used by SO timeline/overview) and the `v_jc_op_status` engine. Reads across Design, Planning, Job Cards, Procurement, QC, Assembly, Dispatch.

## User Roles / Access
Any authenticated company user (RLS-scoped).

## Reports
The stuck list + summary. No file export.

## Imports / Exports
None.

## Background Jobs
None. Thresholds are compile-time constants, not stored config.
