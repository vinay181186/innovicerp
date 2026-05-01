// job-cards transform — legacy `jobCards` to Postgres `job_cards`.
//
// Field mapping:
//   id              → _legacyId, uuidv5 → id
//   jcNo            → code
//   date            → jc_date
//   itemCode        → resolved via ctx.lookups.byCode.items → item_id (REQUIRED)
//   orderQty        → order_qty
//   priority        → priority (lowercased; 'Normal' → 'normal', 'High' → 'high';
//                     anything else defaults to 'normal' with anomaly)
//   dueDate         → due_date (null if empty)
//   drawingFile     → drawing_file_path (null if empty)
//   soNo, soRefId,  → source_legacy_ref (JSON-encoded as text per ADR-011 #5;
//   soLineNo,         FKs land in Phase 4)
//   soPartName,
//   clientPoLineNo
//   drawingData     → DROP (legacy base64 blob, all empty in source)
//   qcDocs          → DROP (deferred to Phase 6 per ADR-011 #10)
//
// Anomalies:
//   - jcNo missing → skip
//   - itemCode missing or unresolved → skip
//   - orderQty missing or <= 0 → skip
//   - priority not in lowered ['normal', 'high'] → defaulted to 'normal' (still loaded)

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyJobCard {
  id: string;
  jcNo?: string;
  date?: string;
  soNo?: string;
  soRefId?: string;
  soLineNo?: string;
  soPartName?: string;
  clientPoLineNo?: string;
  itemCode?: string;
  orderQty?: number;
  priority?: string;
  dueDate?: string;
  drawingFile?: string;
  drawingData?: string;
  qcDocs?: unknown[];
}

export interface TransformedJobCard {
  _legacyId: string;
  id: string;
  code: string;
  jcDate: string;
  itemId: string;
  orderQty: number;
  priority: 'normal' | 'high';
  dueDate: string | null;
  drawingFilePath: string | null;
  sourceLegacyRef: string;
  _legacyExtras: Record<string, unknown>;
}

export function legacyJobCardIdToUuid(legacyId: string): string {
  return uuidv5(`job_cards/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function transformJobCards(
  records: LegacyJobCard[],
  ctx: TransformContext,
): TransformResult<TransformedJobCard> {
  const rows: TransformedJobCard[] = [];
  const anomalies: Anomaly[] = [];

  const itemsByCode = ctx.lookups.byCode['items'];

  for (const r of records) {
    if (!r.jcNo) {
      anomalies.push({ legacyId: r.id, type: 'jcNo_missing' });
      continue;
    }
    const code = r.jcNo.trim();

    if (!r.itemCode) {
      anomalies.push({ legacyId: r.id, type: 'itemCode_missing', details: { jcNo: code } });
      continue;
    }
    const itemId = itemsByCode?.get(r.itemCode.trim());
    if (!itemId) {
      anomalies.push({
        legacyId: r.id,
        type: 'itemCode_unresolved',
        details: { jcNo: code, itemCode: r.itemCode },
      });
      continue;
    }

    if (typeof r.orderQty !== 'number' || r.orderQty <= 0) {
      anomalies.push({
        legacyId: r.id,
        type: 'orderQty_invalid',
        details: { jcNo: code, orderQty: r.orderQty },
      });
      continue;
    }

    if (!r.date) {
      anomalies.push({ legacyId: r.id, type: 'date_missing', details: { jcNo: code } });
      continue;
    }

    const priorityRaw = (r.priority ?? '').trim().toLowerCase();
    let priority: 'normal' | 'high' = 'normal';
    if (priorityRaw === 'high') {
      priority = 'high';
    } else if (priorityRaw && priorityRaw !== 'normal') {
      anomalies.push({
        legacyId: r.id,
        type: 'priority_unrecognised',
        details: { jcNo: code, from: r.priority, defaultedTo: 'normal' },
      });
    }

    const sourceRefObj: Record<string, string> = {};
    if (r.soNo) sourceRefObj['soNo'] = r.soNo;
    if (r.soRefId) sourceRefObj['soRefId'] = r.soRefId;
    if (r.soLineNo) sourceRefObj['soLineNo'] = r.soLineNo;
    if (r.soPartName) sourceRefObj['soPartName'] = r.soPartName;
    if (r.clientPoLineNo) sourceRefObj['clientPoLineNo'] = r.clientPoLineNo;

    const extras: Record<string, unknown> = {};
    if (r.drawingData && r.drawingData.length > 0) {
      anomalies.push({
        legacyId: r.id,
        type: 'drawing_data_present_dropped',
        details: { jcNo: code },
      });
    }
    if (Array.isArray(r.qcDocs) && r.qcDocs.length > 0) {
      extras['qcDocs'] = r.qcDocs;
    }

    rows.push({
      _legacyId: r.id,
      id: legacyJobCardIdToUuid(r.id),
      code,
      jcDate: r.date,
      itemId,
      orderQty: r.orderQty,
      priority,
      dueDate: emptyToNull(r.dueDate),
      drawingFilePath: emptyToNull(r.drawingFile),
      sourceLegacyRef: JSON.stringify(sourceRefObj),
      _legacyExtras: extras,
    });
  }

  return {
    table: 'job_cards',
    sourceCollection: 'jobCards',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
