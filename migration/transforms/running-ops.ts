// running-ops transform — legacy `runningOps` to Postgres `running_ops`.
//
// Field mapping:
//   id              → _legacyId, uuidv5 → id
//   jcNo + opSeq    → resolved via ctx.lookups.byCompositeKey.jc_ops → jc_op_id (REQUIRED)
//   machineId       → resolved via ctx.lookups.byCode.machines → machine_id
//                     (null when machineId is 'OSP' sentinel — sets is_osp instead)
//   isOSP           → is_osp
//   operator        → operator_id (best-effort match) + operator_name (text fallback)
//   startDate       → start_date
//   startTime       → start_time
//   shift           → shift
//   status          → status (lowercased: 'Running' → 'running', 'Done' → 'done',
//                     'Stopped' → 'stopped', 'Completed' → 'done')
//
// Anomalies:
//   - jcNo+opSeq unresolved → skip
//   - status not in lowered set → skip with anomaly

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformContext, TransformResult } from './types';

interface LegacyRunningOp {
  id: string;
  jcNo?: string;
  opSeq?: number;
  machineId?: string;
  operator?: string;
  startDate?: string;
  startTime?: string;
  shift?: string;
  status?: string;
  isOSP?: boolean;
}

export interface TransformedRunningOp {
  _legacyId: string;
  id: string;
  jcOpId: string;
  machineId: string | null;
  isOsp: boolean;
  operatorId: string | null;
  operatorName: string | null;
  startDate: string;
  startTime: string;
  shift: 'day' | 'night';
  status: 'running' | 'done' | 'stopped';
  _legacyExtras: Record<string, unknown>;
}

export function legacyRunningOpIdToUuid(legacyId: string): string {
  return uuidv5(`running_ops/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normaliseShift(raw: string | undefined): 'day' | 'night' {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'night' ? 'night' : 'day';
}

function normaliseStatus(
  raw: string | undefined,
): 'running' | 'done' | 'stopped' | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'running') return 'running';
  if (v === 'done' || v === 'completed') return 'done';
  if (v === 'stopped') return 'stopped';
  return null;
}

function normaliseStartTime(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

export function transformRunningOps(
  records: LegacyRunningOp[],
  ctx: TransformContext,
): TransformResult<TransformedRunningOp> {
  const rows: TransformedRunningOp[] = [];
  const anomalies: Anomaly[] = [];

  const jcOpsByKey = ctx.lookups.byCompositeKey['jc_ops'];
  const machinesByCode = ctx.lookups.byCode['machines'];
  const operatorsByName = ctx.lookups.byName['operators'];
  const operatorsByCode = ctx.lookups.byCode['operators'];

  for (const r of records) {
    if (!r.jcNo || typeof r.opSeq !== 'number') {
      anomalies.push({
        legacyId: r.id,
        type: 'jc_op_key_missing',
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
        details: { jcNo: r.jcNo, opSeq: r.opSeq },
      });
      continue;
    }

    const status = normaliseStatus(r.status);
    if (!status) {
      anomalies.push({
        legacyId: r.id,
        type: 'status_unrecognised',
        details: { status: r.status },
      });
      continue;
    }

    if (!r.startDate) {
      anomalies.push({ legacyId: r.id, type: 'startDate_missing' });
      continue;
    }
    const startTime = normaliseStartTime(r.startTime);
    if (!startTime) {
      anomalies.push({
        legacyId: r.id,
        type: 'startTime_invalid',
        details: { startTime: r.startTime },
      });
      continue;
    }

    const machineCodeRaw = r.machineId?.trim() ?? '';
    const isOsp = r.isOSP === true || machineCodeRaw.toUpperCase() === 'OSP';
    const machineId = !isOsp && machineCodeRaw && machineCodeRaw !== 'QC'
      ? machinesByCode?.get(machineCodeRaw) ?? null
      : null;

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
      id: legacyRunningOpIdToUuid(r.id),
      jcOpId,
      machineId,
      isOsp,
      operatorId,
      operatorName: emptyToNull(r.operator),
      startDate: r.startDate,
      startTime,
      shift: normaliseShift(r.shift),
      status,
      _legacyExtras: {},
    });
  }

  return {
    table: 'running_ops',
    sourceCollection: 'runningOps',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
