# PARITY — SO QC Status (`renderSOQCStatus`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L18347–18610.
> **React target:** `apps/web/src/modules/so-qc-status/` (route `/so-qc-status`).

---

## Verdict: BUILT ✅ — full 4-stage parity (2026-05-24)

SO selector → summary strip (QC Ops / Incoming QC / QC Pending / Documents / TPI)
→ per-line rollup of **all four legacy QC stages** with status pills + an Overall
pill (Passed / In Progress / Pending / No QC). Read-only, no migration.

`renderSOQCStatus` is a per-SO, per-line QC rollup. For each SO line it gathers **four QC stages**:

1. **QC Ops** — `jc_ops` where op_type='QC' or qc_required. ✅ `v_jc_op_status` on JCs sourced from the line (`job_cards.source_so_line_id`).
2. **TPI** — third-party inspection. ✅ `op_log.is_tpi` on the same JCs (migration 0037).
3. **GRN QC** — incoming-material QC on the line's POs. ✅ `goods_receipt_note_lines` → `purchase_order_lines`, attributed to the SO line via `pol.source_so_line_id` (direct purchase) **or** `pol.source_jc_op_id → jc_ops → job_cards.source_so_line_id` (outsource). "Done" = `qc_status = 'completed'`.
4. **QC Documents** — ✅ `qc_documents.job_card_id → job_cards.source_so_line_id` (migration 0039). Every registered doc carries a file, so docCount = uploaded.

The earlier 2-of-4 blocker is **resolved**: TPI/Docs/CAPA infra all landed (migrations 0036/0037/0039), and `purchase_order_lines` gained `source_so_line_id` + `source_jc_op_id`, which is the GRN→SO-line attribution path the original note said was missing.

## Minor DELTA (backlog, not blocking)
- **No expandable per-line detail tables** (legacy `_sqcToggle` expands GRN/TPI/Docs sub-tables with vendor / inspector / file-link rows). The React page keeps the flat rollup design it was built with — pills + counts, no row expansion. Add detail expansion if the user wants drill-down.
- **No per-line Overall %** bar — the React page uses an enum badge (none/pending/in_progress/passed) rather than legacy's % progress bar.
- **"Required docs" gating** (legacy missing-doc concept) not modelled here; `qc_documents` only stores uploaded files. Plans `required_docs` is the future source for that.

## ⚠️ Note — dev-DB migration gap found 2026-05-24
This dev DB was **missing migrations 0036–0039** (capa/tpi/report_types/qc_documents) — the existing TPI query (`op_log.is_tpi`) was 500ing and the new Docs query needs `qc_documents`. The prior QC modules shipped without tests, so this was latent. Applied all four (idempotent) via `apply-sql.ts`; the new so-qc-status service test now exercises the path.
