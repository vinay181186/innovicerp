// purchase-requests transform — legacy `purchaseRequests` (single-table,
// 1 record) to Postgres `purchase_requests`.
//
// Field mapping:
//   id          → _legacyId, uuidv5 → id
//   prNo        → code
//   prDate      → pr_date
//   status      → status (legacy 'PO Created' → 'po_created')
//   vendorCode  → vendor_id (via byCode.vendors) + vendor_code_text fallback
//   itemCode    → item_id (via byCode.items) + item_code_text fallback
//   itemName    → item_name
//   qty         → qty
//   estCost     → est_cost
//   requiredDate→ required_date
//   jcNo+opSeq  → source_jc_op_id (via byCompositeKey.jc_ops)
//   soRefId     → source_so_line_id (via idMap.sales_order_lines)
//   operation   → operation
//   remarks     → remarks
//   approvedBy  → approved_by (NULL for migrated rows — legacy stores name
//                 like 'Japan' which doesn't reliably resolve to a user_id;
//                 anomaly logged)
//   approvedDate→ approved_at (preserved as ISO timestamp)
//   poNo        → po_id (resolved deterministically via uuidv5 for that poNo)
//   poCreatedDate → po_created_at
//
// Anomalies:
//   - prNo missing → skip
//   - vendor unresolvable → vendor_code_text preserved
//   - item unresolvable → item_code_text preserved
//   - jc_op unresolvable → source_jc_op_id null + anomaly
//   - approvedBy text non-null but unresolvable → approved_by null + anomaly

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import { legacyPurchaseOrderUuid } from './purchase-orders';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyPrDoc {
  id: string;
  prNo?: string;
  prDate?: string;
  status?: string;
  jcNo?: string;
  opSeq?: number | string;
  soRefId?: string;
  soNo?: string;
  itemCode?: string;
  itemName?: string;
  operation?: string;
  vendorCode?: string;
  vendorName?: string;
  qty?: number;
  estCost?: number;
  requiredDate?: string;
  remarks?: string;
  poNo?: string;
  createdBy?: string;
  approvedBy?: string;
  approvedDate?: string;
  poCreatedDate?: string;
}

export interface TransformedPurchaseRequest {
  _legacyId: string;
  /** Composite key for byCompositeKey['purchase_requests_to_jc_op_id'] —
   *  resolved jc_op_id (or null) so the PO transform can inherit it. */
  _legacyPrCode: string;
  _resolvedJcOpId: string | null;
  id: string;
  code: string;
  prDate: string;
  status: 'open' | 'approved' | 'po_created' | 'cancelled';
  vendorId: string | null;
  vendorCodeText: string | null;
  itemId: string | null;
  itemCodeText: string | null;
  itemName: string | null;
  qty: number;
  estCost: string; // numeric stored as string
  requiredDate: string | null;
  sourceJcOpId: string | null;
  sourceSoLineId: string | null;
  operation: string | null;
  remarks: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  poId: string | null;
  poCreatedAt: string | null;
}

