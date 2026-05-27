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
- [ ] **2. QC report attachments (cross-cutting)** — web upload control on QC/TPI submit (reuse `lib/storage`/`file-upload`), thread report path/name through `submitQcLog` + GRN-QC write; expose `qcReportPath/Name` in qc-history / incoming-qc / tpi / so-qc-status read shapes; Report ⬇ columns. (op_log + grn cols exist.)
- [ ] **3. QC History** — fix 🔬 link → `/qc-call-register` (currently wrong → `/qc-dashboard`); Excel export (Completed+Pending); overdue row-blink `qc-alert-blink`; Report col (chunk 2); IST date fmt.
- [ ] **4. QC Call Register** — `[CPO:xxx]` tag (expose job_cards.clientPoLineNo); logNo on completed cards; per-panel search (L+R); overdue blink; inspector datalist (operators); COMPLETE count chip; Called→Attended→Response via `jc_ops.qcCallDate` (exists, expose); 📎 attach report (chunk 2); shift General (chunk 1).
- [ ] **5. Incoming QC** — "Value in QC" ₹ card (Σ pendingQty × po_lines.rate); footer hint; Report col (chunk 2); card order/wording.
- [ ] **6. NC Register** — 5 stat cards (new `/nc-register/summary` aggregate endpoint); reason-category filter; Operation column (jcOpOperation already returned); status label "Rework Complete"; empty-state hint; form: required defect desc + auto NC No + JC-op dependent dropdown + operator field (0043); dispose panel: full JC op list + context block + reason re-pick; **NC↔CAPA**: "Create CAPA from NC" + linked CAPA-xxx (capa_records.ncRefs lookup endpoint).
- [ ] **7. CAPA** — New modal: NC-reference picker (un-CAPA'd NCs) + back-fill jc/so/item/op; Edit modal: Responsible picker (operators+users); add "Monitoring" to CAPA_EFFECTIVENESS.
- [x] **8. QC Command Center — Pareto + Inspector rebuilt.** New shared `QcCommandPareto`/`QcParetoRow` + `QcInspectorPerfRow` on `QcCommandResponse`; service computes Pareto (ALL nc_register grouped by reason, sorted by rejected-qty desc, %-of-qty, top-3 items, header totals) + Inspector perf (from the already-loaded QC op_log + qc_assignments: inspections, distinct JCs, accepted, rejected, rej-rate 5/15 colors, current load). `ParetoTab`/`InspectorTab` rewritten to consume them; `index.tsx` no longer reuses `/qc-dashboard`. `NC_REASON_CATEGORY_LABELS` added. Avg-Hrs dropped (no hours col). typecheck+lint clean; qc-command tests 17/17 pass in isolation (12 service + 5 routes — run per-file: service.test.ts + routes.test.ts collide on a shared `testOpId` under vitest file-parallelism, pre-existing). pickup/assign activity_log NOT added (deferred — minor).
- [ ] **9. SO QC Status** — per-JC/per-op QC-stage cell (icons ✅/⏳/❌, op name, accepted/orderQty, (rej), [pending], [Nx attempts]); Overall % progress bar (+overallPct); expandable detail rows (GRN / TPI / Docs sub-tables w/ Report links — chunk 2); TOTAL footer row; SO Due date + Type in header; "⚠ No QC stage defined" amber.
- [ ] **10. QC Documents — MATRIX REBUILD** — SO/JW selector; SO summary bar + % progress; SO-pivoted matrix (Ln/CPO/Item/Qty/JC + dynamic QC-op cols MIR/MCR/DIR/TPI/… + Overall); per-cell ✅Done+date+⬇ / ⏳Pending / —; line-detail modal (QC batches w/ serial ranges, per-doc-type mandatory/optional upload rows, View/Download/Delete); Export Excel + Download-All. Uses 0043 cols (jc_op_id/qc_op_name/sr_from/sr_to) + report_types.default_mandatory for gating. Big.
- [ ] **11. QC Reports** — `_rptNC` parity in reports module: disposition-breakdown columns (Rework/Scrap/UseAsIs/RTV/MakeFresh) + TOTAL row on `nc-summary-by-reason`; new "NC by SO/JC" report; new "NC Register (All Records)" flat report. Verify group naming (`?group=Quality`).
- [ ] **12. TPI** — Excel/CSV export of completed records; shift General (chunk 1); attach report + Report col (chunk 2).

## Pages already at parity (no action)
QC Dashboard (QC Engineer) — only optional cosmetic "Go to QC Register" button. Report / Document Master — 1:1.

## Notes / DELTAs to record at the end
- Inspector "Avg Hrs/Inspection" dropped — `op_log` has no hours column (legacy itself flagged mobile-entry dependency).
- Pick-Up / QC-Process add-permission keep current RBAC (admin/manager/qc) vs legacy's looser gate — intentional security DELTA.
- QC Process Master std-time stays minutes (DELTA from legacy hours).
