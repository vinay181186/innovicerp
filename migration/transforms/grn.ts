// grn transform — legacy `grn` (denormalised line-per-doc) to Postgres
// `goods_receipt_notes` header + `goods_receipt_note_lines` children. Per
// ADR-015 #1 (header+lines split). 3 source records all under header
// `IN-GRN-00001` → 1 header + 3 lines.
//
// Header field mapping (from FIRST occurrence of each grnNo):
//   grnNo       → code
//   grnDate     → grn_date
//   poNo        → purchase_order_id (via byCode.purchase_orders) +
//                 po_code_text fallback
//   vendorCode  → vendor_id (via byCode.vendors) + vendor_code_text fallback
//   dcNo        → dc_no (header-level DC reference)
//   invoiceNo   → invoice_no
//   remarks     → remarks
//
// Line field mapping (per doc; legacy doesn't number GRN lines so we
// auto-assign 1..N in source order):
//   id              → _legacyId, uuidv5 → id
//   poLineId/poLineNo → purchase_order_line_id resolved via byCompositeKey
//                       ['purchase_order_lines'][${poNo}::${itemCode}].
//                       Legacy poLineId is empty in current data; we resolve
//                       by tuple per ADR-015 #9.
//   itemCode        → item_id + item_code_text fallback
//   itemName        → item_name
//   receivedQty     → received_qty
//   dcRefNo         → dc_ref_no (per-line DC ref; differs from header dcNo
//                                when split shipments)
//   qcStatus        → qc_status (legacy 'Pending' → 'pending', 'Completed'
//                                → 'completed')
//   qcAcceptedQty   → qc_accepted_qty
//   qcRejectedQty   → qc_rejected_qty
//   qcDate          → qc_date
//   qcRemarks       → qc_remarks
//   qcInspectedBy   → NULL (legacy stores text user name; doesn't resolve)
//   remarks         → remarks
//
// Anomalies:
//   - grnNo missing → skip
//   - grnDate missing → skip header (and its lines)
//   - PO not in byCode → po_code_text fallback + anomaly
//   - PO line tuple unresolvable → null + anomaly (poLineId empty in data
//                                    is normal, not an anomaly)
//   - itemCode unresolved → item_code_text fallback (NOT skipped per
//                            ADR-012 #10 pattern)
//   - qcStatus unrecognised → defaulted to 'pending' with anomaly

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyGrnDoc {
  id: string;
  grnNo?: string;
  grnDate?: string;
  poNo?: string;
  poLineId?: string;
  poLineNo?: string;
  vendorCode?: string;
  vendorName?: string;
  itemCode?: string;
  itemName?: string;
  receivedQty?: number;
  qcAcceptedQty?: number;
  qcRejectedQty?: number;
  qcStatus?: string;
  qcDate?: string;
  qcRemarks?: string;
  qcInspectedBy?: string;
  dcRefNo?: string;
  invoiceNo?: string;
  dcNo?: string;
  remarks?: string;
  createdBy?: string;
  // Legacy duplicates of the qc fields (some rows use these names):
  acceptedQty?: number;
  rejectedQty?: number;
}

export interface TransformedGrn {
  _legacyId: string; // synthetic: `grn::${grnNo}`
  id: string;
  code: string;
  grnDate: string;
  purchaseOrderId: string | null;
  poCodeText: string | null;
  vendorId: string | null;
  vendorCodeText: string | null;
  dcNo: string | null;
  invoiceNo: string | null;
  remarks: string | null;
}

export interface TransformedGrnLine {
  _legacyId: string;
  _legacyGrnCode: string;
  id: string;
  goodsReceiptNoteId: string;
  lineNo: number;
  purchaseOrderLineId: string | null;
  itemId: string | null;
  itemCodeText: string | null;
  itemName: string;
  receivedQty: number;
  dcRefNo: string | null;
  qcStatus: 'pending' | 'in_progress' | 'completed';
  qcAcceptedQty: number;
  qcRejectedQty: number;
  qcDate: string | null;
  qcRemarks: string | null;
  qcInspectedBy: string | null;
  remarks: string | null;
}

