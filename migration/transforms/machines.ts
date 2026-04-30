// machines transform — legacy `machines` collection to Postgres `machines`.
//
// Field mapping:
//   id           → _legacyId, uuidv5 → id
//   machineId    → code
//   name         → name
//   type         → machineType (often empty in legacy; null if so)
//   capPerShift  → capacityPerShift (legacy is a count of units/operations
//                                    per shift; integer)
//   shifts       → shiftsPerDay
//   status       → status (free text — Running/Idle/Down/Maintenance)
//
// shiftsPerDay defaults to 1 if missing.
// status defaults to 'Idle' if missing.

import { v5 as uuidv5 } from 'uuid';
import { MIGRATION_UUID_NAMESPACE } from '../uuid-namespace';
import type { Anomaly, TransformResult } from './types';

interface LegacyMachine {
  id: string;
  machineId?: string;
  name?: string;
  type?: string;
  capPerShift?: number;
  shifts?: number;
  status?: string;
}

export interface TransformedMachine {
  _legacyId: string;
  id: string;
  code: string;
  name: string;
  machineType: string | null;
  capacityPerShift: number | null;
  shiftsPerDay: number;
  status: string;
  _legacyExtras: Record<string, unknown>;
}

export function legacyMachineIdToUuid(legacyId: string): string {
  return uuidv5(`machines/${legacyId}`, MIGRATION_UUID_NAMESPACE);
}

function emptyToNull(s: string | undefined): string | null {
  if (s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function transformMachines(records: LegacyMachine[]): TransformResult<TransformedMachine> {
  const rows: TransformedMachine[] = [];
  const anomalies: Anomaly[] = [];

  for (const r of records) {
    if (!r.machineId) {
      anomalies.push({ legacyId: r.id, type: 'machineId_missing' });
      continue;
    }
    if (!r.name) {
      anomalies.push({ legacyId: r.id, type: 'name_missing' });
      continue;
    }

    const known = new Set([
      'id',
      'machineId',
      'name',
      'type',
      'capPerShift',
      'shifts',
      'status',
    ]);
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (!known.has(k)) extras[k] = v;
    }

    rows.push({
      _legacyId: r.id,
      id: legacyMachineIdToUuid(r.id),
      code: r.machineId.trim(),
      name: r.name.trim(),
      machineType: emptyToNull(r.type),
      capacityPerShift: typeof r.capPerShift === 'number' ? r.capPerShift : null,
      shiftsPerDay: typeof r.shifts === 'number' && r.shifts > 0 ? r.shifts : 1,
      status: emptyToNull(r.status) ?? 'Idle',
      _legacyExtras: extras,
    });
  }

  return {
    table: 'machines',
    sourceCollection: 'machines',
    transformedAt: new Date().toISOString(),
    rows,
    anomalies,
  };
}
