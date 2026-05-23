# PARITY — TPI (Third Party Inspection) (`renderTPI`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L21381–21570 (`renderTPI`, `_tpiToggle`, `_tpiSubmit` L21510, `_tpiExport`).
> **React target:** **none** — page missing. Route `/tpi` (sidebar QC → Entry).

---

## Verdict: MISSING — small migration (op_log columns), NOT a new table

**Corrected data model:** TPI is **not** a standalone `tpi_records` table. In legacy, a TPI op is just a **QC op whose operation name contains "TPI"** (`o.qcReq && operation ILIKE '%TPI%'`). The TPI submit writes a normal QC **`op_log`** entry (`type='qc'`) flagged `isTPI=true` with three extra metadata fields: `tpiInspector`, `tpiOrganization`, `tpiCertNo`.

So the build needs **4 nullable columns on `op_log`**: `is_tpi boolean default false`, `tpi_inspector text`, `tpi_organization text`, `tpi_cert_no text` (migration ~`0037`). Reuses the existing QC accept/reject write — no separate inspection table.

### Page structure
- Header "🔍 TPI (Third Party Inspection)".
- **Pending TPI** panel: QC ops with "TPI" in the operation name + qc_pending>0; each expandable → TPI Entry form: Date · Shift · Accept Qty (≤ pending) · Reject Qty · **TPI DETAILS (Inspector★ · Organization★ · Cert No. · Remarks)** · attach report · ✓ Submit TPI.
- **Completed TPI Records** table (14 cols): JC · OP · SO · ITEM · OPERATION · ACC · REJ · CALL DATE · ATTENDED · RESPONSE · INSPECTOR · ORGANIZATION · CERT NO. · REPORT. + ⬇ Excel export.

### Build plan
1. **Migration ~`0037`**: `op_log` += `is_tpi`, `tpi_inspector`, `tpi_organization`, `tpi_cert_no` (all nullable). Coordinate number with Production re-audit (reserved 0034/0035) + CAPA (`0036`).
2. **Extend QC submit**: `submitQcLogInputSchema` + op-entry `submitOpLog`/QC path to accept the 4 TPI fields and set them on the `op_log` insert (or a dedicated `/tpi/submit` that inserts the same op_log shape). Prefer extending the shared QC submit to avoid duplicating the log-write logic.
3. **API `modules/tpi`**: GET /tpi → pending TPI ops (v_jc_op_status ⨝ jc_ops where operation ILIKE '%TPI%', qc_pending>0) + completed (op_log where is_tpi).
4. **Web `/tpi`**: pending list w/ inline TPI form (reuses QC submit + TPI fields) + completed 14-col table. Legacy chrome. Sidebar QC → Entry + router.

### Note
This supersedes the earlier "tpi_records table" assumption in qc-section.md / qc-so-status.md — TPI is op_log metadata. SO QC Status / QC Command Center read TPI via `op_log.is_tpi`.
