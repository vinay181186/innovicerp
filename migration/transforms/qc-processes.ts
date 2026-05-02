// qc-processes transform — legacy `qcProcesses` master collection (5 records:
// MIR / MCR / DIR / Coating Inspection / TPI) to Postgres `qc_processes`.
// Per ADR-016 (T-038) — pure master-data migration, no per-inspection events.
//
// Field mapping:
//   id                → _legacyId, uuidv5 → id
//   name              → code (legacy `name` is both unique key + display
//                       label; ADR-016 #2 picks `code` as the column)
//   description       → description (null if empty)
//   defaultCycleTime  → defaultCycleTimeMin (numeric stored as string)
//   status            → isActive (status === 'Active' → true; anything else
//                       → false; absent → true to match operators pattern)

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformResult } from './types';

interface LegacyQcProcess {
  id: string;
  name?: string;
  description?: string;
  defaultCycleTime?: number;
  status?: string;
}

export interface TransformedQcProcess {
  _legacyId: string;
  id: string;
  code: string;
  description: string | null;
  defaultCycleTimeMin: string; // numeric stored as string
  isActive: boolean;
}

export function legacyQcProcessIdToUuid(legacyId: string): string {
  return uuidv5(`qc_processes/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function transformQcProcesses(
  records: LegacyQcProcess[],
): TransformResult<TransformedQcProcess> {
  const rows: TransformedQcProcess[] = [];
  const anomalies: Anomaly[] = [];

  for (const r of records) {
    if (!r.name) {
      anomalies.push({ legacyId: r.id, type: 'name_missing' });
      continue;
    }
    const code = r.name.trim();
    if (code.length === 0) {
      anomalies.push({ legacyId: r.id, type: 'name_blank' });
      continue;
    }

    const isActive = r.status === undefined || r.status === 'Active';
    if (r.status !== undefined && r.status !== 'Active') {
      anomalies.push({
        legacyId: r.id,
        type: 'status_inactive',
        details: { from: r.status },
      });
    }

    const cycle =
      typeof r.defaultCycleTime === 'number' && Number.isFinite(r.defaultCycleTime)
        ? r.defaultCycleTime
        : 0;

    rows.push({
      _legacyId: r.id,
      id: legacyQcProcessIdToUuid(r.id),
      code,
      description: emptyToNull(r.description),
      defaultCycleTimeMin: cycle.toFixed(2),
      isActive,
    });
  }

  return {
    table: 'qc_processes',
    sourceCollection: 'qcProcesses',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
