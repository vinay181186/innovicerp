# PARITY — CAPA (`renderCAPA`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L22779–22828 (list), `_capaNew` L22831, `_capaEdit` L22860 (5-step modal), `_nextCAPANo`, `_capaForNC`, `_createCAPAFromNC`.
> **React target:** **none** — page missing. Route `/capa` (sidebar QC → Entry). Backend `capa_records` table exists (SCHEMA.md); no API/web module yet.

---

## Verdict: MISSING — full-stack build (register + 5-step workflow modal)

### List (L22779–22828)
- Header "🛡 CAPA — Corrective & Preventive Action" + **"➕ New CAPA"** (purple, canEntry).
- **Overdue alert** banner: CAPAs past `targetDate` not Closed/Verified.
- **6 summary cards:** Total · Open · In Progress · Verified · Closed · **Effectiveness %** (= Closed&Effective / Closed).
- Search box.
- **10-col table:** CAPA No. · Type (Corrective/Preventive pill) · Date · NC Ref · Problem · Root Cause · Responsible · Target (red+⚠ if overdue) · Status · Actions (👁 detail · ✏ edit if not Closed · 👤+ assign).
- Status colours: Open amber · In Progress blue · Verified purple · Closed green. Overdue row → red left-border.

### New CAPA modal (`_capaNew` L22831)
Fields: CAPA No (auto `_nextCAPANo`), Type★ (Corrective/Preventive), Date, NC Reference (select unused NCs), JC/SO Reference, Department (Production/QC/Store/Purchase/Design), Problem Description★.

### Edit modal — **5-step process** (`_capaEdit` L22860)
1. Problem Description.
2. Root Cause Analysis (Method: 5-Why / Fishbone / Other + text).
3. Corrective Action (text + Responsible + Target Date).
4. Verification (text + Verified By + date).
5. Preventive Action + Effectiveness (Effective/Not) + review → status Open→In Progress→Verified→Closed.

### Cross-link
NC Register's "🛡 CAPA" action calls `_createCAPAFromNC(ncNo)` (prefills NC ref). NC list shows the linked CAPA No when one exists (`_capaForNC`).

### Build plan (full-stack, Wave 3)
1. **shared** `capa.ts`: capa record shape + create/update/status enums (type, status, effectiveness, root-cause-method).
2. **API** `modules/capa`: list (+ counters), create, update (5-step fields), `nextCapaNo`. Over `capa_records` (table exists — confirm columns vs the 5-step fields; may need a migration to add missing cols).
3. **Web** `modules/capa`: list (cards + overdue alert + 10-col table, legacy chrome) + New modal + 5-step edit + detail.
4. Wire NC Register CAPA create/link action.
5. Sidebar QC → Entry "CAPA" + router.

> **Confirmed (2026-05-23):** `capa_records` does **NOT** exist in the Drizzle
> schema (nor `qc_inspections`). CAPA is a from-scratch table — needs a new
> migration with all 5-step columns (type, status, date, ncRefs[], jcNo/soNo/
> itemCode, problem, rootCauseMethod, rootCause, correctiveAction, responsible,
> targetDate, verification, verifiedBy/Date, preventiveAction, effectiveness,
> reviewDate, department + standard cols + RLS). Migration-bearing → coordinate
> with any concurrent migration work before building.
