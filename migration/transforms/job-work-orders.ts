// job-work-orders transform — legacy `jobWorkOrders` (denormalised line-per-doc)
// to Postgres `job_work_orders` header + `job_work_order_lines` children.
//
// Per ADR-012 #1, JWs get the same header+lines split as SOs for symmetry
// with the JC source link. Each current JW has 1 line; a future multi-line
// JW would land in this same shape without code change.
//
// Header field mapping (taken from FIRST occurrence of each jwNo):
//   jwNo        → code
//   jwDate      → jw_date
//   customer    → customer_name + clientId resolved → client_id (current
//                 records have empty clientId — load null, use customer_name)
//   clientPoNo  → client_po_no
//   status      → status (so_status enum — same as SO; defaults 'open')
//   remarks     → remarks
//
// Line field mapping (per doc):
//   id                    → _legacyId, uuidv5 → id (job_work_order_lines.id)
//   lineNo                → line_no
//   itemCode              → item_id (via byCode.items) + item_code_text fallback
//   partName              → part_name
//   material/drawingNo    → material/drawing_no
//   uom                   → uom (normalised)
//   orderQty              → order_qty (DB CHECK > 0)
//   dueDate               → due_date
//   clientMaterial        → client_material
//   clientMaterialQty     → client_material_qty
//   materialReceivedDate  → material_received_date
//   materialReceivedQty   → material_received_qty
//   status                → status
//
// Note: both current JW lines reference itemCodes (`ITM-003`, `ITM-001`) that
// don't exist in production items master — both load with item_id=null +
// item_code_text preserved per ADR-012 #10. NOT skipped.

import { type Uom, UOMS } from '@innovic/shared';
import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyJwDoc {
  id: string;
  jwNo?: string;
  jwDate?: string;
  customer?: string;
  clientId?: string;
  clientCode?: string;
  clientPoNo?: string;
  status?: string;
  remarks?: string;
  // Line fields
  lineNo?: number | string;
  itemCode?: string;
  partNo?: string;
  partName?: string;
  material?: string;
  drawingNo?: string;
  uom?: string;
  orderQty?: number;
  dueDate?: string;
  clientMaterial?: string;
  clientMaterialQty?: number;
  materialReceivedDate?: string;
  materialReceivedQty?: number;
}

export interface TransformedJobWorkOrder {
  _legacyId: string; // synthetic: `jw::${jwNo}`
  id: string;
  code: string;
  jwDate: string;
  clientId: string | null;
  customerName: string | null;
  clientPoNo: string | null;
  status: 'open' | 'closed' | 'dispatched' | 'cancelled';
  remarks: string | null;
  _legacyExtras: Record<string, unknown>;
}

export interface TransformedJobWorkOrderLine {
  _legacyId: string;
  _legacyJwNo: string;
  id: string;
  jobWorkOrderId: string;
  lineNo: number;
  itemId: string | null;
  itemCodeText: string | null;
  partName: string;
  material: string | null;
  drawingNo: string | null;
  uom: Uom;
  orderQty: number;
  dueDate: string | null;
  clientMaterial: string | null;
  clientMaterialQty: string | null;
  materialReceivedDate: string | null;
  materialReceivedQty: string | null;
  status: 'open' | 'closed' | 'dispatched' | 'cancelled';
}

export function legacyJwHeaderUuid(jwNo: string): string {
  return uuidv5(`job_work_orders/${jwNo}`, MIGRATION_UUID_NAMESPACE);
}

export function legacyJwLineUuid(legacyDocId: string): string {
  return uuidv5(`job_work_order_lines/${legacyDocId}`, MIGRATION_UUID_NAMESPACE);
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

function normaliseStatus(
  raw: string | undefined,
): 'open' | 'closed' | 'dispatched' | 'cancelled' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'closed' || v === 'completed') return 'closed';
  if (v === 'dispatched') return 'dispatched';
  if (v === 'cancelled' || v === 'canceled') return 'cancelled';
  return 'open';
}

