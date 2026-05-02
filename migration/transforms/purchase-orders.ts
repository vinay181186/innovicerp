// purchase-orders transform — legacy `purchaseOrders` (denormalised
// line-per-doc, like SO/JW) to Postgres `purchase_orders` header +
// `purchase_order_lines` children. Per ADR-015 #1.
//
// Header field mapping (from FIRST occurrence of each poNo):
//   poNo        → code
//   poDate      → po_date
//   poType      → po_type (legacy 'Job Work' → 'job_work', etc.)
//   vendorCode  → vendor_id (via byCode.vendors) + vendor_code_text fallback
//   status      → status (legacy 'Open' → 'open')
//   dueDate     → due_date (header-level; lines may override)
//   taxType     → tax_type (kept as text)
//   sgstPct/cgstPct/igstPct → sgst_pct/cgst_pct/igst_pct
//   prNo        → pr_code_text (audit; not an FK)
//   approvedBy  → approved_by (NULL — legacy text doesn't resolve;
//                              anomaly logged)
//   approvedDate→ approved_at (timestamptz)
//   approvalRemarks → approval_remarks
//   remarks     → remarks
//
// Line field mapping (per doc):
//   id              → _legacyId, uuidv5 → id
//   lineNo          → line_no
//   itemCode        → item_id (via byCode.items) + item_code_text fallback
//   itemName        → item_name (snapshot)
//   qty             → qty
//   rate            → rate
//   receivedQty     → received_qty (preserved from legacy)
//   dueDate         → due_date
//   soRefId         → source_so_line_id (via idMap.sales_order_lines)
//   prNo + ctx.byCompositeKey['purchase_requests_to_jc_op_id'][prNo]
//                   → source_jc_op_id (forward link via PR's jcNo+opSeq)
//   lineRemarks     → line_remarks
//
// Anomalies follow the same pattern as sales-orders.ts.

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyPoDoc {
  id: string;
  poNo?: string;
  lineNo?: string | number;
  poDate?: string;
  poType?: string;
  vendorCode?: string;
  vendorName?: string;
  status?: string;
  dueDate?: string;
  taxType?: string;
  sgstPct?: number;
  cgstPct?: number;
  igstPct?: number;
  prNo?: string;
  soRefId?: string;
  itemCode?: string;
  itemName?: string;
  qty?: number;
  rate?: number;
  receivedQty?: number;
  lineRemarks?: string;
  remarks?: string;
  approvedBy?: string;
  approvedDate?: string;
  approvalRemarks?: string;
}

export interface TransformedPurchaseOrder {
  _legacyId: string; // synthetic: `po::${poNo}`
  id: string;
  code: string;
  poDate: string;
  poType: 'standard' | 'job_work' | 'outsource' | 'service';
  vendorId: string | null;
  vendorCodeText: string | null;
  status: 'draft' | 'open' | 'partial' | 'qc_pending' | 'closed' | 'cancelled';
  dueDate: string | null;
  taxType: string | null;
  sgstPct: string;
  cgstPct: string;
  igstPct: string;
  prCodeText: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalRemarks: string | null;
  remarks: string | null;
}

export interface TransformedPurchaseOrderLine {
  _legacyId: string;
  _legacyPoCode: string;
  /** Composite key for byCompositeKey['purchase_order_lines'] —
   *  `${poCode}::${itemCode}` allows GRN line resolution. */
  _legacyItemCode: string | null;
  id: string;
  purchaseOrderId: string;
  lineNo: number;
  itemId: string | null;
  itemCodeText: string | null;
  itemName: string;
  qty: number;
  rate: string;
  receivedQty: number;
  dueDate: string | null;
  sourceSoLineId: string | null;
  sourceJcOpId: string | null;
  lineRemarks: string | null;
}

export function legacyPurchaseOrderUuid(poNo: string): string {
  return uuidv5(`purchase_orders/${poNo}`, MIGRATION_UUID_NAMESPACE);
}

