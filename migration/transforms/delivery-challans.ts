// delivery-challans transform — legacy `challans` (header doc with embedded
// lines[]) to Postgres `delivery_challans` header + `delivery_challan_lines`
// children. Per ADR-017 (T-039). 4 source records → 4 headers + 4 lines.
//
// Header field mapping:
//   id          → _legacyId, uuidv5 → id (header)
//   dcNo        → code (business unique key per company)
//   dcDate      → dc_date
//   poNo        → purchase_order_id via byCode.purchase_orders (NULLABLE
//                 — DC-00002's IN-PO-00002 is unmigrated; po_code_text
//                 always set as the durable record per ADR-017 #5)
//   vendorCode  → vendor_id via byCode.vendors (REQUIRED) +
//                 vendor_code_text fallback
//   soRefId     → sales_order_line_id via idMap.sales_order_lines (NULLABLE
//                 — most legacy soRefIds reference SO lines never migrated);
//                 so_ref_text always preserved
//   transport   → transport
//   status      → status enum (legacy 'Issued' → 'issued')
//
// Line field mapping (per embedded lines[] entry; legacy doesn't number DC
// lines so we auto-assign 1..N in source order):
//   itemCode    → item_id via byCode.items (REQUIRED) + item_code_text
//   itemName    → item_name_text
//   qty         → qty (numeric)
//   uom         → uom enum (legacy 'NOS' → 'nos'; falls back to 'nos' if
//                 unrecognised, with anomaly)
//   material    → material_text
//   dcRemarks   → dc_remarks
//
// Anomalies:
//   - dcNo missing → skip header (and its lines)
//   - dcDate missing → skip header (and its lines)
//   - vendorCode missing or unresolved → skip header (vendor_id is NOT NULL)
//   - poNo unresolved → po_code_text only + anomaly (DC-00002 case)
//   - soRefId unresolved → so_ref_text only + anomaly (3-of-4 records)
//   - line itemCode missing or unresolved → skip line + anomaly
//   - line qty non-positive → skip line + anomaly (CHECK enforces > 0)
//   - line uom unrecognised → defaulted to 'nos' + anomaly

import { type Uom, UOMS } from '@innovic/shared';
import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyChallanLine {
  itemCode?: string;
  itemName?: string;
  qty?: number;
  uom?: string;
  material?: string;
  dcRemarks?: string;
}

interface LegacyChallan {
  id: string;
  dcNo?: string;
  poNo?: string;
  dcDate?: string;
  vendorCode?: string;
  soRefId?: string;
  transport?: string;
  lines?: LegacyChallanLine[];
  status?: string;
}

export interface TransformedDeliveryChallan {
  _legacyId: string;
  id: string;
  code: string;
  dcDate: string;
  purchaseOrderId: string | null;
  poCodeText: string;
  vendorId: string;
  vendorCodeText: string;
  salesOrderLineId: string | null;
  soRefText: string | null;
  transport: string | null;
  status: 'issued' | 'received' | 'cancelled';
}

export interface TransformedDeliveryChallanLine {
  _legacyId: string; // synthetic: `${dcLegacyId}::line::${lineNo}`
  _legacyDcCode: string;
  id: string;
  deliveryChallanId: string;
  lineNo: number;
  itemId: string;
  itemCodeText: string;
  itemNameText: string | null;
  qty: string;
  uom: Uom;
  materialText: string | null;
  dcRemarks: string | null;
}