export function legacyPurchaseRequestUuid(prNo: string): string {
  return uuidv5(`purchase_requests/${prNo}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normaliseStatus(
  raw: string | undefined,
): 'open' | 'approved' | 'po_created' | 'cancelled' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'po created' || v === 'po_created') return 'po_created';
  if (v === 'approved') return 'approved';
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  return 'open';
}

/** ISO date 'YYYY-MM-DD' → ISO timestamptz at start-of-day UTC.
 *  Legacy stores approvedDate / poCreatedDate as plain dates; the new
 *  schema uses timestamptz. */
function dateToTs(d: string | undefined): string | null {
  if (!d) return null;
  const trimmed = d.trim();
  if (!trimmed) return null;
  // If it already looks like a full timestamp, keep it; else append T00:00:00Z.
  if (/T\d{2}:\d{2}/.test(trimmed)) return trimmed;
  return `${trimmed}T00:00:00Z`;
}

export function transformPurchaseRequests(
  records: LegacyPrDoc[],
  ctx: TransformContext,
): TransformResult<TransformedPurchaseRequest> {
  const rows: TransformedPurchaseRequest[] = [];
  const anomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];
  const vendorsByCode = ctx.lookups.byCode['vendors'];
  const jcOpsByComposite = ctx.lookups.byCompositeKey['jc_ops'];
  const soLinesById = ctx.idMap['sales_order_lines'] ?? {};

  for (const r of records) {
    if (!r.prNo) {
      anomalies.push({ legacyId: r.id, type: 'prNo_missing' });
      continue;
    }
    const prNo = r.prNo.trim();

    if (!r.prDate) {
      anomalies.push({ legacyId: r.id, type: 'prDate_missing', details: { prNo } });
      continue;
    }

    if (typeof r.qty !== 'number' || r.qty <= 0) {
      anomalies.push({
        legacyId: r.id,
        type: 'qty_invalid',
        details: { prNo, qty: r.qty },
      });
      continue;
    }

    const vendorCode = r.vendorCode?.trim();
    const vendorId = vendorCode ? vendorsByCode?.get(vendorCode) ?? null : null;
    const vendorCodeText = vendorCode && !vendorId ? vendorCode : null;

    const itemCode = r.itemCode?.trim();
    const itemId = itemCode ? itemsByCode?.get(itemCode) ?? null : null;
    const itemCodeText = itemCode && !itemId ? itemCode : null;

    if (!vendorId && !vendorCodeText) {
      anomalies.push({
        legacyId: r.id,
        type: 'vendor_missing',
        details: { prNo },
      });
      continue;
    }
    if (!itemId && !itemCodeText) {
      anomalies.push({
        legacyId: r.id,
        type: 'item_missing',
        details: { prNo },
      });
      continue;
    }

    // Resolve jc_op via (jcNo, opSeq) composite key.
    let sourceJcOpId: string | null = null;
    if (r.jcNo && r.opSeq !== undefined) {
      const opSeqNum =
        typeof r.opSeq === 'number'
          ? r.opSeq
          : typeof r.opSeq === 'string' && /^\d+$/.test(r.opSeq)
            ? Number(r.opSeq)
            : null;
      if (opSeqNum !== null) {
        const key = `${r.jcNo.trim()}::${opSeqNum}`;
        sourceJcOpId = jcOpsByComposite?.get(key) ?? null;
        if (!sourceJcOpId) {
          anomalies.push({
            legacyId: r.id,
            type: 'jc_op_unresolved',
            details: { prNo, jcNo: r.jcNo, opSeq: opSeqNum },
          });
        }
      }
    }

    // Resolve SO line via legacy soRefId → sales_order_lines.id map.
    let sourceSoLineId: string | null = null;
    if (r.soRefId) {
      sourceSoLineId = (soLinesById[r.soRefId] ?? null) as string | null;
      if (!sourceSoLineId) {
        anomalies.push({
          legacyId: r.id,
          type: 'so_line_unresolved',
          details: { prNo, soRefId: r.soRefId },
        });
      }
    }

    // approvedBy is a free-text user name in legacy ('Japan'). We don't have
    // a reliable name → user_id lookup; load null + log anomaly. The new UI
    // will surface this as "approved (legacy import)" without a user link.
    if (r.approvedBy) {
      anomalies.push({
        legacyId: r.id,
        type: 'approved_by_text_only',
        details: { prNo, approvedBy: r.approvedBy },
      });
    }

    rows.push({
      _legacyId: r.id,
      _legacyPrCode: prNo,
      _resolvedJcOpId: sourceJcOpId,
      id: legacyPurchaseRequestUuid(prNo),
      code: prNo,
      prDate: r.prDate,
      status: normaliseStatus(r.status),
      vendorId,
      vendorCodeText,
      itemId,
      itemCodeText,
      itemName: emptyToNull(r.itemName),
      qty: r.qty,
      estCost: typeof r.estCost === 'number' ? r.estCost.toFixed(2) : '0.00',
      requiredDate: emptyToNull(r.requiredDate),
      sourceJcOpId,
      sourceSoLineId,
      operation: emptyToNull(r.operation),
      remarks: emptyToNull(r.remarks),
      approvedBy: null,
      approvedAt: dateToTs(r.approvedDate),
      // poId is set deterministically when PR has a populated poNo. PO
      // transform uses the same uuidv5 function so the IDs line up.
      poId: r.poNo ? legacyPurchaseOrderUuid(r.poNo.trim()) : null,
      poCreatedAt: dateToTs(r.poCreatedDate),
    });
  }

  return {
    table: 'purchase_requests',
    sourceCollection: 'purchaseRequests',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
