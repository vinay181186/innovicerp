// items transform — legacy ERP `items` collection to the shape of the
// Postgres `items` table (apps/api/src/db/schema.ts).
//
// Field mapping (legacy → new):
//   id           → _legacyId (carried), and a deterministic uuidv5 → id
//   code         → code
//   name         → name
//   desc         → description
//   drawing      → drawingNo
//   rev          → revision
//   material     → material
//   uom          → uom (case-normalised; Set→SET, Nos→NOS)
//   drawingFile  → drawingFilePath (when non-empty)
//   stockQty,    → _legacyExtras (no current schema column; stock module
//   minStock,      lives in Phase 5 procurement → store_transactions)
//   category,
//   location,
//   status         → _legacyExtras (legacy row status; not migrated)
//   drawingData    → DROP (image bytes; observed empty in production data)
//
// Fields injected at LOAD time (T-015), not here:
//   companyId     — depends on the seed company UUID per environment
//   itemType      — defaults to 'component'; legacy has no equivalent field
//   createdBy /   — legacy items have no user attribution; T-015 sets these
//     updatedBy     to the seed admin
//   createdAt /   — uses Postgres default now() unless we have a meaningful
//     updatedAt     legacy timestamp (none in this collection's records)

import { type Uom, UOMS } from '@innovic/shared';
import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformResult } from './types';

interface LegacyItem {
  id: string;
  code?: string;
  name?: string;
  desc?: string;
  drawing?: string;
  rev?: string;
  material?: string;
  uom?: string;
  stockQty?: number;
  drawingData?: string;
  drawingFile?: string;
  minStock?: number;
  category?: string;
  location?: string;
  status?: string;
}

export interface TransformedItem {
  _legacyId: string;
  id: string; // deterministic uuidv5
  code: string;
  name: string;
  description: string | null;
  drawingNo: string | null;
  revision: string;
  material: string | null;
  uom: Uom;
  drawingFilePath: string | null;
  _legacyExtras: Record<string, unknown>;
}

function normaliseUom(raw: string | undefined): { uom: Uom; from?: string } {
  if (!raw) return { uom: 'NOS' };
  const upper = raw.trim().toUpperCase();
  if ((UOMS as readonly string[]).includes(upper)) {
    if (raw === upper) return { uom: upper as Uom };
    return { uom: upper as Uom, from: raw };
  }
  // Unknown UOM → default to NOS so loads don't fail on the enum check.
  return { uom: 'NOS', from: raw };
}

export function legacyItemIdToUuid(legacyId: string): string {
  return uuidv5(`items/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

export function transformItems(records: LegacyItem[]): TransformResult<TransformedItem> {
  const rows: TransformedItem[] = [];
  const anomalies: Anomaly[] = [];

  for (const r of records) {
    if (!r.code) {
      anomalies.push({ legacyId: r.id, type: 'code_missing' });
      continue;
    }
    if (!r.name) {
      anomalies.push({ legacyId: r.id, type: 'name_missing' });
      continue;
    }

    const { uom, from: uomFrom } = normaliseUom(r.uom);
    if (uomFrom !== undefined && uomFrom.toUpperCase() !== uom) {
      anomalies.push({
        legacyId: r.id,
        type: 'uom_unrecognised',
        details: { from: uomFrom, defaultedTo: uom },
      });
    } else if (uomFrom !== undefined) {
      anomalies.push({
        legacyId: r.id,
        type: 'uom_normalised',
        details: { from: uomFrom, to: uom },
      });
    }

    const drawingFilePath =
      r.drawingFile && r.drawingFile.trim().length > 0 ? r.drawingFile : null;
    if (r.drawingData && r.drawingData.length > 0) {
      anomalies.push({ legacyId: r.id, type: 'drawing_data_present_dropped' });
    }

    const known = new Set([
      'id',
      'code',
      'name',
      'desc',
      'drawing',
      'rev',
      'material',
      'uom',
      'stockQty',
      'drawingData',
      'drawingFile',
      'minStock',
      'category',
      'location',
      'status',
    ]);
    const extras: Record<string, unknown> = {};
    if (typeof r.stockQty === 'number') extras['stockQty'] = r.stockQty;
    if (typeof r.minStock === 'number') extras['minStock'] = r.minStock;
    if (r.category) extras['category'] = r.category;
    if (r.location) extras['location'] = r.location;
    if (r.status) extras['status'] = r.status;
    for (const [k, v] of Object.entries(r)) {
      if (!known.has(k)) extras[k] = v;
    }

    rows.push({
      _legacyId: r.id,
      id: legacyItemIdToUuid(r.id),
      code: r.code.trim(),
      name: r.name.trim(),
      description: r.desc?.trim() || null,
      drawingNo: r.drawing?.trim() || null,
      revision: r.rev?.trim() || 'A',
      material: r.material?.trim() || null,
      uom,
      drawingFilePath,
      _legacyExtras: extras,
    });
  }

  return {
    table: 'items',
    sourceCollection: 'items',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