export function transformJobWorkOrders(
  records: LegacyJwDoc[],
  ctx: TransformContext,
): TransformResult<unknown>[] {
  const headerRows = new Map<string, TransformedJobWorkOrder>();
  const lineRows: TransformedJobWorkOrderLine[] = [];
  const headerAnomalies: Anomaly[] = [];
  const lineAnomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];
  const clientsByCode = ctx.lookups.byCode['clients'];

  for (const r of records) {
    if (!r.jwNo) {
      headerAnomalies.push({ legacyId: r.id, type: 'jwNo_missing' });
      continue;
    }
    const jwNo = r.jwNo.trim();

    if (!headerRows.has(jwNo)) {
      if (!r.jwDate) {
        headerAnomalies.push({ legacyId: r.id, type: 'jwDate_missing', details: { jwNo } });
        continue;
      }
      const clientCode = r.clientCode?.trim();
      const clientId = clientCode ? clientsByCode?.get(clientCode) ?? null : null;

      headerRows.set(jwNo, {
        _legacyId: `jw::${jwNo}`,
        id: legacyJwHeaderUuid(jwNo),
        code: jwNo,
        jwDate: r.jwDate,
        clientId,
        customerName: emptyToNull(r.customer),
        clientPoNo: emptyToNull(r.clientPoNo),
        status: normaliseStatus(r.status),
        remarks: emptyToNull(r.remarks),
        _legacyExtras: {},
      });
    }

    const headerRow = headerRows.get(jwNo);
    if (!headerRow) continue;

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
        details: { jwNo, lineNo: r.lineNo },
      });
      continue;
    }
    if (typeof r.orderQty !== 'number' || r.orderQty <= 0) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'orderQty_invalid',
        details: { jwNo, lineNo: lineNoNum, orderQty: r.orderQty },
      });
      continue;
    }
    if (!r.partName) {
      lineAnomalies.push({
        legacyId: r.id,
        type: 'partName_missing',
        details: { jwNo, lineNo: lineNoNum },
      });
      continue;
    }

    const itemCodeRaw = r.itemCode?.trim() ?? r.partNo?.trim() ?? '';
    const itemId = itemCodeRaw ? itemsByCode?.get(itemCodeRaw) ?? null : null;
    const itemCodeText = itemCodeRaw && !itemId ? itemCodeRaw : null;

    lineRows.push({
      _legacyId: r.id,
      _legacyJwNo: jwNo,
      id: legacyJwLineUuid(r.id),
      jobWorkOrderId: headerRow.id,
      lineNo: lineNoNum,
      itemId,
      itemCodeText,
      partName: r.partName.trim(),
      material: emptyToNull(r.material),
      drawingNo: emptyToNull(r.drawingNo),
      uom: normaliseUom(r.uom),
      orderQty: r.orderQty,
      dueDate: emptyToNull(r.dueDate),
      clientMaterial: emptyToNull(r.clientMaterial),
      clientMaterialQty:
        typeof r.clientMaterialQty === 'number' ? r.clientMaterialQty.toFixed(2) : null,
      materialReceivedDate: emptyToNull(r.materialReceivedDate),
      materialReceivedQty:
        typeof r.materialReceivedQty === 'number' && r.materialReceivedQty > 0
          ? r.materialReceivedQty.toFixed(2)
          : null,
      status: normaliseStatus(r.status),
    });
  }

  return [
    {
      table: 'job_work_orders',
      sourceCollection: 'jobWorkOrders',
      transformedAt: new Date().toISOString(),
      rows: Array.from(headerRows.values()),
      anomalies: headerAnomalies,
    },
    {
      table: 'job_work_order_lines',
      sourceCollection: 'jobWorkOrders',
      transformedAt: new Date().toISOString(),
      rows: lineRows,
      anomalies: lineAnomalies,
    },
  ];
}
