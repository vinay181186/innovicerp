// sales-orders transform — legacy `salesOrders` (denormalised line-per-doc)
// to Postgres `sales_orders` header + `sales_order_lines` children.
//
// Per ADR-012 #1, both salesOrders and jobWorkOrders get header+lines split.
// The legacy collection stores each LINE as a separate doc with the SO header
// fields repeated (8 of 9 docs share `soNo='SO-436'`). Group by `soNo` to
// derive headers; emit one line per source doc.
//
// Header field mapping (taken from FIRST occurrence of each soNo):
//   soNo        → code
//   soDate      → so_date
//   customer    → customer_name (fallback) + clientId resolved → client_id
//   clientPoNo  → client_po_no
//   type        → type (so_type enum, normalised: 'Component Manufacturing'
//                 → 'component_manufacturing', 'Equipment' → 'equipment',
//                 'With Material' → 'with_material')
//   status      → status (so_status enum; defaults to 'open')
//   gstPercent  → gst_percent
//   bomMasterId → bom_master_id (forward ref; FK in later phase)
//   bomStatus   → bom_status
//   costCenter  → cost_center
//   remarks     → remarks
//
// Line field mapping (per doc):
//   id              → _legacyId, uuidv5 → id (sales_order_lines.id)
//   lineNo          → line_no
//   itemCode        → item_id (resolved via ctx.lookups.byCode.items) +
//                     item_code_text fallback when unresolved (ADR-012 #10)
//   partName        → part_name
//   material        → material
//   drawingNo       → drawing_no
//   uom             → uom (normalised; default NOS)
//   orderQty        → order_qty (must be > 0 — DB CHECK constraint)
//   rate            → rate
//   dueDate         → due_date (null if empty)
//   clientPoLineNo  → client_po_line_no
//   status          → status (per-line; defaults to header status if missing)
//
// Anomalies:
//   - soNo missing on a doc → skip the doc (line + header)
//   - lineNo missing or non-numeric → skip the line
//   - orderQty missing or <= 0 → skip the line
//   - itemCode unresolved → loaded with item_id=null + item_code_text preserved
//     (NOT skipped per ADR-012 #10)
//   - type missing or unrecognised → defaulted to 'component_manufacturing' with anomaly

import { type Uom, UOMS } from '@innovic/shared';
import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacySalesOrderDoc {
  id: string;
  // Header fields (repeated on every line doc)
  soNo?: string;
  soDate?: string;
  customer?: string;
  clientId?: string;
  clientCode?: string;
  clientPoNo?: string;
  type?: string;
  status?: string;
  gstPercent?: number;
  bomMasterId?: string;
  bomStatus?: string;
  costCenter?: string;
  remarks?: string;
  milestones?: unknown[];
  // Line fields (per doc)
  lineNo?: number | string;
  itemCode?: string;
  partNo?: string;
  partName?: string;
  material?: string;
  drawingNo?: string;
  uom?: string;
  orderQty?: number;
  rate?: number;
  dueDate?: string;
  clientPoLineNo?: string;
}

export interface TransformedSalesOrder {
  _legacyId: string; // synthetic: `so::${soNo}`
  id: string;
  code: string;
  soDate: string;
  clientId: string | null;
  customerName: string | null;
  clientPoNo: string | null;
  type: 'component_manufacturing' | 'equipment' | 'with_material';
  status: 'open' | 'closed' | 'dispatched' | 'cancelled';
  gstPercent: string;
  bomMasterId: string | null;
  bomStatus: string | null;
  costCenter: string | null;
  remarks: string | null;
  _legacyExtras: Record<string, unknown>;
}

export interface TransformedSalesOrderLine {
  _legacyId: string;
  _legacySoNo: string;
  id: string;
  salesOrderId: string;
  lineNo: number;
  itemId: string | null;
  itemCodeText: string | null;
  partName: string;
  material: string | null;
  drawingNo: string | null;
  uom: Uom;
  orderQty: number;
  rate: string;
  dueDate: string | null;
  clientPoLineNo: string | null;
  status: 'open' | 'closed' | 'dispatched' | 'cancelled';
}

export function legacySalesOrderHeaderUuid(soNo: string): string {
  return uuidv5(`sales_orders/${soNo}`, MIGRATION_UUID_NAMESPACE);
}

