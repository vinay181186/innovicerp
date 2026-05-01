// op-log transform — legacy `opLog` to Postgres `op_log`.
//
// Field mapping:
//   id              → _legacyId, uuidv5 → id
//   logNo           → log_no (NOT unique — legacy generates duplicates; we just preserve)
//   jcNo + opSeq    → resolved via ctx.lookups.byCompositeKey.jc_ops → jc_op_id (REQUIRED)
//   type            → log_type ('start'/'qc'/explicit 'complete' kept; missing → 'complete')
//   date            → log_date
//   shift           → shift (lowercased: 'Day' → 'day', 'Night' → 'night')
//   qty             → qty
//   rejectQty       → reject_qty (legacy field exists in code but not in 81 export rows; default 0)
//   operator        → operator_id (best-effort name match against operators byName/byCode);
//                     operator_name always preserved as fallback
//   startTime       → start_time (HH:MM, only when log_type='start')
//   remarks         → remarks
//
// Anomalies:
//   - jcNo missing → skip
//   - jcNo+opSeq doesn't resolve to a jc_op (orphans like JC-MS-002/003/004) → skip + capture
//   - shift not in lowered ['day', 'night'] → defaulted to 'day' with anomaly
//
// Per ADR-011 #11: ~7 orphan rows expected (JC-MS-002/003/004 jcNos which have no jobCards row).

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyOpLog {
  id: string;
  logNo?: string;
  jcNo?: string;
  opSeq?: number;
  date?: string;
  shift?: string;
  qty?: number;
  rejectQty?: number;
  operator?: string;
  remarks?: string;
  type?: string;
  startTime?: string;
}

export interface TransformedOpLog {
  _legacyId: string;
  id: string;
  jcOpId: string;
  logNo: string;
  logType: 'start' | 'complete' | 'qc';
  logDate: string;
  shift: 'day' | 'night';
  qty: number;
  rejectQty: number;
  operatorId: string | null;
  operatorName: string | null;
  startTime: string | null;
  remarks: string | null;
  _legacyExtras: Record<string, unknown>;
}

export function legacyOpLogIdToUuid(legacyId: string): string {
  return uuidv5(`op_log/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normaliseLogType(raw: string | undefined): 'start' | 'complete' | 'qc' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'start') return 'start';
  if (v === 'qc') return 'qc';
  return 'complete';
}

function normaliseShift(
  raw: string | undefined,
): { shift: 'day' | 'night'; from?: string } {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'day') return { shift: 'day' };
  if (v === 'night') return { shift: 'night' };
  if (raw === undefined) return { shift: 'day' };
  return { shift: 'day', from: raw };
}

// HH:MM from legacy time strings. Reject anything that doesn't look like HH:MM.
function normaliseStartTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

export function transformOpLog(
  records: LegacyOpLog[],
  ctx: TransformContext,
): TransformResult<TransformedOpLog> {
  const rows: TransformedOpLog[] = [];
  const anomalies: Anomaly[] = [];

  const jcOpsByKey = ctx.lookups.byCompositeKey['jc_ops'];
  const operatorsByName = ctx.lookups.byName['operators'];
  const operatorsByCode = ctx.lookups.byCode['operators'];

  for (const r of records) {
    if (!r.jcNo) {
      anomalies.push({ legacyId: r.id, type: 'jcNo_missing' });
      continue;
    }
    if (typeof r.opSeq !== 'number') {
      anomalies.push({
        legacyId: r.id,
        type: 'opSeq_invalid',
        details: { jcNo: r.jcNo, opSeq: r.opSeq },
      });
      continue;
    }

    const compositeKey = `${r.jcNo}::${r.opSeq}`;
    const jcOpId = jcOpsByKey?.get(compositeKey);
    if (!jcOpId) {
      anomalies.push({
        legacyId: r.id,
        type: 'jc_op_unresolved',
        details: { jcNo: r.jcNo, opSeq: r.opSeq, logNo: r.logNo },
      });
      continue;
    }

    if (!r.date) {
      anomalies.push({
        legacyId: r.id,
        type: 'date_missing',
        details: { jcNo: r.jcNo, opSeq: r.opSeq },
      });
      continue;
    }

    const { shift, from: shiftFrom } = normaliseShift(r.shift);
    if (shiftFrom !== undefined) {
      anomalies.push({
        legacyId: r.id,
        type: 'shift_unrecognised',
        details: { from: shiftFrom, defaultedTo: shift },
      });
    }

    const logType = normaliseLogType(r.type);

    // Operator best-effort match: try byName lowercase first, then byCode
    let operatorId: string | null = null;
    const operatorRaw = (r.operator ?? '').trim();
    if (operatorRaw) {
      const byNameKey = operatorRaw.toLowerCase();
      operatorId =
        operatorsByName?.get(byNameKey) ??
        operatorsByCode?.get(operatorRaw) ??
        null;
    }

    rows.push({
      _legacyId: r.id,
      id: legacyOpLogIdToUuid(r.id),
      jcOpId,
      logNo: r.logNo?.trim() || `LOG-${r.id.slice(0, 8)}`,
      logType,
      logDate: r.date,
      shift,
      qty: typeof r.qty === 'number' && r.qty >= 0 ? r.qty : 0,
      rejectQty: typeof r.rejectQty === 'number' && r.rejectQty >= 0 ? r.rejectQty : 0,
      operatorId,
      operatorName: emptyToNull(r.operator),
      startTime: logType === 'start' ? normaliseStartTime(r.startTime) : null,
      remarks: emptyToNull(r.remarks),
      _legacyExtras: {},
    });
  }

  return {
    table: 'op_log',
    sourceCollection: 'opLog',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