export function legacyDeliveryChallanIdToUuid(legacyId: string): string {
  return uuidv5(`delivery_challans/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

export function legacyDeliveryChallanLineUuid(syntheticId: string): string {
  return uuidv5(`delivery_challan_lines/${syntheticId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined || s === null) return null;
  const trimmed = String(s).trim();
  return trimmed.length === 0 ? null : trimmed;
}

// Same uppercase-match pattern as sales-orders / job-work-orders / grn.
// Default is 'NOS' (the dominant legacy value); unknown gets logged.
function normaliseUom(raw: string | undefined): { value: Uom; unrecognised?: string } {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { value: 'NOS' };
  const upper = trimmed.toUpperCase();
  if ((UOMS as readonly string[]).includes(upper)) return { value: upper as Uom };
  return { value: 'NOS', unrecognised: trimmed };
}

function normaliseStatus(raw: string | undefined): {
  value: TransformedDeliveryChallan['status'];
  unrecognised?: string;
} {
  const trimmed = (raw ?? '').trim().toLowerCase();
  if (trimmed === 'issued' || trimmed === '') return { value: 'issued' };
  if (trimmed === 'received') return { value: 'received' };
  if (trimmed === 'cancelled' || trimmed === 'canceled') return { value: 'cancelled' };
  return raw === undefined ? { value: 'issued' } : { value: 'issued', unrecognised: raw };
}

export function transformDeliveryChallans(
  records: LegacyChallan[],
  ctx: TransformContext,
): TransformResult<unknown>[] {
  const headerRows: TransformedDeliveryChallan[] = [];
  const lineRows: TransformedDeliveryChallanLine[] = [];
  const headerAnomalies: Anomaly[] = [];
  const lineAnomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];
  const vendorsByCode = ctx.lookups.byCode['vendors'];
  const posByCode = ctx.lookups.byCode['purchase_orders'];
  const soLinesByLegacyId = ctx.idMap['sales_order_lines'] ?? {};

  for (const r of records) {
    if (!r.dcNo) {
      headerAnomalies.push({ legacyId: r.id, type: 'dcNo_missing' });
      continue;
    }
    const code = r.dcNo.trim();
    if (!code) {
      headerAnomalies.push({ legacyId: r.id, type: 'dcNo_blank' });
      continue;
    }
    if (!r.dcDate) {
      headerAnomalies.push({ legacyId: r.id, type: 'dcDate_missing', details: { dcNo: code } });
      continue;
    }

    const vendorCode = r.vendorCode?.trim() ?? '';
    if (!vendorCode) {
      headerAnomalies.push({
        legacyId: r.id,
        type: 'vendorCode_missing',
        details: { dcNo: code },
      });
      continue;
    }
    const vendorId = vendorsByCode?.get(vendorCode);
    if (!vendorId) {
      headerAnomalies.push({
        legacyId: r.id,
        type: 'vendor_unresolved',
        details: { dcNo: code, vendorCode },
      });
      continue;
    }

    const poCode = r.poNo?.trim() ?? '';
    let purchaseOrderId: string | null = null;
    if (poCode) {
      purchaseOrderId = posByCode?.get(poCode) ?? null;
      if (!purchaseOrderId) {
        headerAnomalies.push({
          legacyId: r.id,
          type: 'po_unresolved',
          details: { dcNo: code, poNo: poCode },
        });
      }
    } else {
      headerAnomalies.push({
        legacyId: r.id,
        type: 'poNo_missing',
        details: { dcNo: code },
      });
      continue;
    }

    const soRefId = r.soRefId?.trim() ?? '';
    let salesOrderLineId: string | null = null;
    if (soRefId) {
      const resolved = soLinesByLegacyId[soRefId];
      salesOrderLineId = typeof resolved === 'string' ? resolved : null;
      if (!salesOrderLineId) {
        headerAnomalies.push({
          legacyId: r.id,
          type: 'so_line_unresolved',
          details: { dcNo: code, soRefId },
        });
      }
    }

    const { value: status, unrecognised: statusUnrecognised } = normaliseStatus(r.status);
    if (statusUnrecognised) {
      headerAnomalies.push({
        legacyId: r.id,
        type: 'status_unrecognised',
        details: { dcNo: code, from: statusUnrecognised, defaultedTo: status },
      });
    }

    const headerId = legacyDeliveryChallanIdToUuid(r.id);
    headerRows.push({
      _legacyId: r.id,
      id: headerId,
      code,
      dcDate: r.dcDate,
      purchaseOrderId,
      poCodeText: poCode,
      vendorId,
      vendorCodeText: vendorCode,
      salesOrderLineId,
      // Legacy soRefId is an internal Firebase key (e.g. "574se7ev"), NOT a
      // human SO number — never surface it as the SO snapshot. The live SO code
      // (joined via salesOrderLineId) is the display source; leave text null.
      // The raw soRefId is still recorded in the so_line_unresolved anomaly above.
      soRefText: null,
      transport: emptyToNull(r.transport),
      status,
    });

    // Lines
    const linesIn = Array.isArray(r.lines) ? r.lines : [];
    let lineNo = 0;
    for (const ln of linesIn) {
      const itemCode = ln.itemCode?.trim() ?? '';
      if (!itemCode) {
        lineAnomalies.push({
          legacyId: r.id,
          type: 'line_itemCode_missing',
          details: { dcNo: code },
        });
        continue;
      }
      const itemId = itemsByCode?.get(itemCode);
      if (!itemId) {
        lineAnomalies.push({
          legacyId: r.id,
          type: 'line_item_unresolved',
          details: { dcNo: code, itemCode },
        });
        continue;
      }

      if (typeof ln.qty !== 'number' || !Number.isFinite(ln.qty) || ln.qty <= 0) {
        lineAnomalies.push({
          legacyId: r.id,
          type: 'line_qty_invalid',
          details: { dcNo: code, itemCode, qty: ln.qty },
        });
        continue;
      }

      const { value: uom, unrecognised: uomUnrecognised } = normaliseUom(ln.uom);
      if (uomUnrecognised) {
        lineAnomalies.push({
          legacyId: r.id,
          type: 'line_uom_unrecognised',
          details: { dcNo: code, itemCode, from: uomUnrecognised, defaultedTo: uom },
        });
      }

      lineNo++;
      const syntheticId = `${r.id}::line::${lineNo}`;
      lineRows.push({
        _legacyId: syntheticId,
        _legacyDcCode: code,
        id: legacyDeliveryChallanLineUuid(syntheticId),
        deliveryChallanId: headerId,
        lineNo,
        itemId,
        itemCodeText: itemCode,
        itemNameText: emptyToNull(ln.itemName),
        qty: ln.qty.toFixed(2),
        uom,
        materialText: emptyToNull(ln.material),
        dcRemarks: emptyToNull(ln.dcRemarks),
      });
    }
  }

  return [
    {
      table: 'delivery_challans',
      sourceCollection: 'challans',
      transformedAt: new Date().toISOString(),
      rows: headerRows,
      anomalies: headerAnomalies,
    },
    {
      table: 'delivery_challan_lines',
      sourceCollection: 'challans',
      transformedAt: new Date().toISOString(),
      rows: lineRows,
      anomalies: lineAnomalies,
    },
  ];
}
