# QC Module — Legacy-Parity Build Tracker (2026-05-27)

> Goal (user, 2026-05-27): map every QC page from `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`, find all remaining differences vs the React build, and build to 1:1. Build directly; **no commit prompts** (commit logical chunks autonomously); ask only on genuine **data conflicts**; the user tests the whole QC module at the end.
>
> Source of gaps: 4-agent re-audit 2026-05-27 (each read the legacy `render*` directly). Decisions taken via AskUserQuestion 2026-05-27 — see below.

## Decisions (locked)
- **QC report attachments → FULL.** Migrations on `op_log` + `goods_receipt_note_lines` (done, 0043) + upload on QC/TPI submit (qc-docs bucket) + Report/download columns on Incoming QC, QC History, QC Call Register, TPI, SO QC Status.
- **QC Documents → REBUILD to legacy SO-pivoted matrix** (per-QC-op columns, serial-range, mandatory/optional gating). Schema done (0043: `qc_documents.jc_op_id/qc_op_name/sr_from/sr_to`).
- **QC Process Master std-time → KEEP minutes** (intentional DELTA, no change).
- **Schema adds → NC operator field (0043) + 'General' shift (0044)** — both done.
- Defaults applied w/o asking: drop Inspector "Avg Hrs/Inspection" (no hours data); keep current RBAC on Pick-Up / add-permission (DELTA); keep 4-digit CAPA codes; NC↔CAPA via `capa_records.ncRefs` lookup (no schema).