export function legacySalesOrderLineUuid(legacyDocId: string): string {
  return uuidv5(`sales_order_lines/${legacyDocId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normaliseUom(raw: string | undefined): Uom {
  if (!raw) return 'NOS';
  const upper = raw.trim().toUpperCase();
  return (UOMS as readonly string[]).includes(upper) ? (upper as Uom) : 'NOS';
}

function normaliseType(raw: string | undefined): {
  type: 'component_manufacturing' | 'equipment' | 'with_material';
  unrecognised?: string;
} {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'component manufacturing' || v === 'component_manufacturing') {
    return { type: 'component_manufacturing' };
  }
  if (v === 'equipment') return { type: 'equipment' };
  if (v === 'with material' || v === 'with_material') return { type: 'with_material' };
  if (raw === undefined || raw.trim() === '') return { type: 'component_manufacturing' };
  return { type: 'component_manufacturing', unrecognised: raw };
}

function normaliseStatus(
  raw: string | undefined,
): 'open' | 'closed' | 'dispatched' | 'cancelled' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'closed' || v === 'completed') return 'closed'; // legacy 'Completed' is filter alias
  if (v === 'dispatched') return 'dispatched';
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  return 'open';
}

export function transformSalesOrders(
  records: LegacySalesOrderDoc[],
  ctx: TransformContext,
): TransformResult<unknown>[] {
  const headerRows = new Map<string, TransformedSalesOrder>();
  const lineRows: TransformedSalesOrderLine[] = [];
  const headerAnomalies: Anomaly[] = [];
  const lineAnomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];
  const clientsById = ctx.lookups.byCode['clients']; // legacy clientCode → uuid via byCode

  for (const r of records) {
    if (!r.soNo) {
      headerAnomalies.push({ legacyId: r.id, type: 'soNo_missing' });
      continue;
    }
    const soNo = r.soNo.trim();

    // Build header on first sight of this soNo
    if (!headerRows.has(soNo)) {
      if (!r.soDate) {
        headerAnomalies.push({ legacyId: r.id, type: 'soDate_missing', details: { soNo } });
        // Still create a header so subsequent lines can attach; use today as a
        // placeholder is wrong — better to skip this soNo entirely.
        continue;
      }
      const { type, unrecognised } = normaliseType(r.type);
      if (unrecognised) {
        headerAnomalies.push({
          legacyId: r.id,
          type: 'type_unrecognised',
          details: { soNo, from: unrecognised, defaultedTo: type },
        });
      }

      // Resolve client by legacy clientCode (clientsByCode); fall back to text.
      const clientCode = r.clientCode?.trim();
      const clientId = clientCode ? clientsById?.get(clientCode) ?? null : null;

      const extras: Record<string, unknown> = {};
      if (Array.isArray(r.milestones) && r.milestones.length > 0) {
        extras['milestones'] = r.milestones;
      }
      if (r.partName) extras['firstLinePartName'] = r.partName; // header doesn't have partName

      headerRows.set(soNo, {
        _legacyId: `so::${soNo}`,
        id: legacySalesOrderHeaderUuid(soNo),
        code: soNo,
        soDate: r.soDate,
        clientId,
        customerName: emptyToNull(r.customer),
        clientPoNo: emptyToNull(r.clientPoNo),
        type,
        status: normaliseStatus(r.status),
        gstPercent:
          typeof r.gstPercent === 'number' ? r.gstPercent.toFixed(2) : '18.00',
        bomMasterId: emptyToNull(r.bomMasterId),
        bomStatus: emptyToNull(r.bomStatus),
        costCenter: emptyToNull(r.costCenter),
        remarks: emptyToNull(r.remarks),
        _legacyExtras: extras,
      });
    }

    const headerRow = headerRows.get(soNo);
    if (!headerRow) continue; // header skipped → skip lines

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
        details: { soNo, lineNo: r.lineNo },
      });
      continue;
    }

    if (typeof r.orderQty !== 'number' || r.orderQty <= 0) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'orderQty_invalid',
        details: { soNo, lineNo: lineNoNum, orderQty: r.orderQty },
      });
      continue;
    }
    if (!r.partName) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'partName_missing',
        details: { soNo, lineNo: lineNoNum },
      });
      continue;
    }

    const itemCodeRaw = r.itemCode?.trim() ?? r.partNo?.trim() ?? '';
    const itemId = itemCodeRaw ? itemsByCode?.get(itemCodeRaw) ?? null : null;
    const itemCodeText = itemCodeRaw && !itemId ? itemCodeRaw : null;

    lineRows.push({
      _legacyId: r.id,
      _legacySoNo: soNo,
      id: legacySalesOrderLineUuid(r.id),
      salesOrderId: headerRow.id,
      lineNo: lineNoNum,
      itemId,
      itemCodeText,
      partName: r.partName.trim(),
      material: emptyToNull(r.material),
      drawingNo: emptyToNull(r.drawingNo),
      uom: normaliseUom(r.uom),
      orderQty: r.orderQty,
      rate: typeof r.rate === 'number' ? r.rate.toFixed(2) : '0.00',
      dueDate: emptyToNull(r.dueDate),
      clientPoLineNo: emptyToNull(r.clientPoLineNo),
      status: normaliseStatus(r.status),
    });
  }

  return [
    {
      table: 'sales_orders',
      sourceCollection: 'salesOrders',
      transformedAt: new Date().toISOString(),
      rows: Array.from(headerRows.values()),
      anomalies: headerAnomalies,
    },
    {
      table: 'sales_order_lines',
      sourceCollection: 'salesOrders',
      transformedAt: new Date().toISOString(),
      rows: lineRows,
      anomalies: lineAnomalies,
    },
  ];
}