export function legacyGrnUuid(grnNo: string): string {
  return uuidv5(`goods_receipt_notes/${grnNo}`, MIGRATION_UUID_NAMESPACE);
}

export function legacyGrnLineUuid(legacyDocId: string): string {
  return uuidv5(`goods_receipt_note_lines/${legacyDocId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normaliseQcStatus(raw: string | undefined): {
  status: 'pending' | 'in_progress' | 'completed';
  unrecognised?: string;
} {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'completed' || v === 'complete') return { status: 'completed' };
  if (v === 'in progress' || v === 'in_progress') return { status: 'in_progress' };
  if (v === 'pending' || raw === undefined || v === '') return { status: 'pending' };
  return { status: 'pending', unrecognised: raw };
}

export function transformGrn(
  records: LegacyGrnDoc[],
  ctx: TransformContext,
): TransformResult<unknown>[] {
  const headerRows = new Map<string, TransformedGrn>();
  const headerOrder: string[] = [];
  const lineRows: TransformedGrnLine[] = [];
  const headerAnomalies: Anomaly[] = [];
  const lineAnomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];
  const vendorsByCode = ctx.lookups.byCode['vendors'];
  const posByCode = ctx.lookups.byCode['purchase_orders'];
  const poLinesByComposite = ctx.lookups.byCompositeKey['purchase_order_lines'];

  // Per-header line counter so we can auto-assign lineNo in source order.
  const lineCounters = new Map<string, number>();

  for (const r of records) {
    if (!r.grnNo) {
      headerAnomalies.push({ legacyId: r.id, type: 'grnNo_missing' });
      continue;
    }
    const grnNo = r.grnNo.trim();

    if (!headerRows.has(grnNo)) {
      if (!r.grnDate) {
        headerAnomalies.push({ legacyId: r.id, type: 'grnDate_missing', details: { grnNo } });
        continue;
      }

      const poCode = r.poNo?.trim();
      const purchaseOrderId = poCode ? (posByCode?.get(poCode) ?? null) : null;
      const poCodeText = poCode && !purchaseOrderId ? poCode : null;
      if (poCode && !purchaseOrderId) {
        headerAnomalies.push({
          legacyId: r.id,
          type: 'po_unresolved',
          details: { grnNo, poNo: poCode },
        });
      }

      const vendorCode = r.vendorCode?.trim();
      const vendorId = vendorCode ? (vendorsByCode?.get(vendorCode) ?? null) : null;
      const vendorCodeText = vendorCode && !vendorId ? vendorCode : null;

      headerRows.set(grnNo, {
        _legacyId: `grn::${grnNo}`,
        id: legacyGrnUuid(grnNo),
        code: grnNo,
        grnDate: r.grnDate,
        purchaseOrderId,
        poCodeText,
        vendorId,
        vendorCodeText,
        dcNo: emptyToNull(r.dcNo),
        invoiceNo: emptyToNull(r.invoiceNo),
        remarks: emptyToNull(r.remarks),
      });
      headerOrder.push(grnNo);
      lineCounters.set(grnNo, 0);
    }

    const headerRow = headerRows.get(grnNo);
    if (!headerRow) continue;

    if (typeof r.receivedQty !== 'number' || r.receivedQty < 0) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'receivedQty_invalid',
        details: { grnNo, receivedQty: r.receivedQty },
      });
      continue;
    }
    if (!r.itemName) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'itemName_missing',
        details: { grnNo },
      });
      continue;
    }

    const itemCodeRaw = r.itemCode?.trim() ?? '';
    const itemId = itemCodeRaw ? (itemsByCode?.get(itemCodeRaw) ?? null) : null;
    const itemCodeText = itemCodeRaw && !itemId ? itemCodeRaw : null;

    // Resolve PO line by (po code, item code) tuple per ADR-015 #9.
    let purchaseOrderLineId: string | null = null;
    if (headerRow.poCodeText || headerRow.purchaseOrderId) {
      const poCodeForLookup = (r.poNo ?? '').trim();
      const compositeKey =
        poCodeForLookup && itemCodeRaw ? `${poCodeForLookup}::${itemCodeRaw}` : null;
      if (compositeKey) {
        purchaseOrderLineId = poLinesByComposite?.get(compositeKey) ?? null;
        if (!purchaseOrderLineId) {
          lineAnomalies.push({
            legacyId: r.id,
            type: 'po_line_unresolved',
            details: { grnNo, poNo: poCodeForLookup, itemCode: itemCodeRaw },
          });
        }
      }
    }

    const { status: qcStatus, unrecognised: qcUnrecognised } = normaliseQcStatus(r.qcStatus);
    if (qcUnrecognised) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'qc_status_unrecognised',
        details: { grnNo, from: qcUnrecognised, defaultedTo: qcStatus },
      });
    }
    if (r.qcInspectedBy) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'qc_inspected_by_text_only',
        details: { grnNo, qcInspectedBy: r.qcInspectedBy },
      });
    }

    // Some legacy rows use `acceptedQty`/`rejectedQty` instead of qcAcceptedQty/
    // qcRejectedQty. Take the max of either field as the resolved value.
    const qcAcceptedQty = Math.max(
      typeof r.qcAcceptedQty === 'number' ? r.qcAcceptedQty : 0,
      typeof r.acceptedQty === 'number' ? r.acceptedQty : 0,
    );
    const qcRejectedQty = Math.max(
      typeof r.qcRejectedQty === 'number' ? r.qcRejectedQty : 0,
      typeof r.rejectedQty === 'number' ? r.rejectedQty : 0,
    );

    // CHECK constraint: qc_accepted + qc_rejected <= received_qty.
    // If legacy data violates this (shouldn't but be defensive), clamp.
    let clampedAccepted = qcAcceptedQty;
    let clampedRejected = qcRejectedQty;
    if (clampedAccepted + clampedRejected > r.receivedQty) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'qc_total_exceeds_received',
        details: {
          grnNo,
          receivedQty: r.receivedQty,
          qcAccepted: clampedAccepted,
          qcRejected: clampedRejected,
          clampedTo: r.receivedQty,
        },
      });
      // Preserve accepted, clamp rejected.
      clampedRejected = Math.max(0, r.receivedQty - clampedAccepted);
      if (clampedAccepted > r.receivedQty) {
        clampedAccepted = r.receivedQty;
        clampedRejected = 0;
      }
    }

    const nextLineNo = (lineCounters.get(grnNo) ?? 0) + 1;
    lineCounters.set(grnNo, nextLineNo);

    lineRows.push({
      _legacyId: r.id,
      _legacyGrnCode: grnNo,
      id: legacyGrnLineUuid(r.id),
      goodsReceiptNoteId: headerRow.id,
      lineNo: nextLineNo,
      purchaseOrderLineId,
      itemId,
      itemCodeText,
      itemName: r.itemName.trim(),
      receivedQty: r.receivedQty,
      dcRefNo: emptyToNull(r.dcRefNo),
      qcStatus,
      qcAcceptedQty: clampedAccepted,
      qcRejectedQty: clampedRejected,
      qcDate: emptyToNull(r.qcDate),
      qcRemarks: emptyToNull(r.qcRemarks),
      qcInspectedBy: null,
      remarks: emptyToNull(r.remarks),
    });
  }

  // Order the header rows in source order.
  const orderedHeaders = headerOrder
    .map((code) => headerRows.get(code))
    .filter((h): h is TransformedGrn => h !== undefined);

  return [
    {
      table: 'goods_receipt_notes',
      sourceCollection: 'grn',
      transformedAt: new Date().toISOString(),
      rows: orderedHeaders,
      anomalies: headerAnomalies,
    },
    {
      table: 'goods_receipt_note_lines',
      sourceCollection: 'grn',
      transformedAt: new Date().toISOString(),
      rows: lineRows,
      anomalies: lineAnomalies,
    },
  ];
}