## Build chunks (commit each)
- [x] **0. Schema foundation** — migrations 0043+0044, schema.ts, SHIFTS, SCHEMA.md. Commit `0c8567f`.
- [ ] **1. Shift 'general' UI** — add to QC Call Register + TPI + Op-Entry shift dropdowns (SHIFTS already widened). Small.
- [x] **2. QC report attachments (cross-cutting)** — DONE. New `apps/web/src/components/shared/qc-report-attach.tsx` (`QcReportAttach` 📎 upload → `uploadFile` qc-docs bucket; `QcReportLink` 📄 → `signedUrl`). Threaded `qcReportPath`/`qcReportName` through `submitQcLogInputSchema` + op-entry op_log write (covers QC/TPI/Call-Register) AND the GRN-QC line write. Exposed on read shapes: qc-history log, tpi completed, incoming-qc completed, so-qc-status GRN+TPI detail. Attach control on all 4 QC submit forms; ⬇ Report link on all 5 completed surfaces. typecheck+lint clean; affected suites pass.
- [x] **3. QC History** — DONE (minus report col → chunk 2). 🔬 link fixed → `/qc-call-register`; overdue row-blink; Export Completed/Pending (xlsx); IST date fmt.
- [x] **4. QC Call Register** — DONE (minus 📎 attach report → chunk 2). `[CPO:xxx]` tag; logNo; Called→waiting→Response via qcCallDate; COMPLETE count chip; per-panel search; overdue blink; inspector datalist (active operators).
- [x] **5. Incoming QC** — DONE (minus report col → chunk 2). `valueInQc` ₹ card (Σ pendingQty × po_lines.rate), legacy card order, footer hint, empty-state wording. typecheck+lint clean.
- [x] **6. NC Register** — DONE. 5 stat cards via new `GET /nc-register/summary`; reason-category filter; Operation column; status "Rework Complete" via `NC_STATUS_LABELS`; empty-state hint; form: required defect desc + `operatorText` (0043) + NC-code auto-suggest + JC-op dependent dropdown; dispose panel: full JC op list + context block; **NC↔CAPA**: `linkedCapaCode` (jsonb `nc_refs @>` lookup) on list/detail + "Create CAPA" button prefilling ncRefs+jc/so/item/op. (`nc_refs` is jsonb, not text[].) typecheck+lint clean; nc-register tests pass.
- [x] **7. CAPA** — DONE. New-CAPA NC-reference dropdown (NCs lacking a CAPA, client-side via ncRefs set) + back-fill jc/so/item/op; Edit Step-3 Responsible select (operators+users, preserves saved value); "Monitoring" added to `CAPA_EFFECTIVENESS`. typecheck+lint clean.
- [x] **8. QC Command Center — Pareto + Inspector rebuilt.** New shared `QcCommandPareto`/`QcParetoRow` + `QcInspectorPerfRow` on `QcCommandResponse`; service computes Pareto (ALL nc_register grouped by reason, sorted by rejected-qty desc, %-of-qty, top-3 items, header totals) + Inspector perf (from the already-loaded QC op_log + qc_assignments: inspections, distinct JCs, accepted, rejected, rej-rate 5/15 colors, current load). `ParetoTab`/`InspectorTab` rewritten to consume them; `index.tsx` no longer reuses `/qc-dashboard`. `NC_REASON_CATEGORY_LABELS` added. Avg-Hrs dropped (no hours col). typecheck+lint clean; qc-command tests 17/17 pass in isolation (12 service + 5 routes — run per-file: service.test.ts + routes.test.ts collide on a shared `testOpId` under vitest file-parallelism, pre-existing). pickup/assign activity_log NOT added (deferred — minor).
- [x] **9. SO QC Status** — DONE (minus per-row Report-download links → chunk 2). Per-JC/per-op QC-stage cell (✅/⏳/❌, op name, accepted/orderQty, (rej), [pending], [Nx]); Overall % bar (`overallPct`); expandable GRN/TPI/Docs detail rows; TOTAL footer; SO header Due date (`MIN(sales_order_lines.due_date)` — `sales_orders` has no due-date col) + Type; "⚠ No QC stage defined" amber. 4/4 service tests pass.
- [x] **10. QC Documents — MATRIX REBUILD** — DONE. Matrix/File-Register tabs. SO selector + SO summary bar + % bar; SO-pivoted matrix (Ln/CPO/Item/Qty/JC + dynamic QC-op cols MIR/MCR/DIR/TPI/… + Overall) with per-cell ✅Done+date+⬇ / ⏳Pending+qty / — ; line-detail modal (QC batches w/ derived serial ranges, per-doc-type MANDATORY/OPTIONAL from report_types.default_mandatory, upload by serial range, View/Delete); Export Excel + Download-All. New endpoints `/qc-documents/{so-list,matrix,line-detail}`; uploads now set jc_op_id-link fields (0043). Flat register kept under a tab. DELTAs: JW selector deferred (JCs link via source_so_line_id only); new-upload matrix match by qc_op_name (line-detail doesn't surface per-section jc_op_id); Download-All opens signed-URL tabs. typecheck+lint clean; qc-documents tests pass.
- [x] **11. QC Reports** — DONE. `nc-summary-by-reason` now has disposition-breakdown cols (Rework/Scrap/Use As Is/RTV/Make Fresh) + TOTAL row; new `nc-by-so-jc` + `nc-register-all` definitions registered under group 'Quality'. ("Closed" col uses `disposition_date` — no dedicated closed-date column; noted.) Stale registry count tests (hardcoded 11, actually 17 pre-existing) synced to the real 19-report registry. typecheck+lint clean; reports tests pass EXCEPT pre-existing `items-on-hand` (dev-DB has an item with negative computed on-hand; definition untouched — environmental, not a QC change).
- [x] **12. TPI** — Excel export of completed records DONE (xlsx, dynamic import). Shift General done (chunk 1). Attach report + Report col → chunk 2.

## Pages already at parity (no action)
QC Dashboard (QC Engineer) — only optional cosmetic "Go to QC Register" button. Report / Document Master — 1:1.

## Notes / DELTAs to record at the end
- Inspector "Avg Hrs/Inspection" dropped — `op_log` has no hours column (legacy itself flagged mobile-entry dependency).
- Pick-Up / QC-Process add-permission keep current RBAC (admin/manager/qc) vs legacy's looser gate — intentional security DELTA.
- QC Process Master std-time stays minutes (DELTA from legacy hours).

## Pre-existing test/env issues (NOT caused by this QC build — verified by stashing)
- `goods-receipt-notes/service.test.ts` + `routes.test.ts`: 10 tests fail with "Goods receipt note <id> not found" after create — fail identically with the QC changes STASHED (GRN code at committed 42c1a20, untouched by QC). Environmental dev-DB state (the create→read cascade / migration lag per [[environment_dev_db_migration_gap]]). Re-test on a clean/seeded DB.
- `reports/service.test.ts` "items-on-hand": one item has negative computed on-hand in the dev DB → fails `>= 0`. Report definition untouched.
- qc-command service.test.ts + routes.test.ts collide on a shared `testOpId` under vitest file-parallelism — run per-file (pass in isolation).