export function legacyPurchaseOrderLineUuid(legacyDocId: string): string {
  return uuidv5(`purchase_order_lines/${legacyDocId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normaliseType(
  raw: string | undefined,
): {
  type: 'standard' | 'job_work' | 'outsource' | 'service';
  unrecognised?: string;
} {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'job work' || v === 'job_work') return { type: 'job_work' };
  if (v === 'outsource') return { type: 'outsource' };
  if (v === 'service') return { type: 'service' };
  if (v === 'standard') return { type: 'standard' };
  if (raw === undefined || raw.trim() === '') return { type: 'standard' };
  return { type: 'standard', unrecognised: raw };
}

function normaliseStatus(
  raw: string | undefined,
):
  | 'draft'
  | 'open'
  | 'partial'
  | 'qc_pending'
  | 'closed'
  | 'cancelled' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'draft') return 'draft';
  if (v === 'partial') return 'partial';
  if (v === 'qc pending' || v === 'qc_pending') return 'qc_pending';
  if (v === 'closed' || v === 'completed') return 'closed';
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  return 'open';
}

function dateToTs(d: string | undefined): string | null {
  if (!d) return null;
  const trimmed = d.trim();
  if (!trimmed) return null;
  if (/T\d{2}:\d{2}/.test(trimmed)) return trimmed;
  return `${trimmed}T00:00:00Z`;
}

export function transformPurchaseOrders(
  records: LegacyPoDoc[],
  ctx: TransformContext,
): TransformResult<unknown>[] {
  const headerRows = new Map<string, TransformedPurchaseOrder>();
  const lineRows: TransformedPurchaseOrderLine[] = [];
  const headerAnomalies: Anomaly[] = [];
  const lineAnomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];
  const vendorsByCode = ctx.lookups.byCode['vendors'];
  const soLinesById = ctx.idMap['sales_order_lines'] ?? {};
  // Built by purchase-requests transform via updateLookupsFromResult:
  // prCode → resolved jc_op_id (or empty string if PR didn't resolve a JC link).
  const prToJcOp =
    ctx.lookups.byCompositeKey['purchase_requests_to_jc_op_id'];

  for (const r of records) {
    if (!r.poNo) {
      headerAnomalies.push({ legacyId: r.id, type: 'poNo_missing' });
      continue;
    }
    const poNo = r.poNo.trim();

    if (!headerRows.has(poNo)) {
      if (!r.poDate) {
        headerAnomalies.push({ legacyId: r.id, type: 'poDate_missing', details: { poNo } });
        continue;
      }
      const { type, unrecognised } = normaliseType(r.poType);
      if (unrecognised) {
        headerAnomalies.push({
          legacyId: r.id,
          type: 'po_type_unrecognised',
          details: { poNo, from: unrecognised, defaultedTo: type },
        });
      }

      const vendorCode = r.vendorCode?.trim();
      const vendorId = vendorCode ? vendorsByCode?.get(vendorCode) ?? null : null;
      const vendorCodeText = vendorCode && !vendorId ? vendorCode : null;

      if (r.approvedBy) {
        headerAnomalies.push({
          legacyId: r.id,
          type: 'approved_by_text_only',
          details: { poNo, approvedBy: r.approvedBy },
        });
      }

      headerRows.set(poNo, {
        _legacyId: `po::${poNo}`,
        id: legacyPurchaseOrderUuid(poNo),
        code: poNo,
        poDate: r.poDate,
        poType: type,
        vendorId,
        vendorCodeText,
        status: normaliseStatus(r.status),
        dueDate: emptyToNull(r.dueDate),
        taxType: emptyToNull(r.taxType),
        sgstPct: typeof r.sgstPct === 'number' ? r.sgstPct.toFixed(2) : '0.00',
        cgstPct: typeof r.cgstPct === 'number' ? r.cgstPct.toFixed(2) : '0.00',
        igstPct: typeof r.igstPct === 'number' ? r.igstPct.toFixed(2) : '0.00',
        prCodeText: emptyToNull(r.prNo),
        approvedBy: null,
        approvedAt: dateToTs(r.approvedDate),
        approvalRemarks: emptyToNull(r.approvalRemarks),
        remarks: emptyToNull(r.remarks),
      });
    }

    const headerRow = headerRows.get(poNo);
    if (!headerRow) continue;

    // Line
    const lineNoNum =
      typeof r.lineNo === 'number'
        ? r.lineNo
        : typeof r.lineNo === 'string' && /^\d+$/.test(r.lineNo)
          ? Number(r.lineNo)
          : null;
    if (lineNoNum === null || lineNoNum <= 0) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'lineNo_invalid',
        details: { poNo, lineNo: r.lineNo },
      });
      continue;
    }
    if (typeof r.qty !== 'number' || r.qty <= 0) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'qty_invalid',
        details: { poNo, lineNo: lineNoNum, qty: r.qty },
      });
      continue;
    }
    if (!r.itemName) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'itemName_missing',
        details: { poNo, lineNo: lineNoNum },
      });
      continue;
    }

    const itemCodeRaw = r.itemCode?.trim() ?? '';
    const itemId = itemCodeRaw ? itemsByCode?.get(itemCodeRaw) ?? null : null;
    const itemCodeText = itemCodeRaw && !itemId ? itemCodeRaw : null;

    // SO line link via direct idMap.
    let sourceSoLineId: string | null = null;
    if (r.soRefId) {
      sourceSoLineId = (soLinesById[r.soRefId] ?? null) as string | null;
      if (!sourceSoLineId) {
        lineAnomalies.push({
          legacyId: r.id,
          type: 'so_line_unresolved',
          details: { poNo, lineNo: lineNoNum, soRefId: r.soRefId },
        });
      }
    }

    // JC op link via PR bridge: prCode → resolved jc_op_id.
    let sourceJcOpId: string | null = null;
    if (r.prNo && prToJcOp) {
      const resolved = prToJcOp.get(r.prNo.trim());
      if (resolved) sourceJcOpId = resolved;
    }

    lineRows.push({
      _legacyId: r.id,
      _legacyPoCode: poNo,
      _legacyItemCode: itemCodeRaw || null,
      id: legacyPurchaseOrderLineUuid(r.id),
      purchaseOrderId: headerRow.id,
      lineNo: lineNoNum,
      itemId,
      itemCodeText,
      itemName: r.itemName.trim(),
      qty: r.qty,
      rate: typeof r.rate === 'number' ? r.rate.toFixed(2) : '0.00',
      receivedQty: typeof r.receivedQty === 'number' ? Math.max(0, r.receivedQty) : 0,
      dueDate: emptyToNull(r.dueDate),
      sourceSoLineId,
      sourceJcOpId,
      lineRemarks: emptyToNull(r.lineRemarks),
    });
  }

  return [
    {
      table: 'purchase_orders',
      sourceCollection: 'purchaseOrders',
      transformedAt: new Date().toISOString(),
      rows: Array.from(headerRows.values()),
      anomalies: headerAnomalies,
    },
    {
      table: 'purchase_order_lines',
      sourceCollection: 'purchaseOrders',
      transformedAt: new Date().toISOString(),
      rows: lineRows,
      anomalies: lineAnomalies,
    },
  ];
}
