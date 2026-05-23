# PARITY — SO QC Status (`renderSOQCStatus`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L18347–18610.
> **React target:** **none** — page missing. Route `/so-qc-status`. **Blocked on missing infra** (see below).

---

## Verdict: BUILT ✅ (partial — 2 of 4 stages) — `/so-qc-status`

SO selector → per-line rollup of **QC Ops + TPI** (cleanly attributable via
`job_cards.source_so_line_id` → `v_jc_op_status` + `op_log.is_tpi`), with an
Overall pill (Passed / In Progress / Pending / No QC). **GRN-QC + Docs columns
show "—"**: GRN QC isn't attributable per SO line in the normalised model, and
QC Documents isn't built. Full 4-stage parity tracked below.

`renderSOQCStatus` is a per-SO, per-line QC rollup. For each SO line it gathers **four QC stages** and shows status pills + an Overall:

1. **QC Ops** — `jc_ops` where op_type='QC' or qc_required, with accept/reject from op entries. ✅ available (op_log qc + v_jc_op_status).
2. **GRN QC** — GRNs against the line's POs (`grn.qc_status`/accepted/rejected). ✅ available (goods_receipt_note_lines).
3. **TPI** — `db.tpiRecords` (third-party inspection). ❌ **no `tpi_records` table** in our schema.
4. **QC Documents** — `db.qcDocUploads` + `db.fileRegistry` + `jc.qcDocs`. ❌ **no QC-doc/attachment storage** in our schema.

Header: SO selector → SO header card → per-line table with Incoming-QC / TPI / Docs / Overall pills (L18495), click row to expand stage detail tables.

## Build blocker / dependency chain

SO QC Status (and **QC Command Center**, which rolls up the same stages org-wide) cannot reach 1:1 until the upstream QC infra exists:

- **TPI Inspection** → needs a `tpi_records` table (migration) + an entry page.
- **QC Documents** → needs a QC-document/attachment store (table + Supabase Storage wiring) + the QC-docs page.
- **CAPA** → needs a `capa_records` table (migration).

Only **then** can SO QC Status / QC Command Center aggregate all four stages faithfully.

## ⚠️ Concurrent-migration conflict (2026-05-23)

All remaining QC pages are **migration-bearing or depend on migration-bearing infra**. A **parallel session is actively editing `schema.ts` + adding migrations** for the Design module (just landed `0033`). Adding QC migrations (capa/tpi/qc-docs) concurrently risks Drizzle journal + schema.ts conflicts. **Sequence the QC migration wave after the Design migrations settle**, or coordinate the journal.

## Interim option (no migration)
A reduced SO QC Status showing only the **two available stages** (QC Ops + GRN QC) per SO line is buildable now, with TPI/Docs columns shown as "—/n/a" until their infra lands. Lower parity but unblocks the SO-level QC view. Flag before building (partial parity).
