# PARITY — Incoming QC (`renderIncomingQC`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L23748–23842+ (`renderIncomingQC`), inspect modal `grnQC`, `_viewQCReport`.
> **React target:** **none** — page missing. Route `/incoming-qc` (sidebar QC → Entry, first item). Reads GRN QC fields; existing `goods-receipt-notes` module is the data source.

---

## Verdict: MISSING — full-stack build (GRN-driven incoming inspection)

Incoming QC is the inspection queue for **received GRNs awaiting QC**. Pending = `received_qty − qc_accepted_qty − qc_rejected_qty > 0` and `qc_status <> Completed`.

### Pipeline dashboard (7 cards, L23834–23841)
GRNs Waiting · Pending Qty · Avg Wait (days) · Oldest GRN (days + grnNo) · Value in QC (₹ = Σ pendQty×PO rate) · Today Accepted (+GRN count) · Today Rejected.

### Pending GRNs table (L23760–23778)
GRN No · Date · PO (or "Manual") · Vendor · Item Code · Item Name · Received · **Wait** (⏳ Nd, colour by age) · **Pending Qty** (amber) · **[🔬 Inspect]** → `grnQC(id)`.

### Completed GRNs table (last 20, L23780–23807)
GRN No · GRN Date · QC Date · **Resp** (response days, "Same day"/Nd, colour) · Vendor · Item Code · Item Name · Received · **Accepted** (green) · **Rejected** (red) · **Disposition** (Accepted/Partial Accept/Rejected) · Remarks · **Report** (📄 if `qcReportData`).

### Inspect modal (`grnQC`)
Accept qty + Reject qty (≤ received pending) + remarks + optional QC report attach → sets `qc_accepted_qty`/`qc_rejected_qty`/`qc_date`/`qc_status`. Rejections feed NC Register (auto-NC).

### Build plan (full-stack, Wave 2) — ✅ NO MIGRATION
1. **GRN QC fields confirmed present** on `goods_receipt_note_lines`: `qc_status`
   (enum), `qc_accepted_qty`, `qc_rejected_qty`, `qc_date`, `qc_remarks` (+ checks
   `accepted+rejected ≤ received`). **No migration needed** — most tractable QC build.
2. **API** `modules/incoming-qc` (or extend `goods-receipt-notes`): list pending + completed + pipeline metrics; inspect action (write accept/reject + optional auto-NC).
3. **Web** `modules/incoming-qc`: 7-card dashboard + pending table (Inspect) + completed table, legacy chrome.
4. Sidebar QC → Entry "Incoming QC" + router.

> Overlaps the GRN module's QC-status tiles (see `docs/PARITY/grn.md` §2). Reuse GRN read where possible; Incoming QC is the inspection-action surface.
